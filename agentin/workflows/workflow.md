# Workflow System Reference

This document explains the workflow system — how to create, manage, and execute automated multi-tool sequences.

## Architecture: File-First

Workflows are **file-first** — they live as JSON files in `agentin/workflows/*.json`. The database logs execution stats but is not the source of truth.

**Flow:**
1. A `.json` file is placed in `agentin/workflows/`
2. On any read (tab open, `workflow_op` with `action:"list"`), the folder is scanned and synced to DB
3. The DB tracks stats: `success_count`, `failure_count`, `last_used`
4. All mutations (create, copy, delete) write/remove files first, then update DB

## File Format

Each `.json` file in `agentin/workflows/` defines one workflow:

```json
{
  "name": "Morning Briefing",
  "description": "Lists calendar events, todos, and weather",
  "trigger_pattern": "morning briefing daily summary",
  "tool_chain": [
    { "tool": "calendar_op", "params": { "action": "list", "limit": 5 } },
    { "tool": "todo_op", "params": { "action": "list" } },
    { "tool": "current_weather", "params": { "city": "Moscow" } }
  ]
}
```

**Fields:**
- `name` (required) — display name, also used to generate the filename
- `description` — what the workflow does
- `trigger_pattern` — keywords for matching user messages
- `tool_chain` (required) — array of `{ tool, params }` steps

## Available Tools

### `workflow_op`
Unified workflow API with action parameter:
- `list`
- `create`
- `execute`
- `run`
- `get_run`
- `list_runs`
- `copy`
- `delete`

Examples:
```
TOOL:workflow_op{"action":"list"}
TOOL:workflow_op{"action":"create","name":"System Check","tool_chain":[{"tool":"get_memory_usage","params":{}},{"tool":"get_disk_space","params":{}}]}
TOOL:workflow_op{"action":"execute","id":1,"param_overrides":{"search_web_bing":{"query":"new topic"}}}
TOOL:workflow_op{"action":"run","id":1,"mode":"auto"}
TOOL:workflow_op{"action":"get_run","run_id":"workflow-20260409-ab12cd"}
TOOL:workflow_op{"action":"list_runs","limit":10}
TOOL:workflow_op{"action":"copy","source_id":1,"new_name":"System Check Copy"}
TOOL:workflow_op{"action":"delete","id":1}
```

## When to Use

1. **Before multi-tool tasks**: Use `workflow_op` with `action:"list"` to reuse existing workflows
2. **After successful chains**: Suggest saving as a workflow
3. **Copy for variations**: Clone proven workflows and modify them
4. **Manual creation**: Drop a `.json` file into `agentin/workflows/` — it auto-syncs
