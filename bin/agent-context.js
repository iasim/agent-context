#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const {
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
} = require("../lib/context");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  const cwd = process.cwd();

  if (command === "help" || args.help || args.h) {
    printHelp();
    return;
  }

  if (command === "version" || args.version || args.v) {
    const pkg = require("../package.json");
    console.log(pkg.version);
    return;
  }

  if (command === "init") {
    const result = createSampleContext(cwd, { force: Boolean(args.force) });
    for (const file of result.created) {
      console.log(`created ${path.relative(cwd, file)}`);
    }
    if (result.skipped.length) {
      for (const file of result.skipped) {
        console.log(`skipped ${path.relative(cwd, file)} (already exists)`);
      }
    }
    console.log("\nNext: agent-context index");
    return;
  }

  if (command === "index") {
    const index = buildIndex(cwd, args);
    const outFile = writeIndex(cwd, index, args);
    console.log(`Indexed ${index.items.length} context entries.`);
    console.log(`Wrote ${path.relative(cwd, outFile)}.`);
    return;
  }

  if (command === "relevant") {
    const index = loadIndexOrBuild(cwd, args);
    const result = findRelevant(cwd, index, args);
    if (args.json || args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatRelevantMarkdown(result, args));
    }
    return;
  }

  if (command === "search") {
    const query = args._.slice(1).join(" ") || args.query || args.q;
    if (!query) {
      throw new Error("search requires a query");
    }
    const index = loadIndexOrBuild(cwd, args);
    const result = searchContext(index, query, args);
    if (args.json || args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatRelevantMarkdown(result, args));
    }
    return;
  }

  if (command === "lint") {
    const index = buildIndex(cwd, args);
    const result = lintContext(index, args);
    if (args.json || args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else if (!result.issues.length) {
      console.log(`No context issues found across ${index.items.length} entries.`);
    } else {
      for (const issue of result.issues) {
        console.log(`${issue.level.toUpperCase()}: ${issue.id || issue.file}: ${issue.message}`);
      }
    }
    if (result.issues.some((issue) => issue.level === "error")) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "export") {
    const result = exportAdapters(cwd, args);
    for (const file of result.files) {
      console.log(`wrote ${path.relative(cwd, file)}`);
    }
    return;
  }

  if (command === "mcp") {
    require("./agent-context-mcp").startServer();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`agent-context: ${error.message}`);
  process.exitCode = 1;
});
