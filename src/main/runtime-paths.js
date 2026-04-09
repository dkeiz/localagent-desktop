const path = require('path');

function buildRuntimePaths(options = {}) {
  const agentinRoot = options.agentinRoot || path.resolve(__dirname, '../../agentin');
  const rendererPath = options.rendererPath || path.join(__dirname, '../renderer/index.html');
  const promptBasePath = options.promptBasePath || path.join(agentinRoot, 'prompts');
  const promptTemplatesDir = options.promptTemplatesDir || path.join(promptBasePath, 'templates');
  const sessionWorkspaceBase = options.sessionWorkspaceBase || path.join(agentinRoot, 'workspaces');
  const knowledgeBaseDir = options.knowledgeBaseDir || path.join(agentinRoot, 'knowledge');
  const agentBasePath = options.agentBasePath || path.join(agentinRoot, 'agents');
  const connectorsDir = options.connectorsDir || path.join(agentinRoot, 'connectors');
  const pluginsDir = options.pluginsDir || path.join(agentinRoot, 'plugins');
  const memoryBasePath = options.memoryBasePath || path.join(agentinRoot, 'memory');
  const userProfilePath = options.userProfilePath || path.join(agentinRoot, 'userabout', 'memoryaboutuser.md');

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
    userProfilePath,
    backgroundNotifyPromptPath: options.backgroundNotifyPromptPath || path.join(promptTemplatesDir, 'background-notify.md'),
    backgroundDaemonBasePath: options.backgroundDaemonBasePath || path.join(agentBasePath, 'pro', 'background-daemon'),
    coldStartTemplatePath: options.coldStartTemplatePath || path.join(promptTemplatesDir, 'cold-start-discovery.md')
  };
}

module.exports = {
  buildRuntimePaths
};
