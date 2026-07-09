# Agent Context

Agent Context is a repo-first way to keep company engineering context useful for coding agents and pull request review.

It gives teams a central context base, indexes it locally, and retrieves only the guidance that applies to the files, symbols, and intent of a branch or PR.

The first version is intentionally small:

- Markdown context files with frontmatter
- zero-dependency Node.js CLI
- path-aware relevance scoring
- context linting
- generated adapter files for Codex, Claude, and review tools
- GitHub Action wrapper for PR comments
- stdio MCP server for coding agents

## Why this exists

`AGENTS.md`, `CLAUDE.md`, and `REVIEW.md` are useful, but they are not a good home for a whole company's evolving engineering memory. They should stay small. Agent Context keeps the large source of truth in Git and lets agents retrieve the relevant slice when work is happening.

## Quick Start

```bash
npx github:iasim/agent-context init
npx github:iasim/agent-context index
npx github:iasim/agent-context relevant --paths "packages/billing/invoices.ts" --task "add usage-based billing"
```

After installing from source or a package manager, use the shorter `agent-context` command shown below.

For a branch diff:

```bash
agent-context relevant --diff main...HEAD --task "review this PR"
```

Lint the context base:

```bash
agent-context lint
```

Generate small adapter files:

```bash
agent-context export --target codex,claude,review --out .agent-context/exports
```

Run the MCP server:

```bash
agent-context mcp
```

## Context File

Context entries are Markdown files with frontmatter:

```md
---
id: billing-gateway-required
title: Use BillingGateway for new billing calls
status: active
priority: high
owners: ["billing-platform"]
repos: ["api", "worker"]
paths: ["packages/billing/**"]
applies_to: ["implementation", "review"]
updated_at: "2026-07-08"
source: "https://github.com/acme/api/pull/123"
---

Use `BillingGateway` for all new billing calls. Do not add new usages of
`legacyBillingClient`.
```

## GitHub Action

```yaml
name: Agent Context

on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

jobs:
  context:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: iasim/agent-context@v0.1.1
        with:
          context-dir: .agent-context/context
          comment: true
```

For a separate context repo, check it out before this action:

```yaml
      - uses: actions/checkout@v4
        with:
          repository: acme/engineering-context
          path: engineering-context
      - uses: iasim/agent-context@v0.1.1
        with:
          context-dir: engineering-context/context
```

## Commands

```txt
agent-context init
agent-context index
agent-context relevant --diff main...HEAD
agent-context relevant --paths "app/**,packages/billing/foo.ts" --task "review billing changes"
agent-context search "tenant scoping"
agent-context lint
agent-context export --target codex,claude,review
agent-context mcp
```

## Design Principles

- Git is the source of truth.
- Context entries should have owners, scope, and evidence.
- Agent files are adapters, not the knowledge base.
- Human approval should control durable context changes.
- Basic use should not require a hosted service or model API key.

## Status

This is an early open-source seed. It is useful for experimenting with repo-owned context retrieval today, and intentionally leaves room for embeddings, richer stale-context detection, and context-update proposals.

## MCP

Agent Context exposes three MCP tools:

- `get_relevant_context`
- `search_context`
- `lint_context`

See [docs/mcp.md](docs/mcp.md).
