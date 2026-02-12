# MCP Tools Guide

This guide explains all available MCP (Model Context Protocol) tools in the application. Both users and the AI assistant can use these tools.

## Tool Format

All tools follow this format:
```
TOOL:tool_name{"param":"value"}
```

## Available Tools

### 🕐 System Tools

#### current_time
**Description**: Returns the current date and time on the server

**Parameters**: None

**Example**:
```
TOOL:current_time{}
```

**Output**:
```json
"2025-10-05T15:05:30.123Z"
```

---

#### current_weather
**Description**: Fetches current weather conditions (temperature, humidity, conditions) for any city worldwide

**Parameters**:
- `city` (string): City name (e.g., "London", "New York", "Tokyo", "Moscow") - Default: "Moscow"

**Example**:
```
TOOL:current_weather{"city":"London"}
```

**Output**:
```json
{
  "temp": "15",
  "condition": "Partly cloudy",
  "humidity": "65",
  "city": "London"
}
```

---

#### get_system_prompt
**Description**: Returns the current system prompt configuration used by the AI

**Parameters**: None

**Example**:
```
TOOL:get_system_prompt{}
```

**Output**:
```json
"You are a helpful AI assistant..."
```

---

#### get_current_provider
**Description**: Returns which AI provider is currently active (e.g., Ollama, LM Studio, OpenRouter)

**Parameters**: None

**Example**:
```
TOOL:get_current_provider{}
```

**Output**:
```json
"ollama"
```

---

#### get_stats
**Description**: Returns statistics about conversations, todos, calendar events, and rules

**Parameters**: None

**Example**:
```
TOOL:get_stats{}
```

**Output**:
```json
{
  "conversations": 45,
  "todos": 12,
  "events": 8,
  "rules": 3
}
```

---

### 📅 Calendar Tools

#### create_calendar_event
**Description**: Creates a new calendar event with a title, start time, duration, and optional notes

**Parameters**:
- `title` (string) **[REQUIRED]**: Event title (e.g., "Team Meeting", "Doctor Appointment")
- `start_time` (string) **[REQUIRED]**: Start time in format "YYYY-MM-DD HH:MM" or ISO format (e.g., "2025-10-06 14:00")
- `duration_minutes` (number): Event duration in minutes (e.g., 30, 60, 90) - Default: 60
- `description` (string): Optional event notes or description - Default: ""

**Example**:
```
TOOL:create_calendar_event{"title":"Team Meeting","start_time":"2025-10-06 14:00","duration_minutes":60,"description":"Discuss Q4 goals"}
```

**Output**:
```json
{
  "id": 1,
  "title": "Team Meeting",
  "start_time": "2025-10-06 14:00",
  "duration_minutes": 60,
  "description": "Discuss Q4 goals"
}
```

---

#### calendar_write
**Description**: Alternative name for create_calendar_event - creates a new calendar event

**Parameters**: Same as `create_calendar_event`

**Example**:
```
TOOL:calendar_write{"title":"Lunch","start_time":"2025-10-06 12:00"}
```

---

#### list_calendar_events
**Description**: Retrieves a list of upcoming calendar events, optionally limited to a specific number

**Parameters**:
- `limit` (number): Maximum number of events to return (e.g., 5, 10, 20) - Default: 10

**Example**:
```
TOOL:list_calendar_events{"limit":5}
```

**Output**:
```json
[
  {
    "id": 1,
    "title": "Meeting",
    "start_time": "2025-10-06 14:00"
  },
  {
    "id": 2,
    "title": "Lunch",
    "start_time": "2025-10-06 12:00"
  }
]
```

---

#### calendar_read
**Description**: Alternative name for list_calendar_events - retrieves calendar events

**Parameters**: Same as `list_calendar_events`

---

### ✅ Todo Tools

#### todo_create
**Description**: Creates a new todo/task item with optional priority and due date

**Parameters**:
- `task` (string) **[REQUIRED]**: Task description (e.g., "Buy groceries", "Call dentist", "Finish report")
- `priority` (number): Priority level from 1 (lowest) to 5 (highest) - Default: 1
- `due_date` (string): Due date in format "YYYY-MM-DD" or ISO format (optional)

**Example**:
```
TOOL:todo_create{"task":"Buy groceries","priority":2,"due_date":"2025-10-07"}
```

**Output**:
```json
{
  "id": 1,
  "task": "Buy groceries",
  "priority": 2,
  "due_date": "2025-10-07",
  "completed": false
}
```

---

#### todo_list
**Description**: Retrieves all todo items, optionally filtered by completion status or priority level

**Parameters**:
- `completed` (boolean): Filter by completion: true (completed only), false (incomplete only), or omit for all
- `priority` (number): Filter by priority level (1-5), or omit for all priorities

**Example**:
```
TOOL:todo_list{"completed":false,"priority":3}
```

**Output**:
```json
[
  {
    "id": 1,
    "task": "Buy groceries",
    "priority": 3,
    "completed": false
  }
]
```

---

#### todo_complete
**Description**: Marks a specific todo item as completed using its ID

**Parameters**:
- `id` (number) **[REQUIRED]**: The ID number of the todo item to mark as complete

**Example**:
```
TOOL:todo_complete{"id":1}
```

**Output**:
```json
{
  "id": 1,
  "task": "Buy groceries",
  "completed": true
}
```

---

### 🔍 Search Tools

#### search_conversations
**Description**: Searches past conversations for messages containing specific keywords or phrases

**Parameters**:
- `query` (string) **[REQUIRED]**: Search term or phrase to find in conversation history (e.g., "weather", "meeting", "todo")
- `limit` (number): Maximum number of results to return - Default: 10

**Example**:
```
TOOL:search_conversations{"query":"weather","limit":5}
```

**Output**:
```json
[
  {
    "role": "user",
    "content": "What's the weather?",
    "timestamp": "2025-10-05T10:00:00Z"
  }
]
```

---

#### conversation_history
**Description**: Retrieves past conversation messages, limited to a specific number

**Parameters**:
- `limit` (number): Maximum number of messages to retrieve (e.g., 10, 20, 50) - Default: 50

**Example**:
```
TOOL:conversation_history{"limit":20}
```

**Output**:
```json
[
  {
    "role": "user",
    "content": "Hello"
  },
  {
    "role": "assistant",
    "content": "Hi there!"
  }
]
```

---

### 🔢 Math Tools

#### calculate
**Description**: Evaluates mathematical expressions and returns the result

**Parameters**:
- `expression` (string) **[REQUIRED]**: Mathematical expression to evaluate (e.g., "2+2", "(10*5)/2", "Math.sqrt(16)")

**Example**:
```
TOOL:calculate{"expression":"(123 + 456) * 2"}
```

**Output**:
```json
{
  "expression": "(123 + 456) * 2",
  "result": 1158
}
```

---

### ⚙️ Rules Tools

#### list_active_rules
**Description**: Returns all currently active prompt rules that modify AI behavior

**Parameters**: None

**Example**:
```
TOOL:list_active_rules{}
```

**Output**:
```json
[
  {
    "id": 1,
    "name": "Be Concise",
    "content": "Keep responses brief",
    "active": true
  }
]
```

---

#### toggle_rule
**Description**: Activates or deactivates a specific prompt rule by its ID

**Parameters**:
- `rule_id` (number) **[REQUIRED]**: The ID number of the rule to toggle
- `active` (boolean) **[REQUIRED]**: Set to true to activate, false to deactivate

**Example**:
```
TOOL:toggle_rule{"rule_id":1,"active":true}
```

**Output**:
```json
{
  "id": 1,
  "name": "Be Concise",
  "active": true
}
```

---

## Tool Call Tracking System

### How It Works

Each tool call is automatically tracked with:
- **Unique ID**: Format `call_<timestamp>_<random>` (e.g., `call_1707567080_a8f3d9b2`)
- **Timestamp**: ISO 8601 format showing when the tool was executed
- **Result metadata**: Full tracking information for each execution

### Benefits

✓ **Prevents redundant calls**: The AI can see which tools were already used  
✓ **Better debugging**: Each tool call is uniquely identifiable  
✓ **Temporal tracking**: Know exactly when tools were executed  
✓ **Conversation clarity**: Clear indication of completed operations  

### Example Result Format

When a tool is executed, results are formatted like this:

```
[Tool Call ID: call_1707567080_a8f3d9b2]
Tool: "current_time"
Timestamp: 2026-02-10T02:44:52+03:00
Result: "2026-02-10T02:44:52.000Z"

✓ This tool was successfully executed. Do NOT call it again with the same parameters.
```

This system follows industry standards used by OpenAI, Anthropic, and other major LLM providers.

---

## How the AI Uses Tools

The AI assistant automatically uses these tools when:
- You ask for current time or date
- You request weather information
- You want to create/view calendar events
- You want to manage todos
- You need calculations
- You search conversation history

## How You Can Use Tools

You can manually invoke tools by typing the exact format in chat:
```
TOOL:current_weather{"city":"Paris"}
```

The AI will execute the tool and return results in natural language.

## Tips for Local LLMs

Local LLMs work best with tools when:
1. **Use exact JSON format** - Copy examples precisely
2. **Check required parameters** - Parameters marked [REQUIRED] must be included
3. **Use default values** - Omit optional parameters to use defaults
4. **Enable "Enforce Tool Usage" rule** - In LLM Settings, activate this rule for strict tool enforcement

## Troubleshooting

**Tool not working?**
- Check JSON syntax (quotes, commas, brackets)
- Verify required parameters are included
- Ensure parameter types match (string, number, boolean)

**AI not using tools?**
- Enable "Enforce Tool Usage" rule in LLM Settings
- Ask explicitly: "Use the weather tool to check London"

**Need help?**
- Check this guide for examples
- Look at the example output to understand what to expect
