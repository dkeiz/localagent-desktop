function registerFileTools(server) {
  server.registerTool('read_file', {
    name: 'read_file',
    description: 'Read contents of a file',
    userDescription: 'Reads and returns the contents of a text file',
    example: 'TOOL:read_file{"path":"C:/Users/data.txt"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path to the file to read' }
      },
      required: ['path']
    }
  }, async (params) => {
    const fs = require('fs').promises;
    const content = await fs.readFile(params.path, 'utf-8');
    return { path: params.path, content, size: content.length };
  });

  server.registerTool('write_file', {
    name: 'write_file',
    description: 'Write content to a file',
    userDescription: 'Writes text content to a file (creates or overwrites)',
    example: 'TOOL:write_file{"path":"C:/Users/output.txt","content":"Hello World"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full path to the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
        append: { type: 'boolean', description: 'Append to file instead of overwrite', default: false }
      },
      required: ['path', 'content']
    }
  }, async (params) => {
    const fs = require('fs').promises;
    if (params.append) {
      await fs.appendFile(params.path, params.content, 'utf-8');
    } else {
      await fs.writeFile(params.path, params.content, 'utf-8');
    }
    return { path: params.path, written: params.content.length, append: params.append || false };
  });

  server.registerTool('list_directory', {
    name: 'list_directory',
    description: 'List contents of a directory',
    userDescription: 'Lists all files and folders in a directory',
    example: 'TOOL:list_directory{"path":"C:/Users"}',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory to list' }
      },
      required: ['path']
    }
  }, async (params) => {
    const fs = require('fs').promises;
    const path = require('path');
    const items = await fs.readdir(params.path, { withFileTypes: true });
    return items.map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: path.join(params.path, item.name)
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
        path: { type: 'string', description: 'Path to check' }
      },
      required: ['path']
    }
  }, async (params) => {
    const fs = require('fs').promises;
    try {
      const stat = await fs.stat(params.path);
      return { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory(), size: stat.size };
    } catch {
      return { exists: false };
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
        path: { type: 'string', description: 'Path to the file to delete' }
      },
      required: ['path']
    }
  }, async (params) => {
    const fs = require('fs').promises;
    await fs.unlink(params.path);
    return { deleted: true, path: params.path };
  });
}

module.exports = { registerFileTools };
