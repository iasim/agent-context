# Contributing

Agent Context is meant to stay easy to audit and easy to run in private company repos.

## Local Development

```bash
npm test
node bin/agent-context.js relevant --context-dir examples/central-context/context --paths packages/billing/invoices.ts --repo api
```

The project intentionally has no runtime dependencies in the first version.

## Design Rules

- Keep the source of truth in Git.
- Prefer deterministic retrieval before model-based retrieval.
- Make every durable context entry owner-scoped and evidence-backed.
- Keep generated agent adapter files small.
- Do not require a hosted service for basic use.

## Good First Issues

- Add a `cursor` adapter export.
- Add GitHub Checks annotations.
- Add context proposal templates.
- Improve glob matching tests.
- Add a monorepo example.
