const fs = require('fs');
const path = require('path');
const PluginManager = require('../src/main/plugin-manager');
const KnowledgeManager = require('../src/main/knowledge-manager');

class MockDB {
  constructor() {
    this.plugins = new Map();
    this.settings = new Map();
    this.knowledge = new Map();
  }

  get(sql, args = []) {
    if (sql.includes('FROM plugins')) {
      const id = args[0];
      const p = this.plugins.get(id);
      if (!p) return undefined;
      if (sql.includes('SELECT status')) return { status: p.status };
      if (sql.includes('SELECT id')) return { id: p.id };
      return p;
    }
    if (sql.includes('FROM knowledge_items')) {
      const slug = args[0];
      return this.knowledge.get(slug);
    }
    if (sql.includes("COUNT(*) as count FROM knowledge_items WHERE status = 'active'")) {
      let count = 0;
      for (const it of this.knowledge.values()) if (it.status === 'active') count++;
      return { count };
    }
    if (sql.includes("COUNT(*) as count FROM knowledge_items WHERE status = 'staged'")) {
      let count = 0;
      for (const it of this.knowledge.values()) if (it.status === 'staged') count++;
      return { count };
    }
    if (sql.includes('COUNT(*) as count FROM knowledge_items')) {
      return { count: this.knowledge.size };
    }
    return undefined;
  }

  all(sql, args = []) {
    if (sql.includes('SELECT key, value FROM settings WHERE key LIKE')) {
      const prefix = (args[0] || '').replace('%', '');
      const out = [];
      for (const [k, v] of this.settings.entries()) {
        if (k.startsWith(prefix)) out.push({ key: k, value: v });
      }
      return out;
    }
    if (sql.includes('SELECT * FROM knowledge_items')) {
      return Array.from(this.knowledge.values());
    }
    return [];
  }

  run(sql, args = []) {
    if (sql.startsWith('INSERT INTO plugins')) {
      const [id, name, version, status] = args;
      this.plugins.set(id, { id, name, version, status, error: null });
      return;
    }
    if (sql.startsWith('UPDATE plugins SET status')) {
      const [status, error, id] = args;
      const p = this.plugins.get(id) || { id, name: id, version: '0.0.0' };
      p.status = status;
      p.error = error;
      this.plugins.set(id, p);
      return;
    }
    if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
      this.settings.set(args[0], args[1]);
      return;
    }
    if (sql.includes('INSERT OR REPLACE INTO knowledge_items')) {
      const [slug, title, category, status, tags, source, confidence, folderPath] = args;
      this.knowledge.set(slug, {
        slug,
        title,
        category,
        status,
        tags,
        source,
        confidence,
        folder_path: folderPath
      });
      return;
    }
    if (sql.startsWith('UPDATE knowledge_items SET folder_path')) {
      const [folderPath, slug] = args;
      const item = this.knowledge.get(slug);
      if (item) item.folder_path = folderPath;
      return;
    }
    if (sql.startsWith('UPDATE knowledge_items SET status = ?, confirmed_at')) {
      const [status, slug] = args;
      const item = this.knowledge.get(slug);
      if (item) item.status = status;
      return;
    }
    if (sql.startsWith('DELETE FROM knowledge_items')) {
      this.knowledge.delete(args[0]);
      return;
    }
  }
}

class MockMCP {
  constructor() {
    this.tools = new Map();
  }

  registerTool(name, definition, handler) {
    this.tools.set(name, { definition, handler });
  }
}

class MockContainer {
  constructor(map) {
    this.map = map;
  }

  get(name) {
    if (!(name in this.map)) throw new Error(`Missing service ${name}`);
    return this.map[name];
  }

  optional(name) {
    return this.map[name] || null;
  }

  register(name, value) {
    this.map[name] = value;
    return this;
  }
}

async function main() {
  const db = new MockDB();
  const mcpServer = new MockMCP();
  const container = new MockContainer({ db, mcpServer });

  const knowledgeManager = new KnowledgeManager(db);
  const tmpBase = path.join(__dirname, `tmp-knowledge-${Date.now()}`);
  knowledgeManager.baseDir = tmpBase;
  knowledgeManager.libraryDir = path.join(tmpBase, 'library');
  knowledgeManager.stagingDir = path.join(tmpBase, 'staging');
  container.register('knowledgeManager', knowledgeManager);
  await knowledgeManager.initialize();

  const pluginManager = new PluginManager(container);
  await pluginManager.initialize();

  const plugins = pluginManager.listPlugins();
  if (plugins.length === 0) {
    throw new Error('No plugins discovered in agentin/plugins');
  }

  const testPlugin = plugins.find(plugin => plugin.id === 'test-plugin');
  if (!testPlugin) {
    throw new Error('Expected test-plugin to be discoverable');
  }

  const id = testPlugin.id;
  await pluginManager.enablePlugin(id);
  const detail = pluginManager.getPluginDetail(id);

  if (!detail.handlers || detail.handlers.length === 0) {
    throw new Error('Plugin enable did not register handlers');
  }
  if (!mcpServer.tools.has('plugin_test_plugin_hello')) {
    throw new Error('Expected test-plugin tool not registered');
  }
  if (!db.knowledge.has('plugin-test-plugin')) {
    throw new Error('Expected plugin knowledge item to be generated');
  }

  await pluginManager.disablePlugin(id);
  if (mcpServer.tools.has('plugin_test_plugin_hello')) {
    throw new Error('Expected plugin tool to be removed on disable');
  }

  const slug = `tmp-smoke-${Date.now()}`;
  await knowledgeManager.createItem({
    title: 'Tmp Smoke',
    content: 'line1\nline2',
    slug,
    confidence: 0.2
  });
  await knowledgeManager.promoteStaged(slug);
  const stats = knowledgeManager.getStats();

  if (typeof stats.total !== 'number') {
    throw new Error('Knowledge stats invalid');
  }

  fs.rmSync(tmpBase, { recursive: true, force: true });
  console.log(`[test-plugin-knowledge] PASS: plugins=${plugins.length}, stats=${JSON.stringify(stats)}`);
}

main().catch((err) => {
  console.error('[test-plugin-knowledge] FAIL:', err);
  process.exit(1);
});
