function registerWebSystemTools(server) {
  server.registerTool('fetch_url', {
    name: 'fetch_url',
    description: 'Fetch raw content from a URL. Returns the full HTML or API response (truncated to 5000 chars in output). The full fetched content is also saved to a temp file so you can process it with extract_text or search_fetched_text. Use after search_web_bing or search_web_insta to read a specific page.',
    userDescription: 'Retrieves the raw content of a web page or API endpoint',
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

  server.registerTool('get_public_ip', {
    name: 'get_public_ip',
    description: 'Get the public IP address',
    userDescription: 'Returns the current public IP address and location info',
    example: 'TOOL:get_public_ip{}',
    inputSchema: { type: 'object' }
  }, async () => {
    const fetch = require('node-fetch');
    const response = await fetch('https://ipapi.co/json/');
    return await response.json();
  });

  server.registerTool('download_file', {
    name: 'download_file',
    description: 'Download a file from URL',
    userDescription: 'Downloads a file from a URL and saves it locally',
    example: 'TOOL:download_file{"url":"https://example.com/file.zip","savePath":"C:/Downloads/file.zip"}',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to download from' },
        savePath: { type: 'string', description: 'Local path to save the file' }
      },
      required: ['url', 'savePath']
    }
  }, async (params) => {
    const fetch = require('node-fetch');
    const fs = require('fs');
    const response = await fetch(params.url);
    const buffer = await response.buffer();
    fs.writeFileSync(params.savePath, buffer);
    return { url: params.url, savedTo: params.savePath, size: buffer.length };
  });

  server.registerTool('extract_text', {
    name: 'extract_text',
    description: 'Convert the last fetched URL content from HTML to clean readable text. Strips scripts, styles, navigation, footers, and all HTML tags. Use after fetch_url when you need readable text instead of raw HTML. Returns plain text truncated to max_length.',
    userDescription: 'Extracts readable text from last fetched page (strips HTML)',
    example: 'TOOL:extract_text{"max_length":3000}',
    inputSchema: {
      type: 'object',
      properties: {
        max_length: { type: 'number', description: 'Maximum characters of text to return', default: 5000 }
      }
    }
  }, async (params) => {
    const fs = require('fs');
    const maxLen = params.max_length || 5000;

    if (!server._lastFetchedPath) {
      return { error: 'No content available. Use fetch_url first to fetch a page.' };
    }

    try {
      const html = fs.readFileSync(server._lastFetchedPath, 'utf-8');
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, maxLen);

      return {
        source_url: server._lastFetchedUrl || 'unknown',
        text_length: text.length,
        text
      };
    } catch (error) {
      return { error: `Failed to read fetched content: ${error.message}` };
    }
  });

  server.registerTool('search_fetched_text', {
    name: 'search_fetched_text',
    description: 'Search for keywords within the last fetched or extracted page content. Returns matching passages with surrounding context. Use after fetch_url or extract_text to find specific information in a large page without reading the entire content.',
    userDescription: 'Search for keywords in last fetched page content',
    example: 'TOOL:search_fetched_text{"query":"pricing","context_chars":200}',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or keyword to search for in the fetched content' },
        context_chars: { type: 'number', description: 'Number of characters of context to show around each match', default: 200 }
      },
      required: ['query']
    }
  }, async (params) => {
    const fs = require('fs');
    const contextChars = params.context_chars || 200;

    if (!server._lastFetchedPath) {
      return { error: 'No content available. Use fetch_url first to fetch a page.' };
    }

    try {
      const content = fs.readFileSync(server._lastFetchedPath, 'utf-8');
      const plainText = content
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const query = params.query.toLowerCase();
      const matches = [];
      let searchFrom = 0;

      while (matches.length < 10) {
        const index = plainText.toLowerCase().indexOf(query, searchFrom);
        if (index === -1) break;

        const start = Math.max(0, index - contextChars);
        const end = Math.min(plainText.length, index + query.length + contextChars);
        const context = plainText.substring(start, end);

        matches.push({
          position: index,
          context: (start > 0 ? '...' : '') + context + (end < plainText.length ? '...' : '')
        });

        searchFrom = index + query.length;
      }

      return {
        query: params.query,
        source_url: server._lastFetchedUrl || 'unknown',
        total_matches: matches.length,
        matches
      };
    } catch (error) {
      return { error: `Failed to search fetched content: ${error.message}` };
    }
  });

  server.registerTool('open_url', {
    name: 'open_url',
    description: 'Open a URL in the default browser',
    userDescription: 'Opens a URL in the system default web browser',
    example: 'TOOL:open_url{"url":"https://google.com"}',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open' }
      },
      required: ['url']
    }
  }, async (params) => {
    const { shell } = require('electron');
    await shell.openExternal(params.url);
    return { opened: true, url: params.url };
  });

  server.registerTool('clipboard_read', {
    name: 'clipboard_read',
    description: 'Read text from clipboard',
    userDescription: 'Reads the current text content from the system clipboard',
    example: 'TOOL:clipboard_read{}',
    inputSchema: { type: 'object' }
  }, async () => {
    const { clipboard } = require('electron');
    return { text: clipboard.readText() };
  });

  server.registerTool('clipboard_write', {
    name: 'clipboard_write',
    description: 'Write text to clipboard',
    userDescription: 'Copies text to the system clipboard',
    example: 'TOOL:clipboard_write{"text":"Hello World"}',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to copy to clipboard' }
      },
      required: ['text']
    }
  }, async (params) => {
    const { clipboard } = require('electron');
    clipboard.writeText(params.text);
    return { written: true, length: params.text.length };
  });

  server.registerTool('get_memory_usage', {
    name: 'get_memory_usage',
    description: 'Get system memory usage',
    userDescription: 'Returns current system memory usage statistics',
    example: 'TOOL:get_memory_usage{}',
    inputSchema: { type: 'object' }
  }, async () => {
    const os = require('os');
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      total: Math.round(total / 1024 / 1024) + ' MB',
      free: Math.round(free / 1024 / 1024) + ' MB',
      used: Math.round(used / 1024 / 1024) + ' MB',
      percentUsed: Math.round((used / total) * 100) + '%'
    };
  });

  server.registerTool('get_disk_space', {
    name: 'get_disk_space',
    description: 'Get disk space information',
    userDescription: 'Returns disk space usage for the current drive',
    example: 'TOOL:get_disk_space{}',
    inputSchema: { type: 'object' }
  }, async () => {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec('wmic logicaldisk get size,freespace,caption', (error, stdout) => {
        if (error) {
          resolve({ error: error.message });
        } else {
          resolve({ diskInfo: stdout.trim() });
        }
      });
    });
  });
}

module.exports = { registerWebSystemTools };
