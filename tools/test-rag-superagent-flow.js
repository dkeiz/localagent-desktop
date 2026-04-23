const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class RuntimeClient {
  constructor(scriptPath, dataDir) {
    this.scriptPath = scriptPath;
    this.dataDir = dataDir;
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    if (this.proc) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.proc = fork(this.scriptPath, [], {
      cwd: path.dirname(this.scriptPath),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    this.proc.stdout?.on('data', (chunk) => process.stdout.write(String(chunk)));
    this.proc.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));
    this.proc.on('message', (message) => this._onMessage(message));
    this.proc.on('exit', () => {
      for (const [, pending] of this.pending) {
        pending.reject(new Error('Runtime exited before completing request'));
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  _onMessage(message) {
    const id = message?.id;
    if (!id || !this.pending.has(id)) return;
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || 'Runtime call failed'));
  }

  call(action, payload = {}) {
    if (!this.proc) throw new Error('Runtime not started');
    const id = `test-${Date.now()}-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.send({ id, action, payload });
    });
  }

  async stop() {
    if (!this.proc) return;
    try {
      await this.call('shutdown', {});
    } catch {
      // ignore shutdown race
    }
    this.proc.kill();
    this.proc = null;
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const scriptPath = path.join(root, 'agentin', 'plugins', 'agent-rag-studio', 'rag-runtime-process.js');
  const samplePath = path.join(root, 'agentin', 'plugins', 'agent-rag-studio', 'data', 'tech-support-menu-20.json');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localagent-rag-superagent-'));
  const dataDir = path.join(tmpDir, 'rag-data');

  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
  const client = new RuntimeClient(scriptPath, dataDir);
  client.start();

  try {
    await client.call('init', {
      dataDir,
      config: {
        ollamaUrl: 'http://127.0.0.1:11434',
        embeddingModel: 'nomic-embed-text'
      }
    });

    const ingest = await client.call('dataset_op', {
      action: 'ingest',
      dataset_id: 'ds-tech-support-menu-20',
      title: 'Tech Support Answers Menu (20)',
      entries: sample.entries
    });
    assert(ingest?.dataset?.chunk_count === 20, 'Expected 20 chunks from 20 menu entries');

    await client.call('mode_op', {
      action: 'create',
      mode_id: 'mode-tech-support-rag-answer',
      name: 'Tech Support RAG Answer',
      guidance: 'Return one best instruction from the support answer menu.',
      top_k: 1,
      min_score: 0.15,
      dataset_ids: ['ds-tech-support-menu-20']
    });
    await client.call('mode_op', {
      action: 'activate',
      mode_id: 'mode-tech-support-rag-answer'
    });
    await client.call('answer_mode', {
      action: 'set',
      mode: 'rag_only'
    });

    const answer = await client.call('answer', {
      query: 'I forgot my password and cannot sign in'
    });
    assert(answer?.success === true, 'Expected successful rag_answer');
    assert(
      String(answer?.answer || '').toLowerCase().includes('reset password'),
      'Expected password-reset instruction in rag_answer'
    );

    const noRag = await client.call('answer', {
      query: '-norag'
    });
    assert(noRag?.response_mode === 'agent', 'Expected response mode to switch back to agent');

    console.log('[test-rag-superagent-flow] PASS');
  } finally {
    await client.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[test-rag-superagent-flow] FAIL: ${error.message}`);
  process.exit(1);
});
