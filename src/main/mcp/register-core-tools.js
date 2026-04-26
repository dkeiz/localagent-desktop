function registerCoreTools(server) {
  server.registerTool('current_time', {
    name: 'current_time',
    description: 'Get current server time in ISO format',
    userDescription: 'Returns the current date and time on the server',
    example: 'TOOL:current_time{}',
    exampleOutput: '"2025-10-05T15:05:30.123Z"',
    inputSchema: { type: 'object' }
  }, async () => {
    return new Date().toISOString();
  });

  server.registerTool('search_web_bing', {
    name: 'search_web_bing',
    description: 'General web search using Bing RSS. Returns titles, URLs, and text snippets for any query. Best for news, tutorials, current events, general questions, and broad research. Use this as your primary built-in search tool.',
    userDescription: 'Broad web search via Bing — works for any query type',
    example: 'TOOL:search_web_bing{"query":"latest AI news 2026"}',
    exampleOutput: '{"query":"latest AI news 2026","backend":"bing_rss","results":[{"title":"...","url":"https://...","snippet":"..."}]}',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — any topic, question, or keywords' },
        max_results: { type: 'number', description: 'Maximum number of results to return', default: 8 },
        site: { type: 'string', description: 'Optional: restrict results to a domain (e.g. "github.com", "stackoverflow.com")' }
      },
      required: ['query']
    }
  }, async (params) => {
    const fetch = require('node-fetch');
    const AbortController = globalThis.AbortController || require('abort-controller');
    const maxResults = params.max_results || 8;

    let searchQuery = params.query;
    if (params.site) {
      searchQuery += ` site:${params.site}`;
    }

    const feedUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}&format=rss`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(feedUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalAgent/1.0)' }
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Bing RSS error: HTTP ${response.status}`);
      }

      const xml = await response.text();
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];
        const title = (itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
                       itemXml.match(/<title>(.*?)<\/title>/i) || [])[1] || '';
        const link = (itemXml.match(/<link>(.*?)<\/link>/i) || [])[1] || '';
        const desc = (itemXml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i) ||
                      itemXml.match(/<description>(.*?)<\/description>/i) || [])[1] || '';

        const snippet = desc
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (link && !items.some(item => item.url === link)) {
          items.push({ title: title.trim(), url: link.trim(), snippet });
        }
      }

      return {
        query: params.query,
        backend: 'bing_rss',
        results: items.slice(0, maxResults)
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        return { query: params.query, backend: 'bing_rss', results: [], error: 'Search timed out after 8 seconds' };
      }
      throw error;
    }
  });

  server.registerTool('calendar_op', {
    name: 'calendar_op',
    description: 'Unified calendar operations. Actions: create, list.',
    userDescription: 'Manage calendar events',
    example: 'TOOL:calendar_op{"action":"list","limit":10}',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Operation: create | list' },
        title: { type: 'string', description: 'Event title for create action' },
        start_time: { type: 'string', description: 'Start time for create action' },
        duration_minutes: { type: 'number', description: 'Duration for create action', default: 60 },
        description: { type: 'string', description: 'Description for create action', default: '' },
        limit: { type: 'number', description: 'Max items for list action', default: 10 }
      },
      required: ['action']
    }
  }, async (params) => {
    const action = String(params.action || '').toLowerCase();
    if (action === 'create') {
      if (!params.title || !params.start_time) {
        return { error: 'title and start_time are required for create action' };
      }
      const event = await server.db.addCalendarEvent({
        title: params.title,
        start_time: params.start_time,
        duration_minutes: params.duration_minutes ?? 60,
        description: params.description ?? ''
      });
      server.emit('calendar-update');
      return event;
    }

    if (action === 'list') {
      const events = await server.db.getCalendarEvents();
      return params.limit ? events.slice(0, params.limit) : events;
    }

    return { error: `Unknown calendar action: ${params.action}` };
  });

  server.registerTool('todo_op', {
    name: 'todo_op',
    description: 'Unified todo operations. Actions: create, list, complete.',
    userDescription: 'Manage todo items',
    example: 'TOOL:todo_op{"action":"list"}',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Operation: create | list | complete' },
        task: { type: 'string', description: 'Task description for create action' },
        priority: { type: 'number', description: 'Priority for create action', default: 1 },
        due_date: { type: 'string', description: 'Due date for create action' },
        id: { type: 'number', description: 'Todo ID for complete action' }
      },
      required: ['action']
    }
  }, async (params) => {
    const action = String(params.action || '').toLowerCase();
    if (action === 'create') {
      if (!params.task) return { error: 'task is required for create action' };
      return server.db.addTodo({
        task: params.task,
        priority: params.priority ?? 1,
        due_date: params.due_date ?? null
      });
    }

    if (action === 'list') {
      const todos = await server.db.getTodos();
      return todos.map(todo => ({
        id: todo.id,
        task: todo.task,
        completed: todo.completed === 1 || todo.completed === true,
        priority: todo.priority,
        due_date: todo.due_date
      }));
    }

    if (action === 'complete') {
      if (!params.id) return { error: 'id is required for complete action' };
      return server.db.updateTodo(params.id, { completed: true });
    }

    return { error: `Unknown todo action: ${params.action}` };
  });

  server.registerTool('conversation_history', {
    name: 'conversation_history',
    description: 'Get conversation history',
    userDescription: 'Retrieves past conversation messages, limited to a specific number',
    example: 'TOOL:conversation_history{"limit":20}',
    exampleOutput: '[{"role":"user","content":"Hello"},{"role":"assistant","content":"Hi there!"}]',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of messages to retrieve (e.g., 10, 20, 50)',
          default: 50
        }
      }
    }
  }, async (params) => {
    return await server.db.getConversations(params.limit);
  });
}

module.exports = { registerCoreTools };
