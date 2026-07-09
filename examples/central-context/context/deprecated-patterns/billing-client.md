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
source: "https://github.com/acme/api/pull/456"
---

Use `BillingGateway` for all new billing calls. Do not add new usages of `legacyBillingClient`.
