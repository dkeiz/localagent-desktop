# RAG Dataset Generation Skill

## Purpose
This skill provides mistake-free guidance for any agent working with RAG (Retrieval-Augmented Generation) datasets.

## Core Workflow

### 1. Dataset Ingestion
```json
TOOL:plugin_agent_rag_studio_dataset{
  "action": "ingest",
  "title": "dataset-name",
  "text": "inline text content",
  "file_paths": ["/path/to/file.txt"],
  "directory_paths": ["/path/to/folder"],
  "urls": ["https://example.com/page"]
}
```

**Best Practices:**
- Use descriptive titles (lowercase, hyphenated)
- Group related content into single datasets
- For large folders, ingest directory_paths not individual files
- Validate ingestion with action="list" after

### 2. Mode Creation
```json
TOOL:plugin_agent_rag_studio_mode{
  "action": "create",
  "name": "mode-name",
  "guidance": "When to use this mode",
  "top_k": 5,
  "min_score": 0.6,
  "dataset_ids": ["dataset-id-from-ingestion"]
}
```

**Best Practices:**
- Create one mode per use case (support, research, docs)
- Set min_score 0.5-0.7 to filter weak matches
- Link only relevant datasets to each mode
- Activate mode after creation

### 3. Add Hard-Wired Rules (For FAQs)
```json
TOOL:plugin_agent_rag_studio_mode{
  "action": "add_rule",
  "mode_id": "mode-id",
  "pattern": "reset password",
  "answer": "To reset password, go to Settings > Security > Reset",
  "match_type": "contains"
}
```

**Match Types:**
- `contains` - Pattern anywhere in question
- `exact` - Exact match required
- `regex` - Regular expression pattern

### 4. Activate Mode
```json
TOOL:plugin_agent_rag_studio_mode{
  "action": "activate",
  "mode_id": "mode-id"
}
```

### 5. Query Dataset
```json
TOOL:plugin_agent_rag_studio_query{
  "query": "user question here",
  "mode_id": "optional-mode-override",
  "top_k": 3
}
```

## Common Mistakes to Avoid

| Mistake | Fix |
|---------|-----|
| Querying without active mode | Always activate mode first or specify mode_id |
| Ingesting without checking result | Use action="inspect" to verify chunks |
| Too low min_score | Set 0.5+ to avoid irrelevant matches |
| Mixing unrelated content | Keep datasets topic-specific |
| Forgetting to list datasets | Use action="list" to get dataset_ids |

## Quick Reference Commands

```
# Check status
TOOL:plugin_agent_rag_studio_status{}

# List datasets
TOOL:plugin_agent_rag_studio_dataset{"action":"list"}

# List modes
TOOL:plugin_agent_rag_studio_mode{"action":"list"}

# Inspect dataset
TOOL:plugin_agent_rag_studio_dataset{"action":"inspect","dataset_id":"ds-xxx"}
```

## Example: TechSupport Dataset Setup

1. Ingest Q&A file:
   ```
   action="ingest", title="techsupport-faq", file_paths=["C:/support/qa.txt"]
   ```

2. Create mode:
   ```
   action="create", name="techsupport-mode", dataset_ids=["ds-xxx"]
   ```

3. Add rules for top 10 questions:
   ```
   action="add_rule", pattern="refund", answer="30-day refund policy..."
   ```

4. Activate & query!

---
**Skill Version:** 1.0
**Created For:** Universal RAG Agent
**Location:** {agentin}/skills/rag-dataset-workflow.md
