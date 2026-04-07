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

  server.registerTool('current_weather', {
    name: 'current_weather',
    description: 'Get current weather for a city using wttr.in API',
    userDescription: 'Fetches current weather conditions (temperature, humidity, conditions) for any city worldwide',
    example: 'TOOL:current_weather{"city":"London"}',
    exampleOutput: '{"temp":"15","condition":"Partly cloudy","humidity":"65","city":"London"}',
    inputSchema: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'City name (e.g., "London", "New York", "Tokyo", "Moscow")',
          default: 'Moscow'
        }
      }
    }
  }, async ({ city }) => {
    const fetch = require('node-fetch');
    const response = await fetch(`http://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
    const data = await response.json();
    return {
      temp: data.current_condition[0].temp_C,
      condition: data.current_condition[0].weatherDesc[0].value,
      humidity: data.current_condition[0].humidity,
      city
    };
  });

  server.registerTool('search_web_insta', {
    name: 'search_web_insta',
    description: 'Quick factual lookup using DuckDuckGo Instant Answer API. Best for definitions, entity info, and well-known topics (e.g. "Python programming language", "Albert Einstein"). Returns an abstract summary and related topics. If results are empty or say "No direct answer found", use search_web_bing instead for broader results.',
    userDescription: 'Quick factual search via DuckDuckGo — best for known entities and definitions',
    example: 'TOOL:search_web_insta{"query":"Python programming language"}',
    exampleOutput: '{"query":"Python programming language","abstract":"Python is a high-level...","abstractSource":"Wikipedia","relatedTopics":["Python syntax","Python libraries"]}',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — works best with entity names, definitions, or well-known topics' }
      },
      required: ['query']
    }
  }, async ({ query }) => {
    const fetch = require('node-fetch');
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
    if (!response.ok) throw new Error(`Search API error: ${response.status}`);
    const data = await response.json();
    return {
      query,
      abstract: data.Abstract || 'No direct answer found',
      abstractSource: data.AbstractSource || '',
      relatedTopics: (data.RelatedTopics || []).slice(0, 5).map(t => t.Text || t.Name).filter(Boolean)
    };
  });

  server.registerTool('search_web_bing', {
    name: 'search_web_bing',
    description: 'General web search using Bing RSS. Returns titles, URLs, and text snippets for any query. Best for news, tutorials, current events, general questions, and broad research. Use this as your primary search tool. If this fails, try search_web_insta as a fallback for factual/entity queries.',
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

  server.registerTool('create_calendar_event', {
    name: 'create_calendar_event',
    description: 'Create a calendar event with title, date/time, and optional description',
    userDescription: 'Creates a new calendar event with a title, start time, duration, and optional notes',
    example: 'TOOL:create_calendar_event{"title":"Team Meeting","start_time":"2025-10-06 14:00","duration_minutes":60,"description":"Discuss Q4 goals"}',
    exampleOutput: '{"id":1,"title":"Team Meeting","start_time":"2025-10-06 14:00","duration_minutes":60,"description":"Discuss Q4 goals"}',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title (e.g., "Team Meeting", "Doctor Appointment")' },
        start_time: { type: 'string', description: 'Start time in format "YYYY-MM-DD HH:MM" or ISO format (e.g., "2025-10-06 14:00" or "2025-10-06T14:00:00Z")' },
        duration_minutes: { type: 'number', description: 'Event duration in minutes (e.g., 30, 60, 90)', default: 60 },
        description: { type: 'string', description: 'Optional event notes or description', default: '' }
      },
      required: ['title', 'start_time']
    }
  }, async (params) => {
    const event = await server.db.addCalendarEvent(params);
    server.emit('calendar-update');
    return event;
  });

  server.registerTool('calendar_write', {
    name: 'calendar_write',
    description: 'Alias for create_calendar_event - creates a new calendar event',
    userDescription: 'Alternative name for create_calendar_event - creates a new calendar event',
    example: 'TOOL:calendar_write{"title":"Lunch","start_time":"2025-10-06 12:00"}',
    exampleOutput: '{"id":2,"title":"Lunch","start_time":"2025-10-06 12:00","duration_minutes":60}',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start_time: { type: 'string', description: 'Start time in format "YYYY-MM-DD HH:MM"' },
        duration_minutes: { type: 'number', description: 'Duration in minutes', default: 60 },
        description: { type: 'string', description: 'Event notes', default: '' }
      },
      required: ['title', 'start_time']
    }
  }, async (params) => {
    return await server.db.addCalendarEvent(params);
  });

  server.registerTool('list_calendar_events', {
    name: 'list_calendar_events',
    description: 'List calendar events with optional filters',
    userDescription: 'Retrieves a list of upcoming calendar events, optionally limited to a specific number',
    example: 'TOOL:list_calendar_events{"limit":5}',
    exampleOutput: '[{"id":1,"title":"Meeting","start_time":"2025-10-06 14:00"},{"id":2,"title":"Lunch","start_time":"2025-10-06 12:00"}]',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of events to return (e.g., 5, 10, 20)', default: 10 }
      }
    }
  }, async (params) => {
    const events = await server.db.getCalendarEvents();
    return params.limit ? events.slice(0, params.limit) : events;
  });

  server.registerTool('calendar_read', {
    name: 'calendar_read',
    description: 'Alias for list_calendar_events - list calendar events',
    userDescription: 'Alternative name for list_calendar_events - retrieves calendar events',
    example: 'TOOL:calendar_read{"limit":10}',
    exampleOutput: '[{"id":1,"title":"Meeting","start_time":"2025-10-06 14:00"}]',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of events to return', default: 10 }
      }
    }
  }, async (params) => {
    const events = await server.db.getCalendarEvents();
    return params.limit ? events.slice(0, params.limit) : events;
  });

  server.registerTool('todo_create', {
    name: 'todo_create',
    description: 'Create a new todo item',
    userDescription: 'Creates a new task/todo item with optional priority and due date',
    example: 'TOOL:todo_create{"task":"Buy groceries","priority":2,"due_date":"2025-10-06"}',
    exampleOutput: '{"id":1,"task":"Buy groceries","completed":false,"priority":2}',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task description (e.g., "Buy groceries", "Finish report")' },
        priority: { type: 'number', description: 'Task priority from 1-5 (1=low, 5=high)', default: 1 },
        due_date: { type: 'string', description: 'Optional due date in YYYY-MM-DD format', default: null }
      },
      required: ['task']
    }
  }, async (params) => {
    return await server.db.addTodo(params);
  });

  server.registerTool('todo_list', {
    name: 'todo_list',
    description: 'List all todo items',
    userDescription: 'Retrieves all tasks/todo items, sorted by priority and creation date',
    example: 'TOOL:todo_list{}',
    exampleOutput: '[{"id":1,"task":"Buy groceries","completed":false},{"id":2,"task":"Call doctor","completed":true}]',
    inputSchema: { type: 'object' }
  }, async () => {
    const todos = await server.db.getTodos();
    return todos.map(todo => ({
      id: todo.id,
      task: todo.task,
      completed: todo.completed === 1 || todo.completed === true,
      priority: todo.priority,
      due_date: todo.due_date
    }));
  });

  server.registerTool('todo_complete', {
    name: 'todo_complete',
    description: 'Mark a todo item as complete',
    userDescription: 'Marks a specific task/todo item as completed by its ID',
    example: 'TOOL:todo_complete{"id":1}',
    exampleOutput: '{"id":1,"task":"Buy groceries","completed":true}',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The ID number of the todo item to mark complete' }
      },
      required: ['id']
    }
  }, async (params) => {
    return await server.db.updateTodo(params.id, { completed: true });
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
