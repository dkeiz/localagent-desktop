# Part 3 - Research Run Runtime and Artifact Registry

## Why This Part Exists

Part 1 made SuperAgents real: agent folders, path tokens, file editing, batch subagents, agent-bound UI plugins, and the Research Orchestrator agent.

Part 2 started plugin contracts and voice experiments, but TTS/STT can wait. The important next move from `supermultiagentresearch.md` is the research loop itself: a parent agent should be able to plan a run, spawn subagents, collect outputs, judge whether the result is acceptable, and show artifacts in the UI as normal files.

Part 3 should not create a separate "research app" inside the app. It should add a small durable runtime contract that the existing Research Orchestrator can use with normal tools, files, subagents, plugins, and chat tabs.

## Core Goal

Create a first version of durable research runs:

1. The Research Orchestrator can create a run folder.
2. The run has a manifest with goal, acceptance criteria, planned tasks, subagent runs, artifacts, status, and final recommendation.
3. Subagent outputs and parent outputs are registered as artifacts.
4. The Research Orchestrator UI can show the run, files, artifacts, charts, tables, and status.
5. The parent agent can decide: acceptable, rerun needed, or user clarification needed.

This is the "here and now" piece of the big motherplan.

## Existing Pieces To Reuse

| Existing Piece | Use In Part 3 |
| --- | --- |
| Research Orchestrator agent | Parent agent for research runs |
| Agent folders | Store orchestrator-owned run plans and final outputs |
| `agentin/subtasks/` delegated runs | Link spawned subagent execution into run manifests |
| `run_batch` subagent action | Parallel research task execution |
| `edit_file` | Incremental manifest/plan updates |
| Agent-bound UI plugins | Show research runs in the Research Orchestrator tab |
| Agent file browser plugin | Browse run folders and artifacts |
| Chart renderer | Preview chart specs from artifacts or chat messages |
| Event bus | Publish run/task/artifact status updates |
| Contract tests | Lock the data contract without broad testing |

## Proposed Folder Layout

Research runs should be stored under the Research Orchestrator's own folder first:

```text
agentin/agents/pro/research-orchestrator/
  tasks/
    runs/
      <runId>/
        run.json
        plan.md
        acceptance.md
        tasks/
          task-001.md
          task-002.md
        artifacts/
          artifact-index.json
          charts/
          tables/
          reports/
          raw/
        final/
          report.md
          recommendation.md
```

Later, if runs become global, they can be mirrored into `agentin/research/runs/<runId>/`. For Part 3, agent-owned folders are enough and match the current architecture.

## Run Manifest Contract

File:

```text
{agent_tasks}/runs/<runId>/run.json
```

Shape:

```json
{
  "id": "research-20260419-001",
  "version": 1,
  "status": "draft",
  "title": "Compare local coding models",
  "goal": "Find which local coding model is best for this application workflow.",
  "createdAt": "2026-04-19T00:00:00.000Z",
  "updatedAt": "2026-04-19T00:00:00.000Z",
  "ownerAgent": {
    "id": 0,
    "slug": "research-orchestrator",
    "name": "Research Orchestrator"
  },
  "acceptance": {
    "summary": "A result is acceptable if it compares at least 5 models with evidence and produces a recommendation.",
    "criteria": [
      {
        "id": "coverage",
        "description": "At least 5 relevant models are compared.",
        "required": true,
        "status": "unknown"
      }
    ],
    "decision": "unknown",
    "notes": ""
  },
  "tasks": [
    {
      "id": "task-001",
      "title": "Gather candidate models",
      "assignedAgentId": null,
      "provider": "",
      "status": "planned",
      "subagentRunId": "",
      "promptFile": "tasks/task-001.md",
      "outputArtifactIds": []
    }
  ],
  "artifacts": [],
  "final": {
    "reportArtifactId": "",
    "recommendationArtifactId": "",
    "decision": "unknown"
  }
}
```

Allowed statuses:

```text
draft
planned
running
collecting
validating
needs_user
needs_rerun
completed
failed
cancelled
```

## Artifact Registry Contract

File:

```text
{agent_tasks}/runs/<runId>/artifacts/artifact-index.json
```

Shape:

```json
{
  "version": 1,
  "runId": "research-20260419-001",
  "artifacts": [
    {
      "id": "artifact-001",
      "kind": "markdown",
      "title": "Initial model list",
      "path": "artifacts/reports/model-list.md",
      "ownerAgent": {
        "slug": "research-orchestrator",
        "name": "Research Orchestrator"
      },
      "source": {
        "type": "subagent",
        "subagentRunId": "subtask-abc",
        "taskId": "task-001"
      },
      "preview": {
        "type": "markdown"
      },
      "createdAt": "2026-04-19T00:00:00.000Z",
      "summary": "Candidate local coding models and short notes."
    }
  ]
}
```

Artifact kinds:

```text
markdown
json
csv
html
chart
image
screenshot
audio
video
raw
```

Preview types:

```text
markdown
table
chart
html
image
text
download
```

Privacy rule:

Artifacts are just files. If the owning folder is visible to the user, artifacts are visible. No per-artifact privacy system in Part 3.

## Minimal Runtime Behavior

Part 3 can be implemented with a small helper module, not a huge service.

New module:

```text
src/main/research-run-store.js
```

Responsibilities:

1. Create a run folder and starter files.
2. Read/write `run.json`.
3. Add/update tasks in the manifest.
4. Register artifacts in `artifact-index.json` and mirror the artifact entry into `run.json`.
5. Resolve paths safely under the Research Orchestrator folder.
6. Publish event bus updates when run/task/artifact status changes.

Suggested methods:

```js
createRun({ ownerAgent, title, goal, acceptance })
getRun(runId)
listRuns({ ownerAgentSlug })
updateRun(runId, patch)
addTask(runId, task)
updateTask(runId, taskId, patch)
registerArtifact(runId, artifact)
listArtifacts(runId)
```

This store should not run LLMs. It only owns durable run files.

## IPC Surface

Add focused IPC handlers:

```text
research:list-runs
research:get-run
research:create-run
research:update-run
research:register-artifact
research:list-artifacts
```

Renderer bridge:

```js
window.electronAPI.research.listRuns()
window.electronAPI.research.getRun(runId)
window.electronAPI.research.createRun(data)
window.electronAPI.research.updateRun(runId, patch)
window.electronAPI.research.registerArtifact(runId, artifact)
window.electronAPI.research.listArtifacts(runId)
```

Keep write power narrow. The agent can still use file tools for content; IPC exists so the UI can show and refresh structured state.

## Research Orchestrator Prompt Update

Update:

```text
agentin/agents/pro/research-orchestrator/system.md
```

Add rules:

```markdown
## Research Runs
- For any serious research task, create or update a run under `{agent_tasks}/runs/<runId>/`.
- Keep `run.json` current: status, tasks, subagent run ids, artifacts, and final decision.
- Write acceptance criteria before running subagents.
- If acceptance criteria are unclear, ask the user for missing success conditions.
- Register every useful output as an artifact in `artifacts/artifact-index.json`.
- If results fail acceptance, mark the run `needs_rerun` and explain which criteria failed.
- If results pass, mark the run `completed` and write `final/report.md` plus `final/recommendation.md`.
```

The prompt can use normal file tools first. Later, if the run-store IPC/MCP bridge is exposed to agents, the prompt can mention it.

## UI Work

Modify:

```text
agentin/plugins/agent-research-orchestrator-ui/main.js
```

Add a simple Research Runs panel above or beside the existing agent file/artifact UI.

The UI should show:

1. Runs list: title, status, updated time.
2. Selected run summary: goal, acceptance decision, current status.
3. Task list: task title, assigned agent, status, subagent run id.
4. Artifact list: title, kind, owner/source, preview action.
5. Final outputs: report and recommendation links when present.

Use the existing chart renderer for chart artifacts. Do not build chart logic into the plugin.

No heavy UI. This is a management/readout panel, not a dashboard fantasy.

## Agent Workflow Contract

The Research Orchestrator should follow this loop:

1. **Clarify**
   If the user's success criteria are missing, ask for them or propose defaults.

2. **Create**
   Create a run folder and starter `run.json`, `plan.md`, `acceptance.md`.

3. **Plan**
   Break the research into tasks with expected outputs and validation requirements.

4. **Delegate**
   Use `subagent action="run_batch"` for independent tasks.

5. **Collect**
   Read subagent results and copy/summarize useful outputs into the run artifact folder.

6. **Register**
   Add each useful file to `artifact-index.json`.

7. **Validate**
   Compare results against acceptance criteria.

8. **Decide**
   Mark completed, needs_rerun, or needs_user.

9. **Report**
   Write final report and recommendation.

## Part 3 Implementation Order

### Step 1 - Run Store

Create `src/main/research-run-store.js`.

Add tests for:

1. Creates run folder and starter files.
2. Lists runs by owner.
3. Updates status and acceptance decision.
4. Registers artifacts with relative paths only.
5. Rejects paths that escape the run folder.

### Step 2 - IPC

Create:

```text
src/main/ipc/register-research-run-handlers.js
```

Wire it through:

```text
src/main/ipc/register-all-handlers.js
src/renderer/electron-api.js
```

### Step 3 - Research Orchestrator UI

Update:

```text
agentin/plugins/agent-research-orchestrator-ui/main.js
```

Add run list and selected run view. Keep it simple and file-oriented.

### Step 4 - Prompt Update

Update:

```text
agentin/agents/pro/research-orchestrator/system.md
```

Teach it the run loop and acceptance behavior.

### Step 5 - Artifact Preview

Use existing preview paths:

1. Markdown and text via file reader.
2. CSV/JSON as text/table preview.
3. Chart JSON through the chat chart renderer.
4. HTML as an artifact file, not inline arbitrary injection unless sanitized.

### Step 6 - Contracts

Add focused contracts:

```text
tests/contracts/research-run-store-contract.test.js
tests/contracts/research-orchestrator-ui-contract.test.js
tests/contracts/research-artifact-contract.test.js
```

No broad/blocking test run in this part unless explicitly requested.

## Suggested File Changes

| Action | File |
| --- | --- |
| NEW | `src/main/research-run-store.js` |
| NEW | `src/main/ipc/register-research-run-handlers.js` |
| MODIFY | `src/main/ipc/register-all-handlers.js` |
| MODIFY | `src/renderer/electron-api.js` |
| MODIFY | `agentin/plugins/agent-research-orchestrator-ui/main.js` |
| MODIFY | `agentin/agents/pro/research-orchestrator/system.md` |
| NEW | `tests/contracts/research-run-store-contract.test.js` |
| NEW | `tests/contracts/research-artifact-contract.test.js` |
| OPTIONAL | `tests/contracts/research-orchestrator-ui-contract.test.js` |

## What Good Looks Like

After Part 3, a user can say:

```text
Research which local model is best for coding in this app. Compare at least five models and recommend one.
```

The Research Orchestrator should:

1. Create a run folder.
2. Write acceptance criteria.
3. Write a plan.
4. Spawn subagents.
5. Collect their outputs.
6. Register artifacts.
7. Show the run in the Research Orchestrator UI.
8. Produce `final/report.md` and `final/recommendation.md`.
9. Mark the run completed or explain exactly why rerun/user clarification is needed.

## Part 4 Candidate After This

Once this is stable, Part 4 should be provider/model experiment control:

1. Per-agent provider/runtime overrides.
2. Research task matrix with model/provider columns.
3. Headless research CLI mode.
4. Basic scoring and rerun policy.
5. Export bundle for run artifacts.

That unlocks the user's bigger goal: using the app to test what different models can actually do inside a powerful agent system.
