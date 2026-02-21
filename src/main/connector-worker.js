const { workerData, parentPort } = require('worker_threads');

/**
 * Connector Worker - runs inside a worker_thread
 * 
 * Loads a connector script, provides it a context object for
 * invoking the LLM, accessing config, and logging.
 */

const { scriptPath, config, connectorName } = workerData;

// Pending invoke requests (requestId -> {resolve, reject})
const pendingInvokes = new Map();
let invokeCounter = 0;

// Context object provided to the connector's start() function
const context = {
    config,
    connectorName,

    /**
     * Invoke the LLM pipeline with a prompt. Returns the response string.
     */
    async invoke(prompt) {
        return new Promise((resolve, reject) => {
            const requestId = ++invokeCounter;
            pendingInvokes.set(requestId, { resolve, reject });

            parentPort.postMessage({
                type: 'invoke',
                requestId,
                prompt
            });

            // Timeout after 2 minutes
            setTimeout(() => {
                if (pendingInvokes.has(requestId)) {
                    pendingInvokes.delete(requestId);
                    reject(new Error('LLM invoke timeout (120s)'));
                }
            }, 120000);
        });
    },

    /**
     * Log a message (visible in connector logs in UI)
     */
    log(message) {
        parentPort.postMessage({ type: 'log', message: String(message) });
    }
};

// Handle responses from main process
parentPort.on('message', async (msg) => {
    switch (msg.type) {
        case 'invoke-response':
            const pending = pendingInvokes.get(msg.requestId);
            if (pending) {
                pendingInvokes.delete(msg.requestId);
                if (msg.error) {
                    pending.reject(new Error(msg.error));
                } else {
                    pending.resolve(msg.response);
                }
            }
            break;

        case 'stop':
            // Call connector's stop() if available
            try {
                if (connectorModule && typeof connectorModule.stop === 'function') {
                    await connectorModule.stop();
                }
            } catch (e) {
                parentPort.postMessage({ type: 'error', error: `Stop error: ${e.message}` });
            }
            process.exit(0);
            break;
    }
});

// Load and start the connector
let connectorModule;

async function main() {
    try {
        // Dynamic require of the connector script
        connectorModule = require(scriptPath);

        if (typeof connectorModule.start !== 'function') {
            throw new Error('Connector must export a start(context) function');
        }

        // Send metadata to main process
        parentPort.postMessage({
            type: 'started',
            meta: {
                name: connectorModule.name || connectorName,
                description: connectorModule.description || '',
                configSchema: connectorModule.configSchema || {}
            }
        });

        // Start the connector
        await connectorModule.start(context);

    } catch (error) {
        parentPort.postMessage({
            type: 'start-failed',
            error: error.message
        });
        process.exit(1);
    }
}

main();
