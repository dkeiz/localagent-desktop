const fs = require('fs').promises;
const path = require('path');
const { resolvePathTokens } = require('../path-tokens');

async function resolveToolPath(server, rawPath) {
  const context = server.getCurrentAgentContext?.()
    || server.getCurrentExecutionContext?.()
    || {};
  const filePath = await resolvePathTokens(rawPath, {
    agentManager: server._agentManager || null,
    sessionWorkspace: server._sessionWorkspace || null,
    context
  });
  if (/\{[a-z_]+\}/i.test(filePath)) {
    throw new Error(`Unresolved path token in path: ${rawPath}`);
  }
  return filePath;
}

function countOccurrences(content, search) {
  if (!search) return 0;
  let count = 0;
  let offset = 0;
  while (offset < content.length) {
    const index = content.indexOf(search, offset);
    if (index === -1) break;
    count++;
    offset = index + search.length;
  }
  return count;
}

function registerFileTools(server) {
  server.registerTool('read_file', {
    name: 'read_file',
    description: 'Read contents of a file',
    userDescription: 'Reads and returns the contents of a text file',
    example: 'TOOL:read_file{"path":"{agent_tasks}/plan.md"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path or path token to the file to read' }
      },
      required: ['path']
    }
  }, async (params) => {
    const filePath = await resolveToolPath(server, params.path);
    const content = await fs.readFile(filePath, 'utf-8');
    return { path: filePath, requestedPath: params.path, content, size: content.length };
  });

  server.registerTool('write_file', {
    name: 'write_file',
    description: 'Write content to a file',
    userDescription: 'Writes text content to a file (creates or overwrites)',
    example: 'TOOL:write_file{"path":"{agent_tasks}/plan.md","content":"Hello World"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path or path token to the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
        append: { type: 'boolean', description: 'Append to file instead of overwrite', default: false }
      },
      required: ['path', 'content']
    }
  }, async (params) => {
    const filePath = await resolveToolPath(server, params.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (params.append) {
      await fs.appendFile(filePath, params.content, 'utf-8');
    } else {
      await fs.writeFile(filePath, params.content, 'utf-8');
    }
    return { path: filePath, requestedPath: params.path, written: params.content.length, append: params.append || false };
  });

  server.registerTool('edit_file', {
    name: 'edit_file',
    description: 'Edit an existing text file by applying exact search-and-replace operations',
    userDescription: 'Surgically edits a text file using exact substring replacements',
    example: 'TOOL:edit_file{"path":"{agent_tasks}/plan.md","edits":[{"search":"Status: pending","replace":"Status: done"}]}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path or path token to the file to edit' },
        edits: {
          type: 'array',
          description: 'Sequential exact replacements. Each edit has search and replace strings.'
        }
      },
      required: ['path', 'edits']
    }
  }, async (params) => {
    if (!Array.isArray(params.edits)) {
      throw new Error('edit_file requires edits to be an array');
    }

    const filePath = await resolveToolPath(server, params.path);
    let content = await fs.readFile(filePath, 'utf-8');
    const applied = [];
    const skipped = [];

    for (let index = 0; index < params.edits.length; index++) {
      const edit = params.edits[index] || {};
      const search = String(edit.search ?? '');
      const replace = String(edit.replace ?? '');
      if (!search) {
        skipped.push({ index, reason: 'empty_search' });
        continue;
      }

      const matchCount = countOccurrences(content, search);
      if (matchCount === 0) {
        skipped.push({ index, search, reason: 'not_found' });
        continue;
      }

      content = content.replace(search, replace);
      applied.push({ index, search, replacements: 1, matchCount });
    }

    await fs.writeFile(filePath, content, 'utf-8');
    return {
      path: filePath,
      requestedPath: params.path,
      editsApplied: applied.length,
      editsSkipped: skipped.length,
      applied,
      skipped,
      newSize: content.length
    };
  });

  server.registerTool('list_directory', {
    name: 'list_directory',
    description: 'List contents of a directory',
    userDescription: 'Lists all files and folders in a directory',
    example: 'TOOL:list_directory{"path":"{agent_home}"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path or path token to the directory to list' }
      },
      required: ['path']
    }
  }, async (params) => {
    const dirPath = await resolveToolPath(server, params.path);
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    return items.map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, item.name)
    }));
  });

  server.registerTool('file_exists', {
    name: 'file_exists',
    description: 'Check if a file or directory exists',
    userDescription: 'Checks whether a file or directory exists at the given path',
    example: 'TOOL:file_exists{"path":"C:/Users/data.txt"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path or path token to check' }
      },
      required: ['path']
    }
  }, async (params) => {
    const filePath = await resolveToolPath(server, params.path);
    try {
      const stat = await fs.stat(filePath);
      return { path: filePath, requestedPath: params.path, exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size };
    } catch {
      return { path: filePath, requestedPath: params.path, exists: false };
    }
  });

  server.registerTool('delete_file', {
    name: 'delete_file',
    description: 'Delete a file',
    userDescription: 'Deletes a file at the given path',
    example: 'TOOL:delete_file{"path":"C:/Users/temp.txt"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path or path token to the file to delete' }
      },
      required: ['path']
    }
  }, async (params) => {
    const filePath = await resolveToolPath(server, params.path);
    await fs.unlink(filePath);
    return { deleted: true, path: filePath, requestedPath: params.path };
  });
}

module.exports = { registerFileTools };
