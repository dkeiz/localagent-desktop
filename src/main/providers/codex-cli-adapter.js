const { spawn, spawnSync } = require('child_process');
const path = require('path');
const BaseAdapter = require('./base-adapter');

const DEFAULT_MODELS = [
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex'
];

class CodexCliAdapter extends BaseAdapter {
    constructor(db) {
        super('codex-cli', db);
        this.child = null;
    }

    async call(messages, options = {}) {
        const signal = this._startRequest();
        const prompt = this._formatPrompt(messages);
        const model = options.model || await this.db.getSetting('llm.openai.codexModel') || DEFAULT_MODELS[0];
        const cwd = await this._getWorkingDirectory();
        const sandbox = await this.db.getSetting('llm.openai.codexSandbox') || 'read-only';
        const searchEnabled = (await this.db.getSetting('llm.openai.codexSearch')) === 'true';
        const timeoutMs = Number(await this.db.getSetting('llm.openai.codexTimeoutMs')) || 120000;
        const maxOutput = Number(await this.db.getSetting('llm.openai.codexMaxOutput')) || 120000;

        const args = [];
        if (searchEnabled) args.push('--search');
        args.push(
            'exec',
            '--cd', cwd,
            '--sandbox', this._sanitizeSandbox(sandbox),
            '--color', 'never',
            '-m', model
        );
        args.push(prompt);

        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const child = spawn('codex', args, {
                cwd,
                windowsHide: true,
                shell: false,
                env: { ...process.env, NO_COLOR: '1' }
            });

            this.child = child;
            const timer = setTimeout(() => {
                if (settled) return;
                child.kill();
                settled = true;
                this._endRequest();
                reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            signal.addEventListener('abort', () => {
                if (settled) return;
                child.kill();
                settled = true;
                clearTimeout(timer);
                this._endRequest();
                resolve(this._normalizeResponse({
                    content: '[Generation stopped by user]',
                    model,
                    stopped: true
                }));
            });

            child.stdout.on('data', chunk => {
                stdout = this._appendLimited(stdout, chunk, maxOutput);
            });
            child.stderr.on('data', chunk => {
                stderr = this._appendLimited(stderr, chunk, maxOutput);
            });
            child.on('error', error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this._endRequest();
                reject(new Error(`Codex CLI failed to start: ${error.message}`));
            });
            child.on('close', code => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this._endRequest();
                if (code !== 0) {
                    return reject(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout}`.trim()));
                }
                resolve(this._normalizeResponse({
                    content: this._cleanOutput(stdout) || stderr.trim(),
                    model
                }));
            });
        });
    }

    async getModels() {
        return DEFAULT_MODELS;
    }

    stop() {
        if (this.child) {
            this.child.kill();
            this.child = null;
        }
        return super.stop();
    }

    async getStatus() {
        const version = spawnSync('codex', ['--version'], {
            encoding: 'utf8',
            windowsHide: true
        });
        if (version.error) {
            return {
                installed: false,
                loggedIn: false,
                error: version.error.message,
                models: DEFAULT_MODELS
            };
        }

        const auth = spawnSync('codex', ['exec', '--help'], {
            encoding: 'utf8',
            windowsHide: true
        });
        return {
            installed: true,
            loggedIn: auth.status === 0,
            version: `${version.stdout || version.stderr}`.trim(),
            models: DEFAULT_MODELS
        };
    }

    async launchLogin() {
        const command = process.platform === 'win32'
            ? process.env.ComSpec || 'cmd.exe'
            : 'codex';
        const args = process.platform === 'win32'
            ? ['/c', 'start', 'Codex Login', 'codex', 'login']
            : ['login'];
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        });
        child.unref();
        return { launched: true };
    }

    async _getWorkingDirectory() {
        const configured = await this.db.getSetting('llm.openai.codexCwd');
        return configured || path.resolve(process.cwd());
    }

    _formatPrompt(messages = []) {
        return messages.map(message => {
            const role = String(message.role || 'user').toUpperCase();
            return `${role}:\n${message.content || ''}`;
        }).join('\n\n');
    }

    _appendLimited(current, chunk, maxOutput) {
        const next = current + chunk.toString();
        return next.length > maxOutput ? next.slice(next.length - maxOutput) : next;
    }

    _cleanOutput(output) {
        return String(output || '').trim();
    }

    _sanitizeSandbox(value) {
        return ['read-only', 'workspace-write', 'danger-full-access'].includes(value)
            ? value
            : 'read-only';
    }

}

module.exports = {
    CodexCliAdapter,
    DEFAULT_MODELS
};
