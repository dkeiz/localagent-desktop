const { EventEmitter } = require('events');

class MCPServer extends EventEmitter {
  constructor(db, capabilityManager = null) {
    super();
    this.db = db;
    this.capabilityManager = capabilityManager;
    this.aiService = null;
    this.tools = new Map();
    this.toolStates = new Map();
    this.proxyServers = new Map();
    this.initializeBuiltInTools();
  }

  setAIService(aiService) {
    this.aiService = aiService;
  }

  setAgentLoop(agentLoop) {
    this._agentLoop = agentLoop;
  }

  setCurrentSessionId(sessionId) {
    this._currentSessionId = sessionId;
  }

  setConnectorRuntime(connectorRuntime) {
    this._connectorRuntime = connectorRuntime;
  }

  setSessionWorkspace(sessionWorkspace) {
    this._sessionWorkspace = sessionWorkspace;
  }

  initializeBuiltInTools() {
    // System tools
    this.registerTool('current_time', {
      name: 'current_time',
      description: 'Get current server time in ISO format',
      userDescription: 'Returns the current date and time on the server',
      example: 'TOOL:current_time{}',
      exampleOutput: '"2025-10-05T15:05:30.123Z"',
      inputSchema: { type: 'object' }
    }, async () => {
      return new Date().toISOString();
    });

    this.registerTool('current_weather', {
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
        city: city
      };
    });

    this.registerTool('search_web', {
      name: 'search_web',
      description: 'Search the web using DuckDuckGo instant answer API',
      userDescription: 'Searches the web and returns summarized results',
      example: 'TOOL:search_web{"query":"latest news about AI"}',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
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

    // Calendar tools
    this.registerTool('create_calendar_event', {
      name: 'create_calendar_event',
      description: 'Create a calendar event with title, date/time, and optional description',
      userDescription: 'Creates a new calendar event with a title, start time, duration, and optional notes',
      example: 'TOOL:create_calendar_event{"title":"Team Meeting","start_time":"2025-10-06 14:00","duration_minutes":60,"description":"Discuss Q4 goals"}',
      exampleOutput: '{"id":1,"title":"Team Meeting","start_time":"2025-10-06 14:00","duration_minutes":60,"description":"Discuss Q4 goals"}',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Event title (e.g., "Team Meeting", "Doctor Appointment")'
          },
          start_time: {
            type: 'string',
            description: 'Start time in format "YYYY-MM-DD HH:MM" or ISO format (e.g., "2025-10-06 14:00" or "2025-10-06T14:00:00Z")'
          },
          duration_minutes: {
            type: 'number',
            description: 'Event duration in minutes (e.g., 30, 60, 90)',
            default: 60
          },
          description: {
            type: 'string',
            description: 'Optional event notes or description',
            default: ''
          }
        },
        required: ['title', 'start_time']
      }
    }, async (params) => {
      const event = await this.db.addCalendarEvent(params);
      this.emit('calendar-update');
      return event;
    });

    this.registerTool('calendar_write', {
      name: 'calendar_write',
      description: 'Alias for create_calendar_event - creates a new calendar event',
      userDescription: 'Alternative name for create_calendar_event - creates a new calendar event',
      example: 'TOOL:calendar_write{"title":"Lunch","start_time":"2025-10-06 12:00"}',
      exampleOutput: '{"id":2,"title":"Lunch","start_time":"2025-10-06 12:00","duration_minutes":60}',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Event title'
          },
          start_time: {
            type: 'string',
            description: 'Start time in format "YYYY-MM-DD HH:MM"'
          },
          duration_minutes: {
            type: 'number',
            description: 'Duration in minutes',
            default: 60
          },
          description: {
            type: 'string',
            description: 'Event notes',
            default: ''
          }
        },
        required: ['title', 'start_time']
      }
    }, async (params) => {
      return await this.db.addCalendarEvent(params);
    });

    this.registerTool('list_calendar_events', {
      name: 'list_calendar_events',
      description: 'List calendar events with optional filters',
      userDescription: 'Retrieves a list of upcoming calendar events, optionally limited to a specific number',
      example: 'TOOL:list_calendar_events{"limit":5}',
      exampleOutput: '[{"id":1,"title":"Meeting","start_time":"2025-10-06 14:00"},{"id":2,"title":"Lunch","start_time":"2025-10-06 12:00"}]',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of events to return (e.g., 5, 10, 20)',
            default: 10
          }
        }
      }
    }, async (params) => {
      const events = await this.db.getCalendarEvents();
      return events.slice(0, params.limit || 10);
    });

    this.registerTool('calendar_read', {
      name: 'calendar_read',
      description: 'Alias for list_calendar_events - retrieves calendar events',
      userDescription: 'Alternative name for list_calendar_events - retrieves calendar events',
      example: 'TOOL:calendar_read{"limit":10}',
      exampleOutput: '[{"id":1,"title":"Meeting","start_time":"2025-10-06 14:00"}]',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of events to return',
            default: 10
          }
        }
      }
    }, async (params) => {
      const events = await this.db.getCalendarEvents();
      return events.slice(0, params.limit || 10);
    });

    // Todo tools
    this.registerTool('todo_create', {
      name: 'todo_create',
      description: 'Create a new todo item',
      userDescription: 'Creates a new todo/task item with optional priority and due date',
      example: 'TOOL:todo_create{"task":"Buy groceries","priority":2,"due_date":"2025-10-07"}',
      exampleOutput: '{"id":1,"task":"Buy groceries","priority":2,"due_date":"2025-10-07","completed":false}',
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Task description (e.g., "Buy groceries", "Call dentist", "Finish report")'
          },
          priority: {
            type: 'number',
            description: 'Priority level from 1 (lowest) to 5 (highest)',
            default: 1
          },
          due_date: {
            type: 'string',
            format: 'date-time',
            description: 'Due date in format "YYYY-MM-DD" or ISO format (optional)'
          }
        },
        required: ['task']
      }
    }, async (params) => {
      return await this.db.addTodo(params);
    });

    this.registerTool('todo_list', {
      name: 'todo_list',
      description: 'List todo items with optional filters',
      userDescription: 'Retrieves all todo items, optionally filtered by completion status or priority level',
      example: 'TOOL:todo_list{"completed":false,"priority":3}',
      exampleOutput: '[{"id":1,"task":"Buy groceries","priority":3,"completed":false}]',
      inputSchema: {
        type: 'object',
        properties: {
          completed: {
            type: 'boolean',
            description: 'Filter by completion: true (completed only), false (incomplete only), or omit for all'
          },
          priority: {
            type: 'number',
            description: 'Filter by priority level (1-5), or omit for all priorities'
          }
        }
      }
    }, async (params) => {
      const todos = await this.db.getTodos();
      if (params.completed !== undefined) {
        return todos.filter(t => t.completed === params.completed);
      }
      if (params.priority !== undefined) {
        return todos.filter(t => t.priority === params.priority);
      }
      return todos;
    });

    this.registerTool('todo_complete', {
      name: 'todo_complete',
      description: 'Mark a todo item as completed',
      userDescription: 'Marks a specific todo item as completed using its ID',
      example: 'TOOL:todo_complete{"id":1}',
      exampleOutput: '{"id":1,"task":"Buy groceries","completed":true}',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'The ID number of the todo item to mark as complete'
          }
        },
        required: ['id']
      }
    }, async (params) => {
      return await this.db.updateTodo(params.id, { completed: true });
    });

    // Conversation tools
    this.registerTool('conversation_history', {
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
      return await this.db.getConversations(params.limit);
    });

    // System tools
    this.registerTool('get_system_prompt', {
      name: 'get_system_prompt',
      description: 'Get the current system prompt',
      userDescription: 'Returns the current system prompt configuration used by the AI',
      example: 'TOOL:get_system_prompt{}',
      exampleOutput: '"You are a helpful AI assistant..."',
      inputSchema: { type: 'object' }
    }, async () => {
      return this.aiService.getSystemPrompt();
    });

    // Agent self-modification tools
    this.registerTool('modify_system_prompt', {
      name: 'modify_system_prompt',
      description: 'Modify the system prompt. Agent can update its own behavior instructions.',
      userDescription: 'Allows the agent to update its own system prompt, changing its core behavior. Changes are saved to agentin/prompts/system.md',
      example: 'TOOL:modify_system_prompt{"content":"You are a helpful coding assistant..."}',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The new system prompt content'
          },
          append: {
            type: 'boolean',
            description: 'If true, append to existing prompt instead of replacing',
            default: false
          }
        },
        required: ['content']
      }
    }, async (params) => {
      const fs = require('fs');
      const path = require('path');
      const promptPath = path.join(process.cwd(), 'agentin', 'prompts', 'system.md');

      let newContent = params.content;
      if (params.append) {
        const existing = this.aiService.getSystemPrompt();
        newContent = existing + '\n\n' + params.content;
      }

      // Write to file
      fs.writeFileSync(promptPath, newContent, 'utf-8');
      // Update in memory
      await this.aiService.setSystemPrompt(newContent);
      await this.db.setSetting('system_prompt', newContent);

      return { success: true, message: 'System prompt updated', path: promptPath };
    });

    this.registerTool('manage_rule', {
      name: 'manage_rule',
      description: 'Create, update, or delete a behavioral rule. Rules modify agent behavior dynamically.',
      userDescription: 'Manage prompt rules that affect agent behavior. Creates files in agentin/prompts/rules/',
      example: 'TOOL:manage_rule{"action":"create","name":"Code Style","content":"Always use TypeScript...","active":true}',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'delete', 'toggle'],
            description: 'Action to perform on the rule'
          },
          name: {
            type: 'string',
            description: 'Name of the rule'
          },
          content: {
            type: 'string',
            description: 'Rule content (for create/update)'
          },
          active: {
            type: 'boolean',
            description: 'Whether the rule is active',
            default: true
          },
          priority: {
            type: 'number',
            description: 'Priority order (lower = higher priority)',
            default: 1
          }
        },
        required: ['action', 'name']
      }
    }, async (params) => {
      const fs = require('fs');
      const path = require('path');
      const rulesPath = path.join(process.cwd(), 'agentin', 'prompts', 'rules');

      // Ensure directory exists
      if (!fs.existsSync(rulesPath)) {
        fs.mkdirSync(rulesPath, { recursive: true });
      }

      const safeName = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const priority = params.priority || 1;
      const filename = `${String(priority).padStart(3, '0')}-${safeName}.md`;
      const filePath = path.join(rulesPath, filename);

      switch (params.action) {
        case 'create':
        case 'update':
          const fileContent = `---
name: ${params.name}
active: ${params.active !== false}
priority: ${priority}
---
${params.content || ''}`;
          fs.writeFileSync(filePath, fileContent, 'utf-8');

          // Also update DB
          const existing = await this.db.get('SELECT id FROM prompt_rules WHERE name = ?', [params.name]);
          if (existing) {
            await this.db.updatePromptRule(existing.id, { name: params.name, content: params.content });
            await this.db.togglePromptRule(existing.id, params.active !== false);
          } else {
            await this.db.addPromptRule({ name: params.name, content: params.content, type: 'rule' });
          }
          return { success: true, action: params.action, path: filePath };

        case 'delete':
          // Find and delete file with matching name
          const files = fs.readdirSync(rulesPath).filter(f => f.includes(safeName));
          files.forEach(f => fs.unlinkSync(path.join(rulesPath, f)));

          // Delete from DB
          const dbRule = await this.db.get('SELECT id FROM prompt_rules WHERE name = ?', [params.name]);
          if (dbRule) await this.db.deletePromptRule(dbRule.id);
          return { success: true, action: 'delete', deleted: files };

        case 'toggle':
          // Update file
          if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf-8');
            content = content.replace(/active:\s*(true|false)/, `active: ${params.active}`);
            fs.writeFileSync(filePath, content, 'utf-8');
          }

          // Update DB
          const toggleRule = await this.db.get('SELECT id FROM prompt_rules WHERE name = ?', [params.name]);
          if (toggleRule) await this.db.togglePromptRule(toggleRule.id, params.active);
          return { success: true, action: 'toggle', active: params.active };

        default:
          return { error: 'Invalid action' };
      }
    });

    this.registerTool('list_rules', {
      name: 'list_rules',
      description: 'List all behavioral rules and their status',
      userDescription: 'Shows all prompt rules that can affect agent behavior',
      example: 'TOOL:list_rules{}',
      inputSchema: { type: 'object' }
    }, async () => {
      const rules = await this.db.getPromptRules();
      return rules.map(r => ({
        name: r.name,
        active: r.active === 1 || r.active === true,
        preview: r.content?.substring(0, 100) + (r.content?.length > 100 ? '...' : '')
      }));
    });

    this.registerTool('get_current_provider', {
      name: 'get_current_provider',
      description: 'Get the current AI provider',
      userDescription: 'Returns which AI provider is currently active (e.g., Ollama, LM Studio, OpenRouter)',
      example: 'TOOL:get_current_provider{}',
      exampleOutput: '"ollama"',
      inputSchema: { type: 'object' }
    }, async () => {
      return this.aiService.getCurrentProvider();
    });

    // Search tools
    this.registerTool('search_conversations', {
      name: 'search_conversations',
      description: 'Search through conversation history',
      userDescription: 'Searches past conversations for messages containing specific keywords or phrases',
      example: 'TOOL:search_conversations{"query":"weather","limit":5}',
      exampleOutput: '[{"role":"user","content":"What\'s the weather?","timestamp":"2025-10-05T10:00:00Z"}]',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term or phrase to find in conversation history (e.g., "weather", "meeting", "todo")'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 10
          }
        },
        required: ['query']
      }
    }, async (params) => {
      const convs = await this.db.getConversations(100);
      return convs.filter(c =>
        c.content.toLowerCase().includes(params.query.toLowerCase())
      ).slice(0, params.limit);
    });

    // Math tools
    this.registerTool('calculate', {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      userDescription: 'Evaluates mathematical expressions and returns the result',
      example: 'TOOL:calculate{"expression":"(123 + 456) * 2"}',
      exampleOutput: '{"expression":"(123 + 456) * 2","result":1158}',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate (e.g., "2+2", "(10*5)/2", "Math.sqrt(16)")'
          }
        },
        required: ['expression']
      }
    }, async (params) => {
      try {
        // Safe eval for math only
        const result = Function('"use strict"; return (' + params.expression + ')')();
        return { expression: params.expression, result };
      } catch (e) {
        throw new Error('Invalid math expression');
      }
    });

    // Rule tools
    this.registerTool('list_active_rules', {
      name: 'list_active_rules',
      description: 'List currently active prompt rules',
      userDescription: 'Returns all currently active prompt rules that modify AI behavior',
      example: 'TOOL:list_active_rules{}',
      exampleOutput: '[{"id":1,"name":"Be Concise","content":"Keep responses brief","active":true}]',
      inputSchema: { type: 'object' }
    }, async () => {
      return await this.db.getActivePromptRules();
    });

    this.registerTool('toggle_rule', {
      name: 'toggle_rule',
      description: 'Toggle a prompt rule on or off',
      userDescription: 'Activates or deactivates a specific prompt rule by its ID',
      example: 'TOOL:toggle_rule{"rule_id":1,"active":true}',
      exampleOutput: '{"id":1,"name":"Be Concise","active":true}',
      inputSchema: {
        type: 'object',
        properties: {
          rule_id: {
            type: 'number',
            description: 'The ID number of the rule to toggle'
          },
          active: {
            type: 'boolean',
            description: 'Set to true to activate, false to deactivate'
          }
        },
        required: ['rule_id', 'active']
      }
    }, async (params) => {
      return await this.db.togglePromptRule(params.rule_id, params.active);
    });

    // Stats tools
    this.registerTool('get_stats', {
      name: 'get_stats',
      description: 'Get usage statistics',
      userDescription: 'Returns statistics about conversations, todos, calendar events, and rules',
      example: 'TOOL:get_stats{}',
      exampleOutput: '{"conversations":45,"todos":12,"events":8,"rules":3}',
      inputSchema: { type: 'object' }
    }, async () => {
      const convCount = (await this.db.getConversations(10000)).length;
      const todoCount = (await this.db.getTodos()).length;
      const eventCount = (await this.db.getCalendarEvents()).length;
      const ruleCount = (await this.db.getPromptRules()).length;
      return { conversations: convCount, todos: todoCount, events: eventCount, rules: ruleCount };
    });

    this.registerTool('create_tool', {
      name: 'create_tool',
      description: 'Create a new custom MCP tool',
      userDescription: 'Create a new custom MCP tool',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          code: { type: 'string' },
          input_schema: { type: 'object' }
        },
        required: ['name', 'description', 'code']
      }
    }, async (params) => {
      await this.db.addCustomTool(params);
      this.registerCustomTool(params);
      return { created: true, name: params.name };
    });

    // Special tool for ending tool chains
    this.registerTool('end_answer', {
      name: 'end_answer',
      description: 'IMPORTANT: Use this tool ONLY when you have completed ALL necessary tool calls and are ready to give your final response to the user. Pass your complete, formatted answer in the "answer" parameter. Do NOT use this tool if you still need to call other tools.',
      userDescription: 'Signals completion of tool usage and provides the final answer',
      example: 'TOOL:end_answer{"answer":"Based on the weather data, today will be sunny with a high of 72°F. You should wear light clothing."}',
      inputSchema: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            description: 'Your complete final answer to the user. This should be a well-formatted response that addresses their original question using the information gathered from tools.'
          }
        },
        required: ['answer']
      }
    }, async (params) => {
      return { complete: true, answer: params.answer };
    });

    // AutoMemory tool — toggles idle memory for current session
    this.registerTool('automemory', {
      name: 'automemory',
      description: 'Toggle automatic memory creation during idle periods. Off by default — user must enable. When enabled, after idle_seconds of no user input the agent will automatically summarize the conversation to daily memory.',
      userDescription: 'Enable/disable automatic memory saving during idle chat periods',
      example: 'TOOL:automemory{"enabled":true,"idle_seconds":60}',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'true to enable auto-memory, false to disable'
          },
          idle_seconds: {
            type: 'number',
            description: 'Seconds of idle before triggering memory save',
            default: 60
          }
        },
        required: ['enabled']
      }
    }, async (params) => {
      if (this._agentLoop) {
        const sessionId = this._currentSessionId || 'default';
        return this._agentLoop.setAutoMemory(sessionId, params.enabled, params.idle_seconds || 60);
      }
      return { error: 'Agent loop not initialized' };
    });

    // ============================================
    // CONNECTOR GROUP - Dynamic connector management
    // ============================================

    this.registerTool('create_connector', {
      name: 'create_connector',
      description: 'Create a new connector JS file in agentin/connectors/. The file should export {name, description, configSchema, start(context), stop()}. Use connector_config to store API keys BEFORE creating the file.',
      userDescription: 'Create a new external service connector script',
      example: 'TOOL:create_connector{"name":"my-service","code":"module.exports = { name: \'my-service\', ... }"}',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Connector name (used as filename, no .js extension)' },
          code: { type: 'string', description: 'Full JavaScript source code for the connector' }
        },
        required: ['name', 'code']
      }
    }, async (params) => {
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(__dirname, '../../agentin/connectors', `${params.name}.js`);
      fs.writeFileSync(filePath, params.code, 'utf-8');
      return { success: true, path: filePath, name: params.name };
    });

    this.registerTool('start_connector', {
      name: 'start_connector',
      description: 'Start a connector by name. The connector JS file must exist in agentin/connectors/.',
      userDescription: 'Start an external service connector',
      example: 'TOOL:start_connector{"name":"telegram-bot"}',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Connector name (filename without .js)' }
        },
        required: ['name']
      }
    }, async (params) => {
      if (!this._connectorRuntime) return { error: 'Connector runtime not initialized' };
      return await this._connectorRuntime.startConnector(params.name);
    });

    this.registerTool('stop_connector', {
      name: 'stop_connector',
      description: 'Stop a running connector by name.',
      userDescription: 'Stop a running external service connector',
      example: 'TOOL:stop_connector{"name":"telegram-bot"}',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Connector name to stop' }
        },
        required: ['name']
      }
    }, async (params) => {
      if (!this._connectorRuntime) return { error: 'Connector runtime not initialized' };
      return await this._connectorRuntime.stopConnector(params.name);
    });

    this.registerTool('list_connectors', {
      name: 'list_connectors',
      description: 'List all available connectors and their status (running/stopped/error).',
      userDescription: 'List all external service connectors',
      example: 'TOOL:list_connectors{}',
      inputSchema: { type: 'object' }
    }, async () => {
      if (!this._connectorRuntime) return { error: 'Connector runtime not initialized' };
      return await this._connectorRuntime.listConnectors();
    });

    this.registerTool('connector_config', {
      name: 'connector_config',
      description: 'Set or get configuration values for a connector. API keys and secrets are stored securely in the database, never in connector files.',
      userDescription: 'Manage connector configuration (API keys, settings)',
      example: 'TOOL:connector_config{"name":"telegram-bot","action":"set","key":"botToken","value":"123:ABC"}',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Connector name' },
          action: { type: 'string', enum: ['set', 'get'], description: 'set or get config' },
          key: { type: 'string', description: 'Config key (for set action)' },
          value: { type: 'string', description: 'Config value (for set action)' }
        },
        required: ['name', 'action']
      }
    }, async (params) => {
      if (!this._connectorRuntime) return { error: 'Connector runtime not initialized' };
      if (params.action === 'set') {
        return await this._connectorRuntime.setConfig(params.name, params.key, params.value);
      } else {
        return await this._connectorRuntime.getConfig(params.name);
      }
    });

    // ============================================
    // STORAGE GROUP - File operations
    // ============================================

    this.registerTool('read_file', {
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

    this.registerTool('write_file', {
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

    this.registerTool('list_directory', {
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

    this.registerTool('file_exists', {
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

    this.registerTool('delete_file', {
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

    // ============================================
    // WEB GROUP - Web operations
    // ============================================

    this.registerTool('fetch_url', {
      name: 'fetch_url',
      description: 'Fetch content from a URL',
      userDescription: 'Retrieves the content of a web page or API endpoint',
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
      const response = await fetch(params.url, { method: params.method || 'GET' });
      const text = await response.text();
      return { url: params.url, status: response.status, content: text.substring(0, 5000) };
    });

    this.registerTool('get_public_ip', {
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

    this.registerTool('download_file', {
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

    // ============================================
    // CALL GROUP - External commands
    // ============================================

    this.registerTool('run_command', {
      name: 'run_command',
      description: 'Run a shell command',
      userDescription: 'Executes a shell command and returns the output',
      example: 'TOOL:run_command{"command":"dir"}',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
          cwd: { type: 'string', description: 'Working directory for the command' }
        },
        required: ['command']
      }
    }, async (params) => {
      const { exec } = require('child_process');
      return new Promise((resolve, reject) => {
        exec(params.command, { cwd: params.cwd, timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: error.message, stderr });
          } else {
            resolve({ success: true, stdout, stderr });
          }
        });
      });
    });

    this.registerTool('open_url', {
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

    this.registerTool('clipboard_read', {
      name: 'clipboard_read',
      description: 'Read text from clipboard',
      userDescription: 'Reads the current text content from the system clipboard',
      example: 'TOOL:clipboard_read{}',
      inputSchema: { type: 'object' }
    }, async () => {
      const { clipboard } = require('electron');
      return { text: clipboard.readText() };
    });

    this.registerTool('clipboard_write', {
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

    // ============================================
    // SYSTEM GROUP - Additional system tools
    // ============================================

    this.registerTool('get_memory_usage', {
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

    this.registerTool('get_disk_space', {
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

    // ============================================
    // MEDIA GROUP - Media processing
    // ============================================

    this.registerTool('get_image_info', {
      name: 'get_image_info',
      description: 'Get information about an image file',
      userDescription: 'Returns dimensions and metadata of an image file',
      example: 'TOOL:get_image_info{"path":"C:/Users/photo.jpg"}',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the image file' }
        },
        required: ['path']
      }
    }, async (params) => {
      const fs = require('fs').promises;
      const stat = await fs.stat(params.path);
      return { path: params.path, size: stat.size, modified: stat.mtime };
    });

    // Media tools - use OS default applications
    this.registerTool('open_media', {
      name: 'open_media',
      description: 'Open any media file with the default OS application',
      userDescription: 'Opens a media file (image, video, audio, document) using the default system application',
      example: 'TOOL:open_media{"path":"C:/Users/Music/song.mp3"}',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Full path to the media file to open' }
        },
        required: ['path']
      }
    }, async (params) => {
      const { shell } = require('electron');
      const fs = require('fs');
      const path = require('path');

      // Verify file exists
      if (!fs.existsSync(params.path)) {
        return { success: false, error: `File not found: ${params.path}` };
      }

      // Open with default application
      const result = await shell.openPath(params.path);
      if (result) {
        return { success: false, error: result };
      }

      const ext = path.extname(params.path).toLowerCase();
      const mediaType = {
        '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.flac': 'audio', '.m4a': 'audio',
        '.mp4': 'video', '.avi': 'video', '.mkv': 'video', '.mov': 'video', '.webm': 'video',
        '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.bmp': 'image', '.webp': 'image',
        '.pdf': 'document', '.doc': 'document', '.docx': 'document', '.txt': 'document'
      }[ext] || 'file';

      return { success: true, opened: params.path, type: mediaType };
    });

    this.registerTool('play_audio', {
      name: 'play_audio',
      description: 'Play an audio file with the default music player',
      userDescription: 'Opens and plays an audio file (MP3, WAV, etc.) using the system music player',
      example: 'TOOL:play_audio{"path":"C:/Users/Music/song.mp3"}',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Full path to the audio file' }
        },
        required: ['path']
      }
    }, async (params) => {
      const { shell } = require('electron');
      const fs = require('fs');

      if (!fs.existsSync(params.path)) {
        return { success: false, error: `Audio file not found: ${params.path}` };
      }

      const result = await shell.openPath(params.path);
      return result ? { success: false, error: result } : { success: true, playing: params.path };
    });

    this.registerTool('view_image', {
      name: 'view_image',
      description: 'Open an image file with the default image viewer',
      userDescription: 'Opens an image file using the system image viewer',
      example: 'TOOL:view_image{"path":"C:/Users/Pictures/photo.jpg"}',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Full path to the image file' }
        },
        required: ['path']
      }
    }, async (params) => {
      const { shell } = require('electron');
      const fs = require('fs');

      if (!fs.existsSync(params.path)) {
        return { success: false, error: `Image file not found: ${params.path}` };
      }

      const result = await shell.openPath(params.path);
      return result ? { success: false, error: result } : { success: true, viewing: params.path };
    });

    this.registerTool('screenshot', {
      name: 'screenshot',
      description: 'Take a screenshot',
      userDescription: 'Captures a screenshot and saves it to the specified path',
      example: 'TOOL:screenshot{"savePath":"C:/Users/screenshot.png"}',
      inputSchema: {
        type: 'object',
        properties: {
          savePath: { type: 'string', description: 'Path to save the screenshot' }
        },
        required: ['savePath']
      }
    }, async (params) => {
      const { desktopCapturer } = require('electron');
      const fs = require('fs');
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
      if (sources.length > 0) {
        const image = sources[0].thumbnail.toPNG();
        fs.writeFileSync(params.savePath, image);
        return { success: true, savedTo: params.savePath };
      }
      return { success: false, error: 'No screen found' };
    });

    // Terminal tools - require terminal capability
    this.registerTool('run_command', {
      name: 'run_command',
      description: 'Execute a shell command in the terminal. Returns stdout, stderr, and exit code. SECURITY: This tool requires terminal capability to be enabled.',
      userDescription: 'Runs a shell command and returns its output',
      example: 'TOOL:run_command{"command":"dir","cwd":"C:/Users"}',
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute'
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (optional)'
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)'
          },
          output_to_file: {
            type: 'boolean',
            description: 'Save output to a workspace file instead of returning inline. Auto-triggers when output exceeds 1000 chars. Use for commands with large output (builds, installs, logs).',
            default: false
          }
        },
        required: ['command']
      }
    }, async (params) => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const options = {
        cwd: params.cwd || process.cwd(),
        timeout: params.timeout || 30000,
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
      };

      const OUTPUT_THRESHOLD = 1000; // chars

      try {
        const { stdout, stderr } = await execAsync(params.command, options);
        const fullOutput = (stdout || '') + (stderr ? '\n--- stderr ---\n' + stderr : '');

        // Auto-redirect to file when output is large or explicitly requested
        if (this._sessionWorkspace && (params.output_to_file || fullOutput.length > OUTPUT_THRESHOLD)) {
          const sessionId = this._currentSessionId || 'default';
          const label = params.command.split(/\s+/)[0]; // Use first word of command as label
          const result = this._sessionWorkspace.writeOutput(sessionId, label, fullOutput);
          const lineCount = fullOutput.split('\n').length;
          const summary = fullOutput.substring(0, 500);
          return {
            success: true,
            command: params.command,
            cwd: options.cwd,
            output_mode: 'file',
            file_path: result.filePath,
            file_name: result.fileName,
            file_size: result.size,
            line_count: lineCount,
            summary: summary + (fullOutput.length > 500 ? '\n... (truncated, see file)' : ''),
            exitCode: 0
          };
        }

        return {
          success: true,
          command: params.command,
          cwd: options.cwd,
          output_mode: 'inline',
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0
        };
      } catch (error) {
        const fullOutput = (error.stdout || '') + (error.stderr ? '\n--- stderr ---\n' + error.stderr : error.message);

        // Also redirect error output to file if large
        if (this._sessionWorkspace && (params.output_to_file || fullOutput.length > OUTPUT_THRESHOLD)) {
          const sessionId = this._currentSessionId || 'default';
          const label = params.command.split(/\s+/)[0] + '_error';
          const result = this._sessionWorkspace.writeOutput(sessionId, label, fullOutput);
          return {
            success: false,
            command: params.command,
            cwd: options.cwd,
            output_mode: 'file',
            file_path: result.filePath,
            file_name: result.fileName,
            summary: fullOutput.substring(0, 500),
            exitCode: error.code || 1
          };
        }

        return {
          success: false,
          command: params.command,
          cwd: options.cwd,
          output_mode: 'inline',
          stdout: error.stdout?.trim() || '',
          stderr: error.stderr?.trim() || error.message,
          exitCode: error.code || 1
        };
      }
    });

    this.registerTool('run_python', {
      name: 'run_python',
      description: 'Execute Python code. Can run a script file or inline code. SECURITY: This tool requires terminal capability to be enabled.',
      userDescription: 'Runs Python code and returns the output',
      example: 'TOOL:run_python{"code":"print(Hello World)"}',
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Python code to execute (inline)'
          },
          scriptPath: {
            type: 'string',
            description: 'Path to a Python script file to execute'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments to pass to the script'
          },
          cwd: {
            type: 'string',
            description: 'Working directory'
          }
        }
      }
    }, async (params) => {
      const { spawn } = require('child_process');
      const fs = require('fs');
      const path = require('path');

      return new Promise((resolve) => {
        let pythonArgs = [];
        let tempFile = null;

        if (params.code) {
          // Inline code - write to temp file
          const tempDir = require('os').tmpdir();
          tempFile = path.join(tempDir, `agent_script_${Date.now()}.py`);
          fs.writeFileSync(tempFile, params.code);
          pythonArgs = [tempFile];
        } else if (params.scriptPath) {
          pythonArgs = [params.scriptPath];
        } else {
          resolve({ success: false, error: 'Either code or scriptPath is required' });
          return;
        }

        if (params.args) {
          pythonArgs = pythonArgs.concat(params.args);
        }

        const python = spawn('python', pythonArgs, {
          cwd: params.cwd || process.cwd(),
          timeout: 60000
        });

        let stdout = '', stderr = '';

        python.stdout.on('data', (data) => { stdout += data.toString(); });
        python.stderr.on('data', (data) => { stderr += data.toString(); });

        python.on('close', (code) => {
          // Clean up temp file
          if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }

          resolve({
            success: code === 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code
          });
        });

        python.on('error', (error) => {
          if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
          resolve({ success: false, error: error.message });
        });
      });
    });

    // ============================================
    // WORKSPACE GROUP - Session workspace tools
    // ============================================

    this.registerTool('list_workspace', {
      name: 'list_workspace',
      description: 'List all files in the current session workspace. Workspace files include command outputs, temp files, and other session artifacts.',
      userDescription: 'Lists files in the session temp workspace',
      example: 'TOOL:list_workspace{}',
      inputSchema: { type: 'object' }
    }, async () => {
      if (!this._sessionWorkspace) return { error: 'Session workspace not initialized' };
      const sessionId = this._currentSessionId || 'default';
      const files = this._sessionWorkspace.listFiles(sessionId);
      return { sessionId, fileCount: files.length, files };
    });

    this.registerTool('search_workspace', {
      name: 'search_workspace',
      description: 'Search file contents in the session workspace (grep-like). Useful for finding specific output in command log files without loading entire files into context.',
      userDescription: 'Search text within session workspace files',
      example: 'TOOL:search_workspace{"query":"error"}',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text to search for in workspace files (case-insensitive)'
          }
        },
        required: ['query']
      }
    }, async (params) => {
      if (!this._sessionWorkspace) return { error: 'Session workspace not initialized' };
      const sessionId = this._currentSessionId || 'default';
      const results = this._sessionWorkspace.searchFiles(sessionId, params.query);
      return { sessionId, query: params.query, resultCount: results.length, results };
    });

    // Load tool groups configuration
    this.loadToolGroups();
  }

  registerTool(name, definition, handler) {
    this.tools.set(name, { definition, handler });
  }

  async executeTool(toolName, params = {}, toolCallId = null) {
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.emit('tool-executed', { toolName, success: false, error: 'Tool not found' });
      throw new Error(`Tool not found: ${toolName}`);
    }

    // CHECK CAPABILITY MANAGER FIRST (group-level permission — new system)
    if (this.capabilityManager && !this.capabilityManager.isToolActive(toolName)) {
      const permissionRequest = {
        needsPermission: true,
        toolName,
        params,
        toolDefinition: tool.definition,
        reason: 'capability_group_disabled'
      };
      console.log(`[MCP] Tool ${toolName} blocked by CapabilityManager`);
      return permissionRequest;
    }

    // LEGACY: per-tool DB activation state (kept for backward compatibility)
    const isActive = await this.getToolActiveState(toolName);
    if (!isActive) {
      const permissionRequest = {
        needsPermission: true,
        toolName,
        params,
        toolDefinition: tool.definition,
        reason: 'tool_disabled'
      };
      console.log(`[MCP] Tool ${toolName} disabled (DB state), requesting permission`);
      return permissionRequest;
    }

    try {
      // Apply defaults from schema
      if (tool.definition.inputSchema?.properties) {
        for (const [key, prop] of Object.entries(tool.definition.inputSchema.properties)) {
          if (params[key] === undefined && prop.default !== undefined) {
            params[key] = prop.default;
          }
        }
      }

      // Validate input
      if (tool.definition.inputSchema) {
        this.validateInput(params, tool.definition.inputSchema);
      }

      // Execute with timeout protection (5s default for fast failure)
      const timeoutMs = parseInt(await this.db.getSetting('tool_timeout_ms') || '5000');
      const result = await this.executeWithTimeout(tool.handler(params), timeoutMs, toolName);

      // Emit updates
      if (toolName.startsWith('calendar_')) this.emit('calendar-update');
      else if (toolName.startsWith('todo_')) this.emit('todo-update');

      // Wrap result with tracking metadata
      const enrichedResult = {
        toolCallId: toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        toolName: toolName,
        timestamp: new Date().toISOString(),
        success: true,
        result: result
      };

      this.emit('tool-executed', enrichedResult);
      return enrichedResult;
    } catch (error) {
      const errorResult = {
        toolCallId: toolCallId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        toolName: toolName,
        timestamp: new Date().toISOString(),
        success: false,
        error: error.message
      };
      this.emit('tool-executed', errorResult);
      throw error;
    }
  }

  // Helper to wrap promise with timeout
  async executeWithTimeout(promise, timeoutMs, toolName) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Tool '${toolName}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async getToolActiveState(toolName) {
    try {
      // Check cache first
      if (this.toolStates.has(toolName)) {
        return this.toolStates.get(toolName);
      }

      // Load from database
      const key = `tool.${toolName}.active`;
      const value = await this.db.getSetting(key);

      // Default to true (active) if not set
      const isActive = value !== 'false';
      this.toolStates.set(toolName, isActive); // Cache it

      return isActive;
    } catch (error) {
      console.error('Error getting tool state:', error);
      return true; // Default to active on error
    }
  }

  async setToolActiveState(toolName, active) {
    try {
      const key = `tool.${toolName}.active`;
      const value = active ? 'true' : 'false';
      await this.db.setSetting(key, value);

      // Update cache
      this.toolStates.set(toolName, active);

      console.log(`Tool ${toolName} ${active ? 'enabled' : 'disabled'}`);
      return { toolName, active };
    } catch (error) {
      console.error('Error setting tool state:', error);
      throw error;
    }
  }

  parseToolCall(text) {
    // Parse tool calls from AI response
    // Format: TOOL:tool_name{"param":"value"}
    // Improved: Handles nested JSON by counting brace depth
    const calls = [];
    const toolPrefix = /TOOL:(\w+)/g;
    let match;

    while ((match = toolPrefix.exec(text)) !== null) {
      const toolName = match[1];
      const afterTool = text.slice(match.index + match[0].length);
      let params = {};

      if (afterTool.startsWith('{')) {
        // Find matching closing brace with nesting awareness
        let depth = 0;
        let end = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < afterTool.length; i++) {
          const char = afterTool[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }

          if (!inString) {
            if (char === '{') depth++;
            else if (char === '}') {
              depth--;
              if (depth === 0) {
                end = i + 1;
                break;
              }
            }
          }
        }

        if (end > 0) {
          try {
            params = JSON.parse(afterTool.slice(0, end));
          } catch (e) {
            console.error('Failed to parse tool params:', e);
          }
        }
      }

      // Generate unique tool call ID
      const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      calls.push({
        toolName,
        params,
        toolCallId,  // Unique identifier for this tool call
        timestamp: new Date().toISOString()  // When the call was made
      });
    }

    return calls;
  }

  async executeToolCalls(text) {
    const calls = this.parseToolCall(text);
    const results = [];

    for (const call of calls) {
      try {
        const result = await this.executeTool(call.toolName, call.params);
        results.push({ tool: call.toolName, success: true, result });
      } catch (error) {
        results.push({ tool: call.toolName, success: false, error: error.message });
      }
    }

    return results;
  }

  validateInput(params, schema) {
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (params[requiredField] === undefined) {
          throw new Error(`Missing required field: ${requiredField}`);
        }
      }
    }

    for (const [field, value] of Object.entries(params)) {
      const fieldSchema = schema.properties[field];
      if (!fieldSchema) {
        throw new Error(`Unknown field: ${field}`);
      }

      if (fieldSchema.type && typeof value !== fieldSchema.type) {
        throw new Error(`Field ${field} must be of type ${fieldSchema.type}`);
      }

      // Additional validation for date-time format
      if (fieldSchema.format === 'date-time' && isNaN(Date.parse(value))) {
        throw new Error(`Field ${field} must be a valid date-time string`);
      }
    }
  }

  getTools() {
    const tools = [];
    for (const [name, tool] of this.tools) {
      tools.push(tool.definition);
    }
    return tools;
  }

  getToolsDocumentation() {
    // Returns user-friendly documentation for UI display
    const docs = [];
    for (const [name, tool] of this.tools) {
      const def = tool.definition;
      const doc = {
        name: def.name,
        description: def.userDescription || def.description,
        technicalDescription: def.description,
        parameters: [],
        example: def.example || '',
        exampleOutput: def.exampleOutput || '',
        category: this.categorizeToolName(def.name)
      };

      if (def.inputSchema?.properties) {
        const required = def.inputSchema.required || [];
        Object.entries(def.inputSchema.properties).forEach(([key, prop]) => {
          doc.parameters.push({
            name: key,
            type: prop.type,
            description: prop.description || 'No description',
            required: required.includes(key),
            default: prop.default
          });
        });
      }

      docs.push(doc);
    }
    return docs;
  }

  categorizeToolName(name) {
    // Check tool groups first
    if (this.toolGroups) {
      for (const [groupId, group] of this.toolGroups) {
        if (group.tools.includes(name)) {
          return group.name;
        }
      }
    }
    // Fallback to legacy categorization
    if (name.includes('calendar')) return 'Calendar';
    if (name.includes('todo')) return 'Todo';
    if (name.includes('weather') || name.includes('time')) return 'System';
    if (name.includes('conversation') || name.includes('search')) return 'Search';
    if (name.includes('calculate')) return 'Math';
    if (name.includes('rule')) return 'Rules';
    if (name.includes('stats') || name.includes('provider') || name.includes('prompt')) return 'System';
    return 'Other';
  }

  // ============================================
  // TOOL GROUP MANAGEMENT
  // ============================================

  loadToolGroups() {
    // If CapabilityManager is available, delegate entirely to it (new system)
    if (this.capabilityManager) {
      try {
        this.toolGroups = new Map();
        this.activeGroups = new Set();
        const groups = this.capabilityManager.getGroupsConfig();
        for (const group of groups) {
          this.toolGroups.set(group.id, {
            name: group.name,
            description: group.description,
            icon: group.icon,
            tools: group.allTools || group.tools || []
          });
          if (group.enabled) this.activeGroups.add(group.id);
        }
        console.log(`[MCP] Loaded ${this.toolGroups.size} tool groups from CapabilityManager`);
        return;
      } catch (e) {
        console.error('[MCP] Failed to load groups from CapabilityManager, falling back:', e.message);
      }
    }

    // DEPRECATED FALLBACK: tool-groups.json (kept for safety until fully removed)
    try {
      const path = require('path');
      const fs = require('fs');
      const groupsPath = path.join(__dirname, 'tool-groups.json');
      const data = fs.readFileSync(groupsPath, 'utf-8');
      const config = JSON.parse(data);

      this.toolGroups = new Map();
      this.activeGroups = new Set();

      for (const [groupId, groupConfig] of Object.entries(config.groups)) {
        this.toolGroups.set(groupId, groupConfig);
        if (groupConfig.defaultActive) {
          this.activeGroups.add(groupId);
        }
      }
      console.warn('[MCP] WARNING: Using deprecated tool-groups.json. CapabilityManager not available.');
    } catch (error) {
      console.error('[MCP] Failed to load tool groups:', error.message);
      this.toolGroups = new Map();
      this.activeGroups = new Set();
    }
  }

  async activateGroup(groupId) {
    if (!this.toolGroups.has(groupId)) {
      throw new Error(`Unknown group: ${groupId}`);
    }
    this.activeGroups.add(groupId);

    // Enable all tools in the group
    const group = this.toolGroups.get(groupId);
    for (const toolName of group.tools) {
      await this.setToolActiveState(toolName, true);
    }

    console.log(`[MCP] Activated group: ${groupId} (${group.tools.length} tools)`);
    return { activated: groupId, tools: group.tools };
  }

  async deactivateGroup(groupId) {
    if (!this.toolGroups.has(groupId)) {
      throw new Error(`Unknown group: ${groupId}`);
    }
    this.activeGroups.delete(groupId);

    // Disable all tools in the group
    const group = this.toolGroups.get(groupId);
    for (const toolName of group.tools) {
      await this.setToolActiveState(toolName, false);
    }

    console.log(`Deactivated group: ${groupId}`);
    return { deactivated: groupId, tools: group.tools };
  }

  getActiveTools() {
    // Use CapabilityManager if available (new system)
    if (this.capabilityManager) {
      const activeToolNames = this.capabilityManager.getActiveTools();
      return activeToolNames
        .map(name => this.tools.get(name)?.definition)
        .filter(Boolean);
    }

    // Fallback to legacy group system
    const activeTools = [];
    for (const groupId of this.activeGroups) {
      const group = this.toolGroups.get(groupId);
      if (group) {
        for (const toolName of group.tools) {
          const tool = this.tools.get(toolName);
          if (tool) {
            activeTools.push(tool.definition);
          }
        }
      }
    }
    return activeTools;
  }

  getToolGroups() {
    // Delegate to CapabilityManager (single source of truth)
    if (this.capabilityManager) {
      return this.capabilityManager.getGroupsConfig().map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        icon: g.icon,
        tools: g.allTools || g.tools || [],
        active: g.enabled,
        toolCount: (g.allTools || g.tools || []).length,
        mode: g.mode,
        modes: g.modes
      }));
    }
    // Fallback (deprecated)
    const groups = [];
    for (const [groupId, group] of this.toolGroups) {
      groups.push({
        id: groupId,
        name: group.name,
        description: group.description,
        icon: group.icon,
        tools: group.tools,
        active: this.activeGroups.has(groupId),
        toolCount: group.tools.length
      });
    }
    return groups;
  }

  async addProxyServer(name, config) {
    // Placeholder for proxy server integration
    // This would connect to external MCP servers
    this.proxyServers.set(name, config);
    return { success: true, name };
  }

  async removeProxyServer(name) {
    this.proxyServers.delete(name);
    return { success: true, name };
  }

  getProxyServers() {
    return Array.from(this.proxyServers.entries()).map(([name, config]) => ({
      name,
      config
    }));
  }

  async stop() {
    this.proxyServers.clear();
    this.removeAllListeners();
  }

  registerCustomTool(tool) {
    const handler = new Function('params', tool.code);
    this.registerTool(tool.name, {
      name: tool.name,
      description: tool.description,
      userDescription: tool.description,
      inputSchema: tool.input_schema || { type: 'object' },
      isCustom: true
    }, async (params) => handler(params));
    // Register in CapabilityManager as unsafe (requires unsafe group enabled)
    if (this.capabilityManager) {
      this.capabilityManager.registerCustomTool(tool.name, false);
    }
    console.log(`[MCP] Custom tool registered: ${tool.name}`);
  }

  async loadCustomTools() {
    try {
      const tools = await this.db.getCustomTools();
      for (const tool of tools) {
        try {
          this.registerCustomTool({
            name: tool.name,
            description: tool.description,
            code: tool.code,
            input_schema: JSON.parse(tool.input_schema || '{}')
          });
        } catch (e) {
          console.error(`[MCP] Failed to load custom tool ${tool.name}:`, e);
        }
      }
      console.log(`[MCP] Loaded ${tools.length} custom tools`);
    } catch (e) {
      console.error('[MCP] Failed to load custom tools:', e);
    }
  }
}

module.exports = MCPServer;

