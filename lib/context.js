"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CONTEXT_DIRS = [".agent-context/context", "context"];
const ACTIVE_STATUSES = new Set(["active", "draft"]);
const VALID_STATUSES = new Set(["active", "draft", "deprecated", "archived"]);

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("-")) {
      result._.push(arg);
      continue;
    }
    const trimmed = arg.replace(/^-+/, "");
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex >= 0) {
      result[trimmed.slice(0, equalIndex)] = trimmed.slice(equalIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("-")) {
      result[trimmed] = true;
      continue;
    }
    result[trimmed] = next;
    index += 1;
  }
  return result;
}

function printHelp() {
  console.log(`Agent Context

Usage:
  agent-context init
  agent-context index [--context-dir .agent-context/context]
  agent-context relevant [--diff main...HEAD] [--paths "src/a.ts,src/b.ts"] [--task "..."]
  agent-context search "tenant scoping"
  agent-context lint
  agent-context export --target codex,claude,review [--out .agent-context/exports]

Core idea:
  Keep large engineering context in Git. Retrieve only what applies to a branch or PR.`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfMissing(file, content, force) {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file) && !force) {
    return false;
  }
  fs.writeFileSync(file, content);
  return true;
}

function createSampleContext(cwd, options = {}) {
  const force = Boolean(options.force);
  const created = [];
  const skipped = [];
  const files = new Map([
    [
      path.join(cwd, "agent-context.config.json"),
      `${JSON.stringify(
        {
          contextDir: ".agent-context/context",
          indexFile: ".agent-context/index.json",
          defaultLimit: 8,
          adapters: {
            outDir: ".agent-context/exports"
          }
        },
        null,
        2
      )}\n`
    ],
    [
      path.join(cwd, ".agent-context/context/review-rules/tenant-scoping.md"),
      `---
id: tenant-scoping-required
title: Tenant scoping is mandatory for customer data
status: active
priority: high
owners: ["platform-team"]
repos: ["*"]
paths: ["src/**", "packages/db/**"]
applies_to: ["implementation", "review"]
updated_at: "2026-07-08"
source: "manual seed"
---

Any query that touches customer-owned data must include tenant scoping. Treat missing tenant scope as blocking in review.
`
    ],
    [
      path.join(cwd, ".agent-context/context/deprecated-patterns/legacy-client.md"),
      `---
id: legacy-client-deprecated
title: Do not introduce new legacy client calls
status: active
priority: medium
owners: ["platform-team"]
repos: ["*"]
paths: ["src/**", "packages/**"]
applies_to: ["implementation", "review"]
updated_at: "2026-07-08"
source: "manual seed"
---

Do not add new usages of deprecated client wrappers. Prefer the current gateway or service adapter for the domain being changed.
`
    ],
    [
      path.join(cwd, ".github/workflows/agent-context.yml"),
      `name: Agent Context

on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

jobs:
  context:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: your-org/agent-context@v1
        with:
          context-dir: .agent-context/context
          comment: true
`
    ]
  ]);

  for (const [file, content] of files) {
    if (writeIfMissing(file, content, force)) {
      created.push(file);
    } else {
      skipped.push(file);
    }
  }

  return { created, skipped };
}

function readConfig(cwd, args = {}) {
  const configFile = args.config || "agent-context.config.json";
  const resolved = path.resolve(cwd, configFile);
  if (!fs.existsSync(resolved)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function resolveContextDir(cwd, args = {}) {
  const config = readConfig(cwd, args);
  const explicit = args["context-dir"] || args.contextDir || config.contextDir;
  if (explicit) {
    return path.resolve(cwd, explicit);
  }
  for (const candidate of DEFAULT_CONTEXT_DIRS) {
    const resolved = path.resolve(cwd, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return path.resolve(cwd, DEFAULT_CONTEXT_DIRS[0]);
}

function resolveIndexFile(cwd, args = {}) {
  const config = readConfig(cwd, args);
  return path.resolve(cwd, args.index || args["index-file"] || config.indexFile || ".agent-context/index.json");
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) {
    return { frontmatter: {}, body: raw.trim() };
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw.trim() };
  }
  return {
    frontmatter: parseFrontmatter(match[1]),
    body: match[2].trim()
  };
}

function parseFrontmatter(text) {
  const data = {};
  let currentKey = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("- ") && currentKey) {
      const current = Array.isArray(data[currentKey]) ? data[currentKey] : [];
      current.push(parseScalar(line.slice(2)));
      data[currentKey] = current;
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    currentKey = match[1];
    data[currentKey] = parseValue(match[2]);
  }
  return data;
}

function parseValue(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return splitCsv(inner).map(parseScalar);
  }
  return parseScalar(trimmed);
}

function splitCsv(value) {
  const parts = [];
  let current = "";
  let quote = "";
  for (const char of value) {
    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      current += char;
      continue;
    }
    if (char === "," && !quote) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  return trimmed;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [String(value)];
}

function titleFromBody(body, fallback) {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

function normalizeItem(file, contextDir, raw) {
  const { frontmatter, body } = splitFrontmatter(raw);
  const relativeFile = path.relative(contextDir, file).split(path.sep).join("/");
  const id = String(frontmatter.id || relativeFile.replace(/\.md$/, "").replace(/[^A-Za-z0-9_-]+/g, "-"));
  const title = String(frontmatter.title || titleFromBody(body, id));
  const owners = toArray(frontmatter.owners || frontmatter.owner);
  const status = String(frontmatter.status || "active");
  const priority = String(frontmatter.priority || "medium");
  const repos = toArray(frontmatter.repos || frontmatter.repo);
  const paths = toArray(frontmatter.paths || frontmatter.path);
  const appliesTo = toArray(frontmatter.applies_to || frontmatter.appliesTo || frontmatter.applies);
  const tags = toArray(frontmatter.tags);
  const supersedes = toArray(frontmatter.supersedes);

  return {
    id,
    title,
    status,
    priority,
    owners,
    repos,
    paths,
    appliesTo,
    tags,
    supersedes,
    updatedAt: frontmatter.updated_at || frontmatter.updatedAt || "",
    expiresAt: frontmatter.expires_at || frontmatter.expiresAt || "",
    source: frontmatter.source || frontmatter.source_pr || "",
    file,
    relativeFile,
    body,
    text: `${title}\n${tags.join(" ")}\n${body}`
  };
}

function buildIndex(cwd, args = {}) {
  const contextDir = resolveContextDir(cwd, args);
  const files = walkFiles(contextDir);
  const items = files.map((file) => normalizeItem(file, contextDir, fs.readFileSync(file, "utf8")));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    contextDir,
    items
  };
}

function writeIndex(cwd, index, args = {}) {
  const indexFile = resolveIndexFile(cwd, args);
  ensureDir(path.dirname(indexFile));
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  return indexFile;
}

function loadIndexOrBuild(cwd, args = {}) {
  const indexFile = resolveIndexFile(cwd, args);
  if (!args.fresh && fs.existsSync(indexFile)) {
    return JSON.parse(fs.readFileSync(indexFile, "utf8"));
  }
  return buildIndex(cwd, args);
}

function runGit(cwd, args) {
  try {
    return childProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return "";
  }
}

function parsePaths(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return String(value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function changedPathsFromArgs(cwd, args = {}) {
  const explicit = parsePaths(args.paths || args.path);
  if (explicit.length) {
    return explicit;
  }
  if (args.diff) {
    return runGit(cwd, ["diff", "--name-only", String(args.diff)])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function diffTextFromArgs(cwd, args = {}) {
  if (args["diff-text"]) {
    return String(args["diff-text"]);
  }
  if (args.diff) {
    return runGit(cwd, ["diff", "--unified=0", String(args.diff)]).slice(0, 200000);
  }
  return "";
}

function currentRepo(cwd, args = {}) {
  if (args.repo) {
    return String(args.repo);
  }
  const remote = runGit(cwd, ["config", "--get", "remote.origin.url"]).trim();
  const match = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (match) {
    return match[1];
  }
  return path.basename(cwd);
}

function tokenize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function matchGlob(pattern, target) {
  if (!pattern || pattern === "*") {
    return true;
  }
  const normalizedPattern = pattern.split(path.sep).join("/");
  const normalizedTarget = target.split(path.sep).join("/");
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`);
  }
  return globToRegExp(normalizedPattern).test(normalizedTarget);
}

function repoMatches(itemRepos, repo) {
  if (!itemRepos.length) {
    return { matches: true, specific: false };
  }
  const normalizedRepo = repo.toLowerCase();
  const matches = itemRepos.some((candidate) => {
    const lowered = candidate.toLowerCase();
    return lowered === "*" || lowered === normalizedRepo || lowered.endsWith(`/${normalizedRepo}`);
  });
  return { matches, specific: true };
}

function pathMatches(itemPaths, changedPaths) {
  if (!itemPaths.length || !changedPaths.length) {
    return [];
  }
  const matches = [];
  for (const changedPath of changedPaths) {
    for (const pattern of itemPaths) {
      if (matchGlob(pattern, changedPath)) {
        matches.push({ path: changedPath, pattern });
        break;
      }
    }
  }
  return matches;
}

function priorityScore(priority) {
  if (priority === "critical") {
    return 4;
  }
  if (priority === "high") {
    return 3;
  }
  if (priority === "medium") {
    return 1;
  }
  return 0;
}

function scoreItem(item, query) {
  if (!ACTIVE_STATUSES.has(item.status)) {
    return null;
  }

  const repoMatch = repoMatches(item.repos, query.repo);
  if (!repoMatch.matches) {
    return null;
  }

  const matchedPaths = pathMatches(item.paths, query.changedPaths);
  const itemTokens = tokenize(item.text);
  const queryTokens = tokenize(`${query.task}\n${query.diffText}\n${query.changedPaths.join("\n")}`);
  const overlap = [...queryTokens].filter((token) => itemTokens.has(token));

  let score = priorityScore(item.priority);
  const reasons = [];

  if (repoMatch.specific) {
    score += 5;
    reasons.push(`repo matches ${query.repo}`);
  }

  if (matchedPaths.length) {
    score += 14 + Math.min(matchedPaths.length, 4);
    const sample = matchedPaths.slice(0, 3).map((match) => `${match.path} (${match.pattern})`).join(", ");
    reasons.push(`path scope matched ${sample}`);
  } else if (!item.paths.length) {
    score += 1;
    reasons.push("global path scope");
  }

  if (overlap.length) {
    score += Math.min(10, overlap.length * 1.5);
    reasons.push(`text matched ${overlap.slice(0, 8).join(", ")}`);
  }

  if (!matchedPaths.length && item.paths.length && query.changedPaths.length && overlap.length < 2) {
    return null;
  }

  return {
    item,
    score,
    reasons,
    matchedPaths,
    matchedTerms: overlap.slice(0, 20)
  };
}

function findRelevant(cwd, index, args = {}) {
  const changedPaths = changedPathsFromArgs(cwd, args);
  const diffText = diffTextFromArgs(cwd, args);
  const repo = currentRepo(cwd, args);
  const limit = Number(args.limit || args.l || 8);
  const query = {
    repo,
    changedPaths,
    diffText,
    task: args.task || args.query || "",
    generatedAt: new Date().toISOString()
  };

  const matches = index.items
    .map((item) => scoreItem(item, query))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit);

  return {
    query,
    matches,
    totalActive: index.items.filter((item) => ACTIVE_STATUSES.has(item.status)).length,
    contextDir: index.contextDir
  };
}

function searchContext(index, queryText, args = {}) {
  const limit = Number(args.limit || args.l || 8);
  const queryTokens = tokenize(queryText);
  const matches = index.items
    .filter((item) => ACTIVE_STATUSES.has(item.status))
    .map((item) => {
      const itemTokens = tokenize(item.text);
      const overlap = [...queryTokens].filter((token) => itemTokens.has(token));
      return {
        item,
        score: overlap.length + priorityScore(item.priority),
        reasons: overlap.length ? [`text matched ${overlap.join(", ")}`] : [],
        matchedPaths: [],
        matchedTerms: overlap
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit);

  return {
    query: {
      repo: "",
      changedPaths: [],
      diffText: "",
      task: queryText,
      generatedAt: new Date().toISOString()
    },
    matches,
    totalActive: index.items.filter((item) => ACTIVE_STATUSES.has(item.status)).length,
    contextDir: index.contextDir
  };
}

function trimBody(body) {
  const singleLine = body.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 260) {
    return singleLine;
  }
  return `${singleLine.slice(0, 257)}...`;
}

function formatRelevantMarkdown(result) {
  const lines = [];
  lines.push("# Relevant Engineering Context");
  lines.push("");
  if (result.query.changedPaths.length) {
    lines.push(`Changed paths: ${result.query.changedPaths.slice(0, 8).map((item) => `\`${item}\``).join(", ")}${result.query.changedPaths.length > 8 ? " ..." : ""}`);
    lines.push("");
  }
  if (!result.matches.length) {
    lines.push("No active context entries matched this change.");
    return lines.join(os.EOL);
  }

  result.matches.forEach((match, index) => {
    const item = match.item;
    lines.push(`## ${index + 1}. ${item.title}`);
    lines.push("");
    lines.push(`- ID: \`${item.id}\``);
    lines.push(`- Priority: ${item.priority}`);
    if (item.owners.length) {
      lines.push(`- Owners: ${item.owners.join(", ")}`);
    }
    if (match.reasons.length) {
      lines.push(`- Why it matched: ${match.reasons.join("; ")}`);
    }
    if (item.source) {
      lines.push(`- Source: ${item.source}`);
    }
    lines.push("");
    lines.push(trimBody(item.body));
    lines.push("");
  });

  return lines.join(os.EOL).trimEnd();
}

function lintContext(index) {
  const issues = [];
  const seenIds = new Map();
  const now = new Date();

  for (const item of index.items) {
    if (seenIds.has(item.id)) {
      issues.push({
        level: "error",
        id: item.id,
        file: item.relativeFile,
        message: `duplicate id also used by ${seenIds.get(item.id)}`
      });
    } else {
      seenIds.set(item.id, item.relativeFile);
    }

    if (!item.id) {
      issues.push({ level: "error", file: item.relativeFile, message: "missing id" });
    }
    if (!item.title) {
      issues.push({ level: "error", id: item.id, file: item.relativeFile, message: "missing title" });
    }
    if (!VALID_STATUSES.has(item.status)) {
      issues.push({ level: "error", id: item.id, file: item.relativeFile, message: `invalid status ${item.status}` });
    }
    if (!item.owners.length) {
      issues.push({ level: "warning", id: item.id, file: item.relativeFile, message: "missing owners" });
    }
    if (!item.source) {
      issues.push({ level: "warning", id: item.id, file: item.relativeFile, message: "missing source evidence" });
    }
    if (item.status === "active" && item.expiresAt) {
      const expiresAt = new Date(item.expiresAt);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt < now) {
        issues.push({ level: "warning", id: item.id, file: item.relativeFile, message: `active context expired at ${item.expiresAt}` });
      }
    }
    if (item.body.length > 2500) {
      issues.push({ level: "warning", id: item.id, file: item.relativeFile, message: "body is long; consider splitting scoped context" });
    }
    if (/write clean code|best practices|be careful/i.test(item.body)) {
      issues.push({ level: "warning", id: item.id, file: item.relativeFile, message: "context may be too vague to enforce" });
    }
  }

  return { issues };
}

function adapterContent(target) {
  const toolLine = "Run `agent-context relevant --diff main...HEAD --task \"describe the change\"` or use the Agent Context MCP/GitHub Action when available.";
  if (target === "codex") {
    return `# AGENTS.md

This repository uses Agent Context for current engineering guidance.

Do not treat this file as the full source of company context. Before implementation or review, retrieve relevant guidance from the context base.

${toolLine}
`;
  }
  if (target === "claude") {
    return `# CLAUDE.md

This repository uses Agent Context for current engineering guidance.

Before implementation or review, retrieve relevant context for the changed files and task. Keep this file small; large durable guidance belongs in the Agent Context repo.

${toolLine}
`;
  }
  if (target === "review") {
    return `# REVIEW.md

Use Agent Context before reviewing pull requests.

Review comments should cite relevant active context when a change violates current engineering direction, deprecated-pattern guidance, or team-owned review rules.

${toolLine}
`;
  }
  throw new Error(`unknown adapter target ${target}`);
}

function exportAdapters(cwd, args = {}) {
  const targets = String(args.target || args.targets || "codex,claude,review")
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
  const outDir = path.resolve(cwd, args.out || ".agent-context/exports");
  ensureDir(outDir);

  const fileNames = {
    codex: "AGENTS.md",
    claude: "CLAUDE.md",
    review: "REVIEW.md"
  };
  const files = [];
  for (const target of targets) {
    const fileName = fileNames[target];
    if (!fileName) {
      throw new Error(`unknown export target ${target}`);
    }
    const file = path.join(outDir, fileName);
    fs.writeFileSync(file, adapterContent(target));
    files.push(file);
  }
  return { files };
}

module.exports = {
  buildIndex,
  createSampleContext,
  exportAdapters,
  findRelevant,
  formatRelevantMarkdown,
  lintContext,
  loadIndexOrBuild,
  parseArgs,
  printHelp,
  searchContext,
  writeIndex
};
