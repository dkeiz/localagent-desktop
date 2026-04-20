const fs = require('fs');
const path = require('path');
const MCPServer = require('../../src/main/mcp-server');
const InferenceDispatcher = require('../../src/main/inference-dispatcher');
const SessionWorkspace = require('../../src/main/session-workspace');
const { MemoryDB, makeTempDir } = require('../helpers/fakes');

module.exports = {
  name: 'path-boundary-contract',
  tags: ['contract', 'fast'],
  async run({ assert }) {
    const tempDir = makeTempDir('localagent-path-boundary-');
    const agentinRoot = path.join(tempDir, 'agentin');
    const agentBase = path.join(agentinRoot, 'agents');
    const workspaceBase = path.join(agentinRoot, 'workspaces');
    const promptDir = path.join(agentinRoot, 'prompts');
    const promptPath = path.join(promptDir, 'system.md');
    const rulesPath = path.join(promptDir, 'rules');
    const agentHome = path.join(agentBase, 'pro', 'research-orchestrator');

    fs.mkdirSync(agentHome, { recursive: true });
    fs.mkdirSync(workspaceBase, { recursive: true });
    fs.mkdirSync(rulesPath, { recursive: true });

    const db = new MemoryDB();
    const server = new MCPServer(db, null);
    const sessionWorkspace = new SessionWorkspace(workspaceBase);
    const agentManager = {
      basePath: agentBase,
      sessionWorkspace,
      resolveAgentFolder: async () => agentHome,
      getAgent: async () => ({ id: 1, name: 'Research Orchestrator' }),
      getAgentSystemPrompt: () => 'Agent prompt',
      getAgentMemory: () => ''
    };

    const aiService = {
      systemPrompt: 'Base system prompt',
      getCurrentProvider: () => 'test-provider',
      getSystemPrompt: () => 'Base system prompt',
      setSystemPrompt: async () => ({ ok: true })
    };

    server.setSessionWorkspace(sessionWorkspace);
    server.setAgentManager(agentManager);
    server.setAIService(aiService);
    server.setCurrentSessionId('s-path');
    server.setCurrentAgentContext({ agentId: 1, sessionId: 's-path' });
    server.setPromptFileManager({
      systemPromptPath: promptPath,
      rulesPath,
      ensureDirectories() {
        fs.mkdirSync(promptDir, { recursive: true });
        fs.mkdirSync(rulesPath, { recursive: true });
      },
      async saveSystemPrompt(content) {
        fs.mkdirSync(path.dirname(promptPath), { recursive: true });
        fs.writeFileSync(promptPath, content, 'utf-8');
      },
      getSafeFilename(name, priority = 1) {
        const safe = String(name || 'rule').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return `${String(priority).padStart(3, '0')}-${safe}.md`;
      }
    });

    const dispatcher = new InferenceDispatcher(aiService, db, server);
    dispatcher.setAgentManager(agentManager);

    try {
      const writeRes = await server.executeTool('write_file', {
        path: '{workspace}/nested/demo.txt',
        content: 'alpha\nbeta'
      });
      assert.includes(writeRes.result.path, '{workspace}/nested/demo.txt', 'write_file should return tokenized path');
      assert.ok(!writeRes.result.path.includes('\\'), 'write_file path should use forward slashes');

      const listRes = await server.executeTool('list_directory', { path: '{workspace}/nested' });
      assert.equal(listRes.result.length, 1, 'Expected one file in nested workspace directory');
      assert.includes(listRes.result[0].path, '{workspace}/nested/demo.txt', 'list_directory should return tokenized child path');
      assert.ok(!listRes.result[0].path.includes('\\'), 'list_directory path should use forward slashes');

      const commandRes = await server.executeTool('run_command', {
        command: 'Write-Output tokenized-workspace',
        cwd: '{workspace}',
        output_to_file: true
      });
      assert.equal(commandRes.result.output_mode, 'file', 'run_command should return workspace file output');
      assert.includes(commandRes.result.cwd, '{workspace}', 'run_command should return tokenized cwd');
      assert.includes(commandRes.result.file_path, '{workspace}/', 'run_command should return tokenized output file');
      assert.ok(!commandRes.result.file_path.includes('\\'), 'run_command file path should use forward slashes');

      const listWorkspaceRes = await server.executeTool('list_workspace', {});
      assert.ok(listWorkspaceRes.result.fileCount > 0, 'Expected list_workspace to return files');
      assert.ok(
        listWorkspaceRes.result.files.every(file => file.path.startsWith('{workspace}/')),
        'list_workspace paths should be tokenized'
      );

      await server.executeTool('write_file', {
        path: '{workspace}/search-target.log',
        content: 'alpha marker line'
      });
      const searchWorkspaceRes = await server.executeTool('search_workspace', { query: 'alpha' });
      assert.ok(searchWorkspaceRes.result.resultCount > 0, 'Expected search_workspace match');
      assert.ok(
        searchWorkspaceRes.result.results.every(result => result.path.startsWith('{workspace}/')),
        'search_workspace paths should be tokenized'
      );

      const promptToolRes = await server.executeTool('modify_system_prompt', { content: 'Prompt updated for test' });
      assert.includes(promptToolRes.result.path, '{agentin}/prompts/system.md', 'modify_system_prompt should return tokenized prompt path');

      const prompt = await dispatcher._buildSystemPrompt({
        includeTools: false,
        includeRules: false,
        includeEnv: true,
        skipMemoryOnStart: false,
        sessionId: 's-path',
        agentId: 1
      });
      assert.includes(prompt, 'Working Directory: {agentin}', 'Environment should reference tokenized working directory');
      assert.includes(prompt, '{agentin}/agent.md', 'memory_on_start should reference tokenized paths');
      assert.includes(prompt, '<path_tokens>', 'Prompt should include path token instructions');
      assert.ok(!prompt.includes(agentinRoot), 'Prompt should not leak absolute agentin root');
      assert.ok(!prompt.includes(workspaceBase), 'Prompt should not leak absolute workspace root');
      assert.ok(!prompt.includes('\\workspaces\\'), 'Prompt should avoid Windows absolute formatting');

      const malformed = String.raw`TOOL:read_file{"path":"C:\Users\Кириллица\notes.txt"}`;
      const repairedCalls = server.parseToolCall(malformed);
      assert.equal(repairedCalls.length, 1, 'Expected malformed Windows path JSON to be repaired');
      assert.includes(repairedCalls[0].params.path, 'C:', 'Expected repaired path to preserve drive prefix');
      assert.includes(repairedCalls[0].params.path, 'notes.txt', 'Expected repaired path to preserve file name');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};
