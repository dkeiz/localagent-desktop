const fs = require('fs');
const path = require('path');
const KnowledgeManager = require('../../src/main/knowledge-manager');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'knowledge-safety-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const db = new MemoryDB();
    const tempBase = makeTempDir('localagent-knowledge-');
    const manager = new KnowledgeManager(db);
    manager.baseDir = tempBase;
    manager.libraryDir = path.join(tempBase, 'library');
    manager.stagingDir = path.join(tempBase, 'staging');

    try {
      await manager.initialize();

      await manager.createItem({
        title: 'Active Knowledge',
        content: 'hello',
        confidence: 1.0,
        slug: 'active-knowledge'
      });

      let activeRejectError = null;
      try {
        await manager.rejectStaged('active-knowledge');
      } catch (error) {
        activeRejectError = error;
      }

      assert.ok(activeRejectError, 'Expected rejecting active knowledge to fail');
      assert.includes(activeRejectError.message, 'not staged', 'Expected staged-only rejection guard');
      assert.ok(db.get('SELECT * FROM knowledge_items WHERE slug = ?', ['active-knowledge']), 'Active DB record should remain');
      assert.ok(fs.existsSync(path.join(manager.libraryDir, 'active-knowledge')), 'Active folder should remain');

      await manager.createItem({
        title: 'Staged Knowledge',
        content: 'draft',
        confidence: 0.2,
        slug: 'staged-knowledge'
      });

      await manager.rejectStaged('staged-knowledge');
      assert.equal(
        Boolean(db.get('SELECT * FROM knowledge_items WHERE slug = ?', ['staged-knowledge'])),
        false,
        'Rejected staged DB record should be deleted'
      );
      assert.equal(
        fs.existsSync(path.join(manager.stagingDir, 'staged-knowledge')),
        false,
        'Rejected staged folder should be removed'
      );
    } finally {
      fs.rmSync(tempBase, { recursive: true, force: true });
    }
  }
};
