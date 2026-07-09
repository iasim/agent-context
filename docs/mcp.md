# MCP Server

Agent Context includes a small stdio MCP server so coding agents can retrieve context live.

```bash
agent-context mcp
```

or:

```bash
agent-context-mcp
```

## Tools

- `get_relevant_context`: returns active context for a repo, changed paths, and task.
- `search_context`: text search over active context.
- `lint_context`: checks the context base for duplicate IDs, missing owners, expired entries, and vague guidance.

## Example Client Configuration

Exact configuration differs by client, but the command is:

```json
{
  "mcpServers": {
    "agent-context": {
      "command": "agent-context",
      "args": ["mcp"]
    }
  }
}
```

Use the GitHub Action for PR comments and MCP for interactive coding agents.
