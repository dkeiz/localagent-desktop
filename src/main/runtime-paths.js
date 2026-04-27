const fs = require('fs');
const path = require('path');

function resolveDefaultAgentinRoot(options = {}) {
  if (options.agentinRoot) {
    return options.agentinRoot;
  }

  const packagedCandidates = [];
  if (process.resourcesPath) {
    // Standard packaged location when included in resources.
    packagedCandidates.push(path.join(process.resourcesPath, 'agentin'));
    // electron-builder `extraFiles` commonly lands next to the executable.
    packagedCandidates.push(path.join(path.dirname(process.resourcesPath), 'agentin'));
  }

  for (const candidate of packagedCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.resolve(__dirname, '../../agentin');
}

function buildRuntimePaths(options = {}) {
  const agentinRoot = resolveDefaultAgentinRoot(options);
  const rendererPath = options.rendererPath || path.join(__dirname, '../renderer/index.html');
  const promptBasePath = options.promptBasePath || path.join(agentinRoot, 'prompts');
  const promptTemplatesDir = options.promptTemplatesDir || path.join(promptBasePath, 'templates');
  const sessionWorkspaceBase = options.sessionWorkspaceBase || path.join(agentinRoot, 'workspaces');
  const knowledgeBaseDir = options.knowledgeBaseDir || path.join(agentinRoot, 'knowledge');
  const agentBasePath = options.agentBasePath || path.join(agentinRoot, 'agents');
  const connectorsDir = options.connectorsDir || path.join(agentinRoot, 'connectors');
  const pluginsDir = options.pluginsDir || path.join(agentinRoot, 'plugins');
  const memoryBasePath = options.memoryBasePath || path.join(agentinRoot, 'memory');
  const tasksBasePath = options.tasksBasePath || path.join(agentinRoot, 'tasks');
  const tasksQueueFile = options.tasksQueueFile || path.join(tasksBasePath, 'tasks.md');
  const userProfilePath = options.userProfilePath || path.join(agentinRoot, 'userabout', 'memoryaboutuser.md');
  const userDataPath = options.userDataPath
    || options.app?.getPath?.('userData')
    || null;

  return {
    agentinRoot,
    rendererPath,
    promptBasePath,
    promptTemplatesDir,
    sessionWorkspaceBase,
    knowledgeBaseDir,
    agentBasePath,
    connectorsDir,
    pluginsDir,
    memoryBasePath,
    tasksBasePath,
    tasksQueueFile,
    userDataPath,
    userProfilePath,
    backgroundNotifyPromptPath: options.backgroundNotifyPromptPath || path.join(promptTemplatesDir, 'background-notify.md'),
    backgroundDaemonBasePath: options.backgroundDaemonBasePath || path.join(agentBasePath, 'pro', 'background-daemon'),
    coldStartTemplatePath: options.coldStartTemplatePath || path.join(promptTemplatesDir, 'cold-start-discovery.md')
  };
}

module.exports = {
  buildRuntimePaths
};
