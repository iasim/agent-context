# Agent Adapters

Agent Context should not dump the entire company context base into `AGENTS.md`, `CLAUDE.md`, or `REVIEW.md`.

Those files are compatibility adapters. They should be small and tell agents how to retrieve current context.

```bash
agent-context export --target codex,claude,review --out .agent-context/exports
```

Generated files:

- `AGENTS.md` for Codex and agents that read the open `AGENTS.md` convention.
- `CLAUDE.md` for Claude Code.
- `REVIEW.md` for review-specific tools and agents.

In mature setups, use the GitHub Action or MCP server to retrieve context live. Adapter files are useful for tools that only know how to read static Markdown.
