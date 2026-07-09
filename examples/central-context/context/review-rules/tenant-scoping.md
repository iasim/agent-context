---
id: tenant-scoping-required
title: Tenant scoping is mandatory for customer data
status: active
priority: critical
owners: ["platform-team"]
repos: ["api", "worker"]
paths: ["src/**", "packages/db/**"]
applies_to: ["implementation", "review"]
updated_at: "2026-07-08"
source: "https://github.com/acme/api/pull/123"
---

Any query that touches customer-owned data must include tenant scoping. Reviewers should treat missing tenant scope as blocking.
