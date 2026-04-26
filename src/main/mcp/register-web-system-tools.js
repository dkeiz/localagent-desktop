function registerWebSystemTools(server) {
  server.registerTool('fetch_url', {
    name: 'fetch_url',
    description: 'Fetch raw content from a URL. Returns truncated response text and stores the full response in a temp file.',
    userDescription: 'Retrieves raw content from a web page or API endpoint',
    example: 'TOOL:fetch_url{"url":"https://example.com"}',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (GET, POST, etc.)', default: 'GET' }
      },
      required: ['url']
    }
  }, async (params) => {
    const fetch = require('node-fetch');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const response = await fetch(params.url, { method: params.method || 'GET' });
    const text = await response.text();

    try {
      const workDir = server._sessionWorkspace?.getWorkspacePath?.() || os.tmpdir();
      const lastFetchedPath = path.join(workDir, 'last_fetched.txt');
      fs.writeFileSync(lastFetchedPath, text, 'utf-8');
      server._lastFetchedPath = lastFetchedPath;
      server._lastFetchedUrl = params.url;
    } catch (error) {
      console.error('[fetch_url] Failed to persist fetched content:', error.message);
    }

    return { url: params.url, status: response.status, content: text.substring(0, 5000) };
  });
}

module.exports = { registerWebSystemTools };
