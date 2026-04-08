# Subagent Architecture

This project should treat "subagent" as one capability with two invocation modes.

## 1. Delegated Subtask

Use this when one agent calls another agent as a worker.

- Starts from a parent agent/tool call, not from a user opening a chat.
- Should return an immediate backend acknowledgment such as `accepted`, `run_id`, and `status: queued|running`.
- Should be mostly invisible to the user unless the parent chooses to surface progress or the final result.
- Should write a predictable run folder under `agentin/subtasks/<run-id>/`.
- Parent may inspect that run folder later with existing file tools. This is optional, not required behavior.
- Child must finish with a structured JSON result contract.
- Result should be autosent to the parent through durable delivery, with the backend event bus used as notification rather than storage.
- Run files can remain temporary, for example about 24 hours, and be cleaned later by background maintenance.

Suggested delegated run files:

- `request.json`
- `status.json`
- `result.json`
- `trace.md` or `messages.jsonl`
- `artifacts/`

Prompt guidance for delegated runs:

- Tell the child that the parent may inspect the run folder and transcript if clarification is needed.
- Tell the child to keep large outputs in files when useful.
- Do not make transcript inspection mandatory for normal success flow.

## 2. Direct User-Opened Subagent Chat

Use this when the user explicitly opens or talks to a subagent as its own chat.

- This is a normal chat session, not a hidden worker run.
- It should be treated respectfully as a first-class conversation.
- The user should see that chat, its history, and the subagent identity directly.
- It should not inherit hidden delegated-run behavior just because the target agent happens to be a subagent.

## Core Rule

Behavior is determined by invocation mode, not by the agent label alone.

- Same agent can participate in delegated runs and direct chats.
- Delegated run: worker semantics, file-backed run contract, autosend result to parent.
- Direct chat: normal visible chat semantics.

## Design Intent

Keep the backend simple:

- file-backed delegated run state
- event bus for status notification
- durable result delivery to parent
- existing file tools for optional inspection

Avoid turning delegated debugging aids into required orchestration steps.
