# Context Format

Agent Context entries are Markdown files with frontmatter. The Markdown body should contain the actual guidance. The frontmatter makes the guidance retrievable.

## Required Fields

```md
---
id: tenant-scoping-required
title: Tenant scoping is mandatory for customer data
status: active
priority: high
owners: ["platform-team"]
paths: ["src/**", "packages/db/**"]
applies_to: ["implementation", "review"]
source: "https://github.com/acme/api/pull/123"
---
```

## Field Reference

- `id`: stable unique ID.
- `title`: short human-readable name.
- `status`: `active`, `draft`, `deprecated`, or `archived`.
- `priority`: `critical`, `high`, `medium`, or `low`.
- `owners`: people or teams responsible for keeping the context current.
- `repos`: repo names or `owner/repo` values. Use `["*"]` for org-wide guidance.
- `paths`: glob-like file path scopes.
- `applies_to`: `implementation`, `review`, `testing`, `migration`, or any team-defined mode.
- `source`: PR, issue, incident, architecture decision, or manual seed evidence.
- `updated_at`: ISO date string.
- `expires_at`: optional ISO date string for temporary strategy or migration guidance.
- `supersedes`: optional list of older context IDs.

## Good Context

Good context is specific enough to retrieve and enforce:

```md
New billing integrations must call `BillingGateway`. Do not add new usages of
`legacyBillingClient`.
```

Weak context is vague:

```md
Write clean code and follow best practices.
```

If a rule can be checked mechanically, prefer a test, linter, or CI rule. Use Agent Context for judgment-heavy guidance and company-specific direction.
