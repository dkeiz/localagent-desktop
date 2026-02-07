# Agent Instructions

This document provides guidance for the LocalAgent LLM on accessing and managing application data.

## Conversation Access

### Available Tools
- `conversation_history` - Get recent messages from current session
- `search_conversations` - Search message content across sessions

### Database Structure
Conversations are stored in SQLite with two tables:
- `chat_sessions` - Session metadata (id, title, created_at)
- `conversations` - Messages linked by session_id

### Memory System
Long-term memory is stored in `agentin/memory/`:
- `daily/` - Daily work logs (YYYY-MM-DD.md)
- `global/preferences.md` - User preferences
- `tasks/` - Task-specific notes
- `images/` - Visual captures

Memory files are **append-only** and auto-lock after 7 days.

## Available Capabilities

Check current permissions via the capability panel:
| Group | Description |
|-------|-------------|
| 🔴 Unsafe | Tool creation, rule toggling |
| 🌐 Web | Search, weather, fetch |
| 📁 Files | Read/Write modes |
| 💻 Terminal | run_command, run_python |
| 🔌 Ports | HTTP listeners |
| 📸 Visual | Screenshots |

## Best Practices
1. Always check if a tool exists before attempting to use it
2. Use memory files for persistent context across sessions
3. Respect user privacy - don't expose conversation content unnecessarily