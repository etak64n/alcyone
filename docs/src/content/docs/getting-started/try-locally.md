---
title: "Try it locally"
description: "Run alcyone on your machine without a Cloudflare account or a bucket."
---

You can run alcyone on your machine with Node.js and pnpm alone. You need no Cloudflare account and no bucket.

alcyone needs Node.js ^22.23.0, ^24.22.0, or ^26.12.0 (package.json, `engines`), and the pnpm version in package.json (`packageManager`).
The project installs the Cloudflare CLI, `cf`, as a development dependency, so you run it with `pnpm exec cf`.

```bash
# Install the dependency versions that pnpm-lock.yaml records
pnpm install

# Create your settings from the example. The example values work locally as they are.
cp alcyone.config.example.ts alcyone.config.ts

# Start the dev server. Open the address that it prints, http://localhost:5173 by default.
pnpm exec cf dev
```

The example values work locally because `cf dev` needs none of the production values.
The example sets the development storage to `"local-r2"`, a bucket that `cf dev` keeps on your machine.

## What differs from a deployment

- Access does not run. `cf dev` signs you in as `development.signInAs`, admin@example.com in the example, and answers requests to localhost only.
- The bucket and the storage of the Durable Objects are on your machine, in `.cloudflare/state`, which Git ignores.

To see two people on one board, open the board in two tabs. Both tabs sign in as the same email, and each tab is one person on the board.

## Start over

```bash
# Stop cf dev first. Then delete the local bucket and the local Durable Objects.
# -rf : delete the folder and everything in it, without asking
rm -rf .cloudflare/state
```

## Develop against a real bucket

Write an `"s3"` storage in `development.storage`, as in `production.storage`, for a bucket that holds no production boards.
Its endpoint may also be an `http://` origin on localhost, such as a storage server on your machine.
Copy `.env.example` to `.env` and fill in the keys of that bucket.
The bucket needs no CORS settings: the browser never talks to it.
