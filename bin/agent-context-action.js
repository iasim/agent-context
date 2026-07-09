#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const process = require("node:process");
const {
  buildIndex,
  findRelevant,
  formatRelevantMarkdown,
  parseArgs
} = require("../lib/context");

const COMMENT_MARKER = "<!-- agent-context-comment -->";

function input(name, fallback = "") {
  const key = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  return process.env[key] || fallback;
}

function booleanInput(name, fallback = false) {
  const value = input(name, fallback ? "true" : "false").toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function defaultDiffRange() {
  const explicit = input("diff");
  if (explicit) {
    return explicit;
  }
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}...HEAD`;
  }
  return "";
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(eventPath, "utf8"));
}

function githubRequest(method, apiPath, token, body) {
  const payload = body ? JSON.stringify(body) : undefined;
  const options = {
    hostname: "api.github.com",
    path: apiPath,
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "agent-context-action",
      "X-GitHub-Api-Version": "2022-11-28",
      "Authorization": `Bearer ${token}`
    }
  };
  if (payload) {
    options.headers["Content-Type"] = "application/json";
    options.headers["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        const parsed = data ? JSON.parse(data) : {};
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub API ${method} ${apiPath} failed with ${response.statusCode}: ${data}`));
          return;
        }
        resolve(parsed);
      });
    });
    request.on("error", reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

async function upsertComment(markdown) {
  const token = process.env.GITHUB_TOKEN || input("github-token");
  const repository = process.env.GITHUB_REPOSITORY;
  const event = readEvent();
  const issueNumber = event.pull_request?.number || event.issue?.number;

  if (!token || !repository || !issueNumber) {
    return false;
  }

  const [owner, repo] = repository.split("/");
  const commentsPath = `/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  const comments = await githubRequest("GET", commentsPath, token);
  const existing = comments.find((comment) => comment.body && comment.body.includes(COMMENT_MARKER));
  const body = `${COMMENT_MARKER}\n${markdown}`;

  if (existing) {
    await githubRequest("PATCH", `/repos/${owner}/${repo}/issues/comments/${existing.id}`, token, { body });
  } else {
    await githubRequest("POST", commentsPath, token, { body });
  }
  return true;
}

async function main() {
  const cwd = process.cwd();
  const contextDir = input("context-dir", ".agent-context/context");
  const limit = input("limit", "8");
  const task = input("task", "review this pull request");
  const diff = defaultDiffRange();

  const args = parseArgs([
    "relevant",
    "--context-dir",
    contextDir,
    "--limit",
    limit,
    "--task",
    task,
    ...(diff ? ["--diff", diff] : [])
  ]);

  const index = buildIndex(cwd, args);
  const result = findRelevant(cwd, index, args);
  const markdown = formatRelevantMarkdown(result, args);

  console.log(markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }

  if (booleanInput("comment", true)) {
    await upsertComment(markdown);
  }
}

main().catch((error) => {
  console.error(`agent-context-action: ${error.message}`);
  process.exitCode = 1;
});
