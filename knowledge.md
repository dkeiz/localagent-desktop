# Knowledge Layer for LocalAgent

## Summary

- Introduce `knowledge` as a separate file-first subsystem for reusable research and promoted artifacts, distinct from:
  - memory = chronological append-only history
  - skills = behavioral prompts/toolchain guidance
  - workflows = executable automations
  - workspaces = ephemeral scratch/output
- Keep `agentin/workspaces/` ephemeral. Persistent reuse happens by promotion into `agentin/knowledge/`.
- Let the model decide when to retrieve knowledge; never preload the whole store. Only preload the contract in root `knowledge.md`.
- Reuse the existing background memory daemon for v1 knowledge-shift work so this ships without a second scheduler.

## Key Decisions

- File-first + DB index
  - Store content in files under `agentin/knowledge/`; store metadata, embeddings, stats, freshness, and scope in SQLite.
  - Pro: matches current workflow/prompt architecture and stays human-inspectable.
  - Con: needs explicit file-to-DB sync logic.
- Separate workspace from knowledge
  - `workspace` stays disposable scratch.
  - `research` becomes the persistent iterative workspace for multi-step/selfresearch tasks.
  - Pro: avoids clutter and context rot in normal sessions.
  - Con: requires a promotion/finalization step.
- Dynamic retrieval, not auto-injection
  - Model uses knowledge tools when task context suggests prior project/research material is useful.
  - Pro: prevents context rot.
  - Con: prompt guidance and search quality matter more.
- Staged growth instead of blind self-growth
  - Background daemon can create `staging` candidates from memory, research, and promoted artifacts.
  - Promotion to stable `library` requires validation rules: summary present, provenance recorded, and freshness or verification data when needed.
  - Pro: knowledge can grow without turning into garbage.
  - Con: adds lifecycle states.

## Implementation Changes

- Create root `knowledge.md` as the contract for the system. It should define:
  - what knowledge is and is not
  - the distinction vs memory, skills, workflows, and workspaces
  - lifecycle: `workspace -> research/staging -> library -> stale/archive`
  - anti-rot rules
  - selfresearch loop and examples
- Add `agentin/knowledge/` with typed folders:
  - `library/` stable distilled knowledge items
  - `research/` persistent multi-iteration task/research runs
  - `artifacts/` promoted raw or parsed outputs from workspaces
  - `staging/` daemon-generated or manually promoted candidates
- Store each knowledge item as a folder, not a single giant file:
  - `meta.json` for type, scope, status, tags, provenance, timestamps, confidence, and related item ids
  - `summary.md` for retrieval-friendly distilled content
  - optional `artifacts/` for raw files
  - research items also get `iterations/*.md` and `final.md`
- Add `KnowledgeManager` and wire it in `src/main/main.js` next to `AgentMemory`, `WorkflowManager`, and `SessionWorkspace`.
- Add DB metadata support in `src/main/database.js` for knowledge items and retrieval state. Keep files as source of truth; DB is an index.
- Add MCP tools in `src/main/mcp-server.js` and expose them in a new `knowledge` capability group:
  - `list_knowledge`
  - `search_knowledge`
  - `read_knowledge`
  - `create_knowledge_note`
  - `promote_workspace_artifact`
  - `start_research_run`
  - `append_research_iteration`
  - `finalize_research_run`
- Retrieval rules:
  - index `title + summary + tags + selected provenance`, not full raw artifact bodies
  - filter by `scope`, `type`, and `status` before semantic ranking
  - default search excludes `staging`, `stale`, and archived items unless explicitly requested
- Scope model:
  - support `global`, `agent:<slug>`, and `task/research:<id>` scopes in metadata
  - physical layout stays type-first; scope lives in metadata so browsing stays simple
- Prompt/runtime integration:
  - extend `src/main/inference-dispatcher.js` with `knowledge_guidance`
  - session start still loads memory/workflow identity files, but not the knowledge store
  - instruct the model to use knowledge tools for durable project/research context and to prefer live tools for volatile facts
- Background curation:
  - extend `src/main/background-memory-daemon.js` to do a separate knowledge-shift pass
  - inputs: daily/task memory, finalized research runs, explicit workspace promotions
  - outputs: staged candidates, stale marking, and verification reminders
  - do not auto-delete; only mark stale or move to archive

## Root `knowledge.md` Contents

- Title and one-sentence definition of knowledge in this app
- Layer map:
  - permissions/tools/calls = execution control
  - memory = continuity
  - skills = behavior
  - workflows = execution patterns
  - knowledge = reusable content and evidence
- Folder layout and item schema
- Promotion rules
- Retrieval rules
- Selfresearch loop:
  - create run
  - collect artifacts
  - append iteration reflections
  - finalize synthesis
  - optionally promote distilled result to library
- Rot controls:
  - no wholesale preload
  - explicit provenance
  - freshness and verification timestamps
  - staged candidates before stable promotion
  - split large runs into multiple small files so no file exceeds 1000 lines

## Test Plan

- Knowledge note creation writes folder files first, then syncs DB index and embedding.
- Workspace artifact promotion copies the selected file into `agentin/knowledge/artifacts/` and produces a searchable summary without mutating the original workspace file.
- Research run lifecycle works end to end:
  - create run
  - append iterations
  - finalize run
  - search returns the final synthesis, not raw logs by default
- Dynamic retrieval does not preload large knowledge bodies on chat start.
- Background knowledge-shift can create staged candidates from memory without changing original memory files.
- Stale items are hidden from default search and only shown when explicitly included.
- Keep verification lightweight: targeted manager/tool smoke tests only, no long blocking test runs.

## Assumptions and Defaults

- `knowledge.md` lives at repo root as the human contract; operational files live under `agentin/knowledge/`.
- V1 uses the existing memory daemon for knowledge shifting instead of introducing a second daemon.
- Knowledge summaries are mutable, but raw promoted artifacts and research iteration files are treated as immutable evidence.
- Normal task scratch stays in `agentin/workspaces/`; only selected outputs become knowledge.
- UI can follow later; backend, tools, folder contract, and prompt guidance come first.
