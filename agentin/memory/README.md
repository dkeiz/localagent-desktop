# Agent Memory System

This folder contains the agent's persistent memory organized by type.

## Folder Structure

- `daily/` - Daily work logs (1 file per day, e.g., `2026-02-07.md`)
- `global/` - Permanent preferences and important user details
- `tasks/` - Task-specific memory for major agent work
- `images/` - Visual captures from screenshot tool

## Memory Rules

1. **Append-Only**: New entries are added, not modified
2. **Auto-Lock**: Entries older than 7 days become immutable
3. **Tamper Verification**: Hash-based integrity checking

## Usage

The agent automatically creates and manages files in these folders.
User should not manually edit files to preserve integrity verification.
