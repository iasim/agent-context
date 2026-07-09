#!/usr/bin/env node
"use strict";

const process = require("node:process");
const {
  buildIndex,
  findRelevant,
  formatRelevantMarkdown,
  lintContext,
  searchContext
} = require("../lib/context");

const PROTOCOL_VERSION = "2024-11-05";

const tools = [
  {
    name: "get_relevant_context",
    description: "Return active engineering context relevant to a repo, changed paths, and task.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository working directory. Defaults to the server cwd." },
        contextDir: { type: "string", description: "Context directory, relative to cwd or absolute." },
        repo: { type: "string", description: "Repository name, for example api or acme/api." },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Changed or relevant file paths."
        },
        task: { type: "string", description: "Implementation or review task text." },
        limit: { type: "number", description: "Maximum context entries to return." }
      }
    }
  },
  {
    name: "search_context",
    description: "Search active engineering context by text query.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository working directory. Defaults to the server cwd." },
        contextDir: { type: "string", description: "Context directory, relative to cwd or absolute." },
        query: { type: "string", description: "Search query." },
        limit: { type: "number", description: "Maximum context entries to return." }
      },
      required: ["query"]
    }
  },
  {
    name: "lint_context",
    description: "Lint the context base for duplicate IDs, missing owners, stale dates, and vague entries.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Repository working directory. Defaults to the server cwd." },
        contextDir: { type: "string", description: "Context directory, relative to cwd or absolute." }
      }
    }
  }
];

function normalizeToolArgs(args = {}) {
  const cwd = args.cwd || process.cwd();
  const cliArgs = {};
  if (args.contextDir) {
    cliArgs["context-dir"] = args.contextDir;
  }
  if (args.repo) {
    cliArgs.repo = args.repo;
  }
  if (args.paths) {
    cliArgs.paths = Array.isArray(args.paths) ? args.paths.join(",") : String(args.paths);
  }
  if (args.task) {
    cliArgs.task = args.task;
  }
  if (args.limit) {
    cliArgs.limit = String(args.limit);
  }
  return { cwd, cliArgs };
}

function textContent(text) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}

function callTool(name, args = {}) {
  if (name === "get_relevant_context") {
    const { cwd, cliArgs } = normalizeToolArgs(args);
    const index = buildIndex(cwd, cliArgs);
    const result = findRelevant(cwd, index, cliArgs);
    return textContent(formatRelevantMarkdown(result));
  }

  if (name === "search_context") {
    const { cwd, cliArgs } = normalizeToolArgs(args);
    const index = buildIndex(cwd, cliArgs);
    const result = searchContext(index, args.query, cliArgs);
    return textContent(formatRelevantMarkdown(result));
  }

  if (name === "lint_context") {
    const { cwd, cliArgs } = normalizeToolArgs(args);
    const index = buildIndex(cwd, cliArgs);
    const result = lintContext(index, cliArgs);
    if (!result.issues.length) {
      return textContent(`No context issues found across ${index.items.length} entries.`);
    }
    return textContent(
      result.issues.map((issue) => `${issue.level.toUpperCase()}: ${issue.id || issue.file}: ${issue.message}`).join("\n")
    );
  }

  throw new Error(`Unknown tool: ${name}`);
}

function response(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function errorResponse(id, error) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error.message
    }
  };
}

function handleMessage(message) {
  if (message.method === "initialize") {
    return response(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "agent-context",
        version: "0.1.0"
      }
    });
  }

  if (message.method === "notifications/initialized") {
    return null;
  }

  if (message.method === "tools/list") {
    return response(message.id, { tools });
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    return response(message.id, callTool(name, args));
  }

  if (message.id === undefined || message.id === null) {
    return null;
  }

  return errorResponse(message.id, new Error(`Unsupported method: ${message.method}`));
}

function writeMessage(message) {
  if (!message) {
    return;
  }
  const payload = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

function startServer() {
  let buffer = Buffer.alloc(0);

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }

      const header = buffer.slice(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        throw new Error("MCP message missing Content-Length header");
      }

      const length = Number(lengthMatch[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + length;
      if (buffer.length < messageEnd) {
        return;
      }

      const raw = buffer.slice(messageStart, messageEnd).toString("utf8");
      buffer = buffer.slice(messageEnd);

      try {
        writeMessage(handleMessage(JSON.parse(raw)));
      } catch (error) {
        let id = null;
        try {
          id = JSON.parse(raw).id;
        } catch {
          id = null;
        }
        writeMessage(errorResponse(id, error));
      }
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer
};
