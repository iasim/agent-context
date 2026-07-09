"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildIndex,
  createSampleContext,
  exportAdapters,
  findRelevant,
  lintContext,
  searchContext
} = require("../lib/context");

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-context-test-"));
}

test("init creates sample context and index reads entries", () => {
  const cwd = tmpRepo();
  const result = createSampleContext(cwd);
  assert.ok(result.created.length >= 3);

  const index = buildIndex(cwd);
  assert.equal(index.items.length, 2);
  assert.ok(index.items.some((item) => item.id === "tenant-scoping-required"));
});

test("relevance prefers path-scoped context", () => {
  const cwd = tmpRepo();
  createSampleContext(cwd);
  const index = buildIndex(cwd);
  const result = findRelevant(cwd, index, {
    paths: "packages/db/customer.ts",
    task: "add customer query with tenant"
  });

  assert.ok(result.matches.length >= 1);
  assert.equal(result.matches[0].item.id, "tenant-scoping-required");
  assert.ok(result.matches[0].reasons.some((reason) => reason.includes("path scope matched")));
});

test("search finds matching active context", () => {
  const cwd = tmpRepo();
  createSampleContext(cwd);
  const index = buildIndex(cwd);
  const result = searchContext(index, "deprecated client wrappers");
  assert.ok(result.matches.some((match) => match.item.id === "legacy-client-deprecated"));
});

test("lint flags duplicate IDs", () => {
  const cwd = tmpRepo();
  createSampleContext(cwd);
  const duplicateDir = path.join(cwd, ".agent-context/context/duplicates");
  fs.mkdirSync(duplicateDir, { recursive: true });
  fs.writeFileSync(
    path.join(duplicateDir, "copy.md"),
    `---
id: tenant-scoping-required
title: Copy
status: active
owners: ["team"]
source: "test"
---

Copy body.
`
  );

  const result = lintContext(buildIndex(cwd));
  assert.ok(result.issues.some((issue) => issue.level === "error" && issue.message.includes("duplicate id")));
});

test("export writes adapter files", () => {
  const cwd = tmpRepo();
  const result = exportAdapters(cwd, { target: "codex,claude,review" });
  assert.equal(result.files.length, 3);
  assert.ok(fs.existsSync(path.join(cwd, ".agent-context/exports/AGENTS.md")));
});

test("package exposes MCP executable", () => {
  const packageJson = require("../package.json");
  assert.equal(packageJson.bin["agent-context-mcp"], "bin/agent-context-mcp.js");
});
