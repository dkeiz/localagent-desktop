# Per-Agent Tool Permission Plan

## Goal
Move from global-only tool permissions to per-agent persistent permissions with global defaults, while preserving explicit user control for unsafe tools.

## How It Works (Structure Block)
```text
[Global Defaults]
  ├─ main switch
  ├─ group states (web/files/terminal/...)
  └─ tool states (default active/inactive)
          |
          v
[Agent Profile Bootstrap]
  ├─ copy global defaults on first use
  ├─ apply agent/plugin scoped defaults
  └─ persist per-agent profile
          |
          v
[Runtime Resolution]
  ├─ if agent tab -> resolve AgentProfile(agentId)
  └─ else -> resolve GlobalDefaults
          |
          v
[Execution Gate in MCP]
  1) agentScope check
  2) capability/group check (resolved profile)
  3) tool active check (resolved profile)
  4) unsafe escalation => explicit user approval
```

## Data Model
- `agent_permission_profiles`
  - `agent_id` (PK)
  - `main_enabled`
  - `files_mode`
  - group flags
  - timestamps
- `agent_tool_states`
  - `agent_id`
  - `tool_name`
  - `active`
  - timestamp
  - PK(`agent_id`, `tool_name`)

## Resolution Rules
- Non-agent tabs use global defaults.
- Agent tabs use that agent’s persistent profile.
- Unsafe global changes sync to all agents.
- Safe global changes do not overwrite existing agent profiles.
- Unknown tool in agent profile:
  - unsafe -> inherit global state
  - safe -> default disabled unless explicitly enabled

## UI Rules
- Capability panel edits global defaults.
- Active tab updates displayed resolved context.
- Agent Manager edits per-agent permissions.
- “Reset agent profile to global” is available.

## Subagent Rules
- Parent may pass permission contract to child run.
- Safe contract grants can be run-scoped.
- Unsafe contract grants always require user approval.
- Run-scoped grants expire after completion.

## Acceptance Criteria
- Agent A permission changes do not affect Agent B.
- Permissions persist between sessions/restarts.
- Active tab changes update effective tool list/context.
- Unsafe permissions cannot be silently escalated.
