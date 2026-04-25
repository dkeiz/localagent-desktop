# Global Task Queue

This file is the source of truth for distributed tasks shared by chat and daemon listeners.
Edit only task lines inside queue markers.

<!-- TASK_QUEUE:BEGIN -->
- [x] id:T-1777049156307-kcanj | status:done | listener:daemon | owner:daemon | run_id:daemon-1777051338859-bf6a26 | requires_user_action:0 | priority:normal | dedupe:daemon:summarize_session:266 | action:daemon.enqueue_memory_job | payload:{"jobType":"summarize_session","sessionId":266,"source":"session_close","enqueued_at":"2026-04-24T16:45:56.304Z"} | title:Summarize closed session 266 | by:agent-loop | at:2026-04-24T16:45:56.306Z | run_after:2026-04-24T16:51:34.710Z | updated_at:2026-04-24T17:22:18.879Z | completed_at:2026-04-24T17:22:18.873Z | summary:Executed action daemon.enqueue_memory_job | last_error:Resources busy
<!-- TASK_QUEUE:END -->
