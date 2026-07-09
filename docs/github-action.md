# GitHub Action

The action runs the same relevance engine as the CLI and posts the result to the pull request.

```yaml
name: Agent Context

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
```

## Separate Context Repo

```yaml
      - uses: actions/checkout@v4
        with:
          repository: acme/engineering-context
          path: engineering-context
      - uses: your-org/agent-context@v1
        with:
          context-dir: engineering-context/context
```

## Inputs

- `context-dir`: directory of Markdown context files.
- `diff`: optional explicit diff range.
- `task`: extra text for relevance scoring.
- `limit`: maximum entries to include.
- `comment`: whether to create or update a PR comment.
