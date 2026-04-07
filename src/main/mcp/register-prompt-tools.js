function registerPromptTools(server) {
  server.registerTool('get_system_prompt', {
    name: 'get_system_prompt',
    description: 'Get the current system prompt',
    userDescription: 'Returns the current system prompt configuration used by the AI',
    example: 'TOOL:get_system_prompt{}',
    exampleOutput: '"You are a helpful AI assistant..."',
    inputSchema: { type: 'object' }
  }, async () => {
    return server.aiService.getSystemPrompt();
  });

  server.registerTool('modify_system_prompt', {
    name: 'modify_system_prompt',
    description: 'Modify the system prompt. Agent can update its own behavior instructions.',
    userDescription: 'Allows the agent to update its own system prompt, changing its core behavior. Changes are saved to agentin/prompts/system.md',
    example: 'TOOL:modify_system_prompt{"content":"You are a helpful coding assistant..."}',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The new system prompt content' },
        append: { type: 'boolean', description: 'If true, append to existing prompt instead of replacing', default: false }
      },
      required: ['content']
    }
  }, async (params) => {
    const fs = require('fs');
    const path = require('path');
    const promptPath = path.join(process.cwd(), 'agentin', 'prompts', 'system.md');

    let newContent = params.content;
    if (params.append) {
      const existing = server.aiService.getSystemPrompt();
      newContent = existing + '\n\n' + params.content;
    }

    fs.writeFileSync(promptPath, newContent, 'utf-8');
    await server.aiService.setSystemPrompt(newContent);
    await server.db.setSetting('system_prompt', newContent);

    return { success: true, message: 'System prompt updated', path: promptPath };
  });

  server.registerTool('manage_rule', {
    name: 'manage_rule',
    description: 'Create, update, or delete a behavioral rule. Rules modify agent behavior dynamically.',
    userDescription: 'Manage prompt rules that affect agent behavior. Creates files in agentin/prompts/rules/',
    example: 'TOOL:manage_rule{"action":"create","name":"Code Style","content":"Always use TypeScript...","active":true}',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete', 'toggle'], description: 'Action to perform on the rule' },
        name: { type: 'string', description: 'Name of the rule' },
        content: { type: 'string', description: 'Rule content (for create/update)' },
        active: { type: 'boolean', description: 'Whether the rule is active', default: true },
        priority: { type: 'number', description: 'Priority order (lower = higher priority)', default: 1 }
      },
      required: ['action', 'name']
    }
  }, async (params) => {
    const fs = require('fs');
    const path = require('path');
    const rulesPath = path.join(process.cwd(), 'agentin', 'prompts', 'rules');

    if (!fs.existsSync(rulesPath)) {
      fs.mkdirSync(rulesPath, { recursive: true });
    }

    const safeName = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const priority = params.priority || 1;
    const filename = `${String(priority).padStart(3, '0')}-${safeName}.md`;
    const filePath = path.join(rulesPath, filename);

    switch (params.action) {
      case 'create':
      case 'update': {
        const fileContent = `---
name: ${params.name}
active: ${params.active !== false}
priority: ${priority}
---
${params.content || ''}`;
        fs.writeFileSync(filePath, fileContent, 'utf-8');

        const existing = await server.db.get('SELECT id FROM prompt_rules WHERE name = ?', [params.name]);
        if (existing) {
          await server.db.updatePromptRule(existing.id, { name: params.name, content: params.content });
          await server.db.togglePromptRule(existing.id, params.active !== false);
        } else {
          await server.db.addPromptRule({ name: params.name, content: params.content, type: 'rule' });
        }
        return { success: true, action: params.action, path: filePath };
      }

      case 'delete': {
        const files = fs.readdirSync(rulesPath).filter(fileName => fileName.includes(safeName));
        files.forEach(fileName => fs.unlinkSync(path.join(rulesPath, fileName)));

        const dbRule = await server.db.get('SELECT id FROM prompt_rules WHERE name = ?', [params.name]);
        if (dbRule) await server.db.deletePromptRule(dbRule.id);
        return { success: true, action: 'delete', deleted: files };
      }

      case 'toggle': {
        if (fs.existsSync(filePath)) {
          let content = fs.readFileSync(filePath, 'utf-8');
          content = content.replace(/active:\s*(true|false)/, `active: ${params.active}`);
          fs.writeFileSync(filePath, content, 'utf-8');
        }

        const toggleRule = await server.db.get('SELECT id FROM prompt_rules WHERE name = ?', [params.name]);
        if (toggleRule) await server.db.togglePromptRule(toggleRule.id, params.active);
        return { success: true, action: 'toggle', active: params.active };
      }

      default:
        return { error: 'Invalid action' };
    }
  });

  server.registerTool('list_rules', {
    name: 'list_rules',
    description: 'List all behavioral rules and their status',
    userDescription: 'Shows all prompt rules that can affect agent behavior',
    example: 'TOOL:list_rules{}',
    inputSchema: { type: 'object' }
  }, async () => {
    const rules = await server.db.getPromptRules();
    return rules.map(rule => ({
      name: rule.name,
      active: rule.active === 1 || rule.active === true,
      preview: rule.content?.substring(0, 100) + (rule.content?.length > 100 ? '...' : '')
    }));
  });

  server.registerTool('get_current_provider', {
    name: 'get_current_provider',
    description: 'Get the current AI provider',
    userDescription: 'Returns which AI provider is currently active (e.g., Ollama, LM Studio, OpenRouter)',
    example: 'TOOL:get_current_provider{}',
    exampleOutput: '"ollama"',
    inputSchema: { type: 'object' }
  }, async () => {
    return server.aiService.getCurrentProvider();
  });

  server.registerTool('search_conversations', {
    name: 'search_conversations',
    description: 'Search through conversation history',
    userDescription: 'Searches past conversations for messages containing specific keywords or phrases',
    example: 'TOOL:search_conversations{"query":"weather","limit":5}',
    exampleOutput: '[{"role":"user","content":"What\'s the weather?","timestamp":"2025-10-05T10:00:00Z"}]',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or phrase to find in conversation history (e.g., "weather", "meeting", "todo")' },
        limit: { type: 'number', description: 'Maximum number of results to return', default: 10 }
      },
      required: ['query']
    }
  }, async (params) => {
    const conversations = await server.db.getConversations(100);
    return conversations.filter(conversation =>
      conversation.content.toLowerCase().includes(params.query.toLowerCase())
    ).slice(0, params.limit);
  });

  server.registerTool('calculate', {
    name: 'calculate',
    description: 'Perform mathematical calculations',
    userDescription: 'Evaluates mathematical expressions and returns the result',
    example: 'TOOL:calculate{"expression":"(123 + 456) * 2"}',
    exampleOutput: '{"expression":"(123 + 456) * 2","result":1158}',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Mathematical expression to evaluate (e.g., "2+2", "(10*5)/2", "Math.sqrt(16)")' }
      },
      required: ['expression']
    }
  }, async (params) => {
    try {
      const result = Function('"use strict"; return (' + params.expression + ')')();
      return { expression: params.expression, result };
    } catch {
      throw new Error('Invalid math expression');
    }
  });

  server.registerTool('list_active_rules', {
    name: 'list_active_rules',
    description: 'List currently active prompt rules',
    userDescription: 'Returns all currently active prompt rules that modify AI behavior',
    example: 'TOOL:list_active_rules{}',
    exampleOutput: '[{"id":1,"name":"Be Concise","content":"Keep responses brief","active":true}]',
    inputSchema: { type: 'object' }
  }, async () => {
    return await server.db.getActivePromptRules();
  });

  server.registerTool('toggle_rule', {
    name: 'toggle_rule',
    description: 'Toggle a prompt rule on or off',
    userDescription: 'Activates or deactivates a specific prompt rule by its ID',
    example: 'TOOL:toggle_rule{"rule_id":1,"active":true}',
    exampleOutput: '{"id":1,"name":"Be Concise","active":true}',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'The ID number of the rule to toggle' },
        active: { type: 'boolean', description: 'Set to true to activate, false to deactivate' }
      },
      required: ['rule_id', 'active']
    }
  }, async (params) => {
    return await server.db.togglePromptRule(params.rule_id, params.active);
  });

  server.registerTool('get_stats', {
    name: 'get_stats',
    description: 'Get usage statistics',
    userDescription: 'Returns statistics about conversations, todos, calendar events, and rules',
    example: 'TOOL:get_stats{}',
    exampleOutput: '{"conversations":45,"todos":12,"events":8,"rules":3}',
    inputSchema: { type: 'object' }
  }, async () => {
    const conversationCount = (await server.db.getConversations(10000)).length;
    const todoCount = (await server.db.getTodos()).length;
    const eventCount = (await server.db.getCalendarEvents()).length;
    const ruleCount = (await server.db.getPromptRules()).length;
    return { conversations: conversationCount, todos: todoCount, events: eventCount, rules: ruleCount };
  });

  server.registerTool('create_tool', {
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
    await server.db.addCustomTool(params);
    server.registerCustomTool(params);
    return { created: true, name: params.name };
  });

  server.registerTool('end_answer', {
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

  server.registerTool('automemory', {
    name: 'automemory',
    description: 'Toggle automatic memory creation during idle periods. Off by default — user must enable. When enabled, after idle_seconds of no user input the agent will automatically summarize the conversation to daily memory.',
    userDescription: 'Enable/disable automatic memory saving during idle chat periods',
    example: 'TOOL:automemory{"enabled":true,"idle_seconds":60}',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true to enable auto-memory, false to disable' },
        idle_seconds: { type: 'number', description: 'Seconds of idle before triggering memory save', default: 60 }
      },
      required: ['enabled']
    }
  }, async (params) => {
    if (server._agentLoop) {
      const sessionId = server._currentSessionId || 'default';
      return server._agentLoop.setAutoMemory(sessionId, params.enabled, params.idle_seconds || 60);
    }
    return { error: 'Agent loop not initialized' };
  });
}

module.exports = { registerPromptTools };
