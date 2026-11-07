---
title: "Development"
description: "Checks, tests, and the layout of the project."
---

[Try it locally](../../getting-started/try-locally/) explains `cf dev`. This page covers the checks and the layout of the code.

## Checks

```bash
# Type-check three TypeScript projects: the browser app, the Worker, and the configuration with the tests
pnpm typecheck

# Run the Vitest tests
pnpm test
```

The tests run in Node.js. They run the Worker with a bucket in memory, and the two Durable Objects with stand-ins for their state: node:sqlite for their storage, and WebSockets that keep what the room sends (test/support/).

`test/browser/run.sh` starts `cf dev` and drives two tabs of Chromium on one board with Playwright (test/browser/collaborate.mjs). It writes screenshots to test/browser/out/.

## CI

CI runs on pushes to main, on pull requests, and on each release (.github/workflows/ci.yml).

1. It copies the example settings, then runs the type checks, the tests, and `cf build` on Node.js 24.
2. It runs the browser test, and keeps its screenshots with the run.

## Scripts

- `pnpm stack:deploy`: creates or updates the Access application and the Worker of the stack
- `pnpm stack:delete`: deletes the Worker and the Access application of the stack
- `pnpm typecheck`: type-checks the browser app, the Worker, and the configuration with the tests
- `pnpm test`: runs the Vitest tests once

## Project layout

- worker/: the Worker, the BoardRoom and the BoardDirectory, the Access check, and the storage client
- src/: the browser app, with the board in src/board/
- shared/: the items and the operations of a board, the messages of its WebSocket, and the API types, which the Worker and the browser app share
- config/: the settings types and their validation
- stack/: `pnpm stack:deploy` and `pnpm stack:delete`
- test/: the Vitest tests, and the browser test in test/browser/
- docs/: this site
- cloudflare.config.ts: the Worker configuration that `cf` reads, built from alcyone.config.ts
- alcyone.config.example.ts: the example settings
