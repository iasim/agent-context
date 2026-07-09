---
id: q3-async-reconciliation-direction
title: Prefer async reconciliation over request-time syncing
status: active
priority: medium
owners: ["product-platform"]
repos: ["api", "web"]
paths: ["packages/billing/**", "src/routes/billing/**"]
applies_to: ["implementation", "review"]
updated_at: "2026-07-08"
expires_at: "2026-10-01"
source: "Q3 engineering direction"
---

For billing-facing workflows, prefer async reconciliation jobs over request-time syncing unless the user experience requires immediate consistency.
