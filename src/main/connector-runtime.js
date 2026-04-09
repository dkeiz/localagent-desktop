const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

/**
 * ConnectorRuntime - Manages dynamic connector scripts in worker threads
 * 
 * Connectors are JS files in agentin/connectors/ that export:
 *   { name, description, configSchema, start(context), stop() }
 * 
 * Each connector runs in its own worker_thread with hooks back to the
 * main process for LLM invocation, config access, and logging.
 */
class ConnectorRuntime extends EventEmitter {
    constructor(dispatcher, db, options = {}) {
        super();
        this.dispatcher = dispatcher;
        this.db = db;
        this.connectors = new Map(); // name -> { worker, config, status, meta, logs }
        this.connectorsDir = options.connectorsDir || path.join(__dirname, '../../agentin/connectors');
        this.workerPath = path.join(__dirname, 'connector-worker.js');
        this.maxLogs = 100;

        this._ensureDir();
    }

    _ensureDir() {
        if (!fs.existsSync(this.connectorsDir)) {
            fs.mkdirSync(this.connectorsDir, { recursive: true });
        }
    }

    // ==================== Connector Lifecycle ====================

    /**
     * Scan connectors directory and return metadata for all connectors
     */
    async listConnectors() {
        const files = fs.readdirSync(this.connectorsDir)
            .filter(f => f.endsWith('.js') && !f.startsWith('_'));

        const results = [];
        for (const file of files) {
            const name = path.basename(file, '.js');
            const running = this.connectors.has(name);
            const connector = this.connectors.get(name);

            // Try to read metadata from file without executing
            let meta = { name, description: '' };
            try {
                const content = fs.readFileSync(path.join(this.connectorsDir, file), 'utf-8');
                const nameMatch = content.match(/name:\s*['"]([^'"]+)['"]/);
                const descMatch = content.match(/description:\s*['"]([^'"]+)['"]/);
                if (nameMatch) meta.name = nameMatch[1];
                if (descMatch) meta.description = descMatch[1];
            } catch (e) { /* ignore */ }

            results.push({
                file,
                name: meta.name,
                description: meta.description,
                status: running ? connector.status : 'stopped',
                error: running ? connector.error : null
            });
        }
        return results;
    }

    /**
     * Start a connector by filename (without .js extension)
     */
    async startConnector(name) {
        if (this.connectors.has(name) && this.connectors.get(name).status === 'running') {
            throw new Error(`Connector "${name}" is already running`);
        }

        const scriptPath = path.join(this.connectorsDir, `${name}.js`);
        if (!fs.existsSync(scriptPath)) {
            throw new Error(`Connector script not found: ${scriptPath}`);
        }

        // Load config from DB
        const config = await this._loadConfig(name);

        console.log(`[ConnectorRuntime] Starting connector "${name}"...`);

        return new Promise((resolve, reject) => {
            const worker = new Worker(this.workerPath, {
                workerData: {
                    scriptPath,
                    config,
                    connectorName: name
                }
            });

            const connectorState = {
                worker,
                config,
                status: 'starting',
                error: null,
                meta: { name },
                logs: []
            };

            this.connectors.set(name, connectorState);

            // Handle messages from worker
            worker.on('message', async (msg) => {
                switch (msg.type) {
                    case 'started':
                        connectorState.status = 'running';
                        connectorState.meta = msg.meta || { name };
                        this._log(name, `Connector started`);
                        this.emit('connector-started', { name });
                        resolve({ success: true, name });
                        break;

                    case 'invoke':
                        // Worker wants to invoke LLM — use dispatcher (mode=connector: no tools, no rules)
                        try {
                            const response = await this.dispatcher.dispatch(msg.prompt, [], { mode: 'connector' });
                            worker.postMessage({
                                type: 'invoke-response',
                                requestId: msg.requestId,
                                response: response.content
                            });
                        } catch (error) {
                            worker.postMessage({
                                type: 'invoke-response',
                                requestId: msg.requestId,
                                error: error.message
                            });
                        }
                        break;

                    case 'log':
                        this._log(name, msg.message);
                        break;

                    case 'error':
                        connectorState.error = msg.error;
                        this._log(name, `Error: ${msg.error}`);
                        this.emit('connector-error', { name, error: msg.error });
                        break;

                    case 'start-failed':
                        connectorState.status = 'error';
                        connectorState.error = msg.error;
                        this._log(name, `Start failed: ${msg.error}`);
                        reject(new Error(msg.error));
                        break;
                }
            });

            worker.on('error', (error) => {
                connectorState.status = 'error';
                connectorState.error = error.message;
                this._log(name, `Worker error: ${error.message}`);
                this.emit('connector-error', { name, error: error.message });
            });

            worker.on('exit', (code) => {
                connectorState.status = 'stopped';
                connectorState.worker = null;
                this._log(name, `Worker exited with code ${code}`);
                this.emit('connector-stopped', { name, code });
            });

            // Timeout for startup
            setTimeout(() => {
                if (connectorState.status === 'starting') {
                    connectorState.status = 'error';
                    connectorState.error = 'Startup timeout';
                    worker.terminate();
                    reject(new Error('Connector startup timeout (30s)'));
                }
            }, 30000);
        });
    }

    /**
     * Stop a running connector
     */
    async stopConnector(name) {
        const connector = this.connectors.get(name);
        if (!connector || connector.status !== 'running') {
            throw new Error(`Connector "${name}" is not running`);
        }

        console.log(`[ConnectorRuntime] Stopping connector "${name}"...`);

        // Send stop command to worker
        connector.worker.postMessage({ type: 'stop' });

        // Give it 5 seconds to clean up, then force terminate
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (connector.worker) {
                    connector.worker.terminate();
                }
                connector.status = 'stopped';
                this._log(name, 'Force terminated');
                resolve({ success: true, name });
            }, 5000);

            connector.worker.once('exit', () => {
                clearTimeout(timeout);
                connector.status = 'stopped';
                this._log(name, 'Stopped gracefully');
                resolve({ success: true, name });
            });
        });
    }

    /**
     * Stop all connectors (called on app quit)
     */
    async stopAll() {
        const names = Array.from(this.connectors.keys());
        for (const name of names) {
            if (this.connectors.get(name)?.status === 'running') {
                try {
                    await this.stopConnector(name);
                } catch (e) {
                    console.error(`[ConnectorRuntime] Failed to stop "${name}":`, e.message);
                }
            }
        }
    }

    // ==================== Config Management ====================

    async _loadConfig(name) {
        const config = {};
        const prefix = `connector.${name}.`;
        const settings = await this.db.getAllSettings();
        for (const [key, value] of Object.entries(settings)) {
            if (key.startsWith(prefix)) {
                config[key.slice(prefix.length)] = value;
            }
        }
        return config;
    }

    async setConfig(name, key, value) {
        const settingKey = `connector.${name}.${key}`;
        await this.db.saveSetting(settingKey, value);

        // Update running connector's config
        const connector = this.connectors.get(name);
        if (connector) {
            connector.config[key] = value;
        }

        return { success: true, name, key };
    }

    async getConfig(name) {
        return await this._loadConfig(name);
    }

    // ==================== Logging ====================

    _log(name, message) {
        const connector = this.connectors.get(name);
        if (!connector) return;

        const entry = {
            timestamp: new Date().toISOString(),
            message
        };

        connector.logs.push(entry);
        if (connector.logs.length > this.maxLogs) {
            connector.logs.shift();
        }

        console.log(`[Connector:${name}] ${message}`);
        this.emit('connector-log', { name, ...entry });
    }

    getLogs(name, limit = 50) {
        const connector = this.connectors.get(name);
        if (!connector) return [];
        return connector.logs.slice(-limit);
    }
}

module.exports = ConnectorRuntime;
