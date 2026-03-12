# Workflow System Reference

This document explains the workflow system — how to create, manage, and execute automated multi-tool sequences.

## Architecture: File-First

Workflows are **file-first** — they live as JSON files in `agentin/workflows/*.json`. The database logs execution stats but is not the source of truth.

**Flow:**
1. A `.json` file is placed in `agentin/workflows/`
2. On any read (tab open, `list_workflows` call), the folder is scanned and synced to DB
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
    { "tool": "list_calendar_events", "params": { "limit": 5 } },
    { "tool": "todo_list", "params": { "completed": false } },
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

### `list_workflows`
List all workflows (syncs from files first).

### `create_workflow`
Create a new workflow — writes a `.json` file and inserts into DB.
```
TOOL:create_workflow{"name":"System Check","tool_chain":[{"tool":"get_memory_usage","params":{}},{"tool":"get_disk_space","params":{}}]}
```

### `execute_workflow`
Run by ID with optional parameter overrides.
```
TOOL:execute_workflow{"id":1,"param_overrides":{"search_web":{"query":"new topic"}}}
```

### `copy_workflow`
Clone a workflow — creates a new file and DB entry.

### `delete_workflow`
Removes the file and DB entry.

## When to Use

1. **Before multi-tool tasks**: Check `list_workflows` to reuse existing workflows
2. **After successful chains**: Suggest saving as a workflow
3. **Copy for variations**: Clone proven workflows and modify them
4. **Manual creation**: Drop a `.json` file into `agentin/workflows/` — it auto-syncs
