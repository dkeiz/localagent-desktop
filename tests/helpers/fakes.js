const fs = require('fs');
const os = require('os');
const path = require('path');

class MemoryDB {
  constructor() {
    this.settings = new Map();
    this.plugins = new Map();
    this.knowledge = new Map();
  }

  get(sql, args = []) {
    if (sql.includes('FROM plugins')) {
      const id = args[0];
      const plugin = this.plugins.get(id);
      if (!plugin) return undefined;
      if (sql.includes('SELECT status')) return { status: plugin.status };
      if (sql.includes('SELECT id')) return { id: plugin.id };
      return plugin;
    }

    if (sql.includes('SELECT * FROM knowledge_items WHERE slug = ?')) {
      return this.knowledge.get(args[0]);
    }

    if (sql.includes('SELECT slug FROM knowledge_items WHERE slug = ?')) {
      return this.knowledge.get(args[0]);
    }

    if (sql.includes("COUNT(*) as count FROM knowledge_items WHERE status = 'active'")) {
      return { count: Array.from(this.knowledge.values()).filter(item => item.status === 'active').length };
    }

    if (sql.includes("COUNT(*) as count FROM knowledge_items WHERE status = 'staged'")) {
      return { count: Array.from(this.knowledge.values()).filter(item => item.status === 'staged').length };
    }

    if (sql.includes('COUNT(*) as count FROM knowledge_items')) {
      return { count: this.knowledge.size };
    }

    return undefined;
  }

  all(sql, args = []) {
    if (sql.includes('SELECT key, value FROM settings WHERE key LIKE')) {
      const prefix = String(args[0] || '').replace('%', '');
      return Array.from(this.settings.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value }));
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
      const plugin = this.plugins.get(id) || { id, name: id, version: '0.0.0', error: null };
      plugin.status = status;
      plugin.error = error;
      this.plugins.set(id, plugin);
      return;
    }

    if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
      this.settings.set(args[0], String(args[1]));
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
    }
  }

  async getSetting(key) {
    return this.settings.get(key) || null;
  }

  async setSetting(key, value) {
    this.settings.set(key, String(value));
    return { key, value };
  }

  async saveSetting(key, value) {
    return this.setSetting(key, value);
  }

  async getCustomTools() {
    return [];
  }
}

class TestContainer {
  constructor(map) {
    this.map = map;
  }

  get(name) {
    if (!(name in this.map)) {
      throw new Error(`Missing service ${name}`);
    }
    return this.map[name];
  }

  optional(name) {
    return this.map[name] || null;
  }
}

class PluginCapabilityStub {
  constructor() {
    this.safeTools = new Map();
  }

  registerCustomTool(toolName, isSafe = false) {
    this.safeTools.set(toolName, isSafe);
  }

  unregisterCustomTool(toolName) {
    this.safeTools.delete(toolName);
  }

  isToolActive(toolName) {
    return this.safeTools.get(toolName) === true;
  }

  getActiveTools() {
    return Array.from(this.safeTools.entries())
      .filter(([, isSafe]) => isSafe === true)
      .map(([toolName]) => toolName);
  }

  getGroupsConfig() {
    return [];
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = {
  MemoryDB,
  TestContainer,
  PluginCapabilityStub,
  makeTempDir
};
