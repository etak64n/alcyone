---
title: "Deploy"
description: "Create alcyone in your Cloudflare account with pnpm stack:deploy."
---

`pnpm stack:deploy` creates alcyone in your Cloudflare account, and runs again to update it.

## Prerequisites

| Requirement | Details |
| --- | --- |
| **Cloudflare account** | Holds the zone of your domain. |
| **Zero Trust organization** | In that Cloudflare account; runs the sign-in of Cloudflare Access. The Free plan is enough. |
| **S3-compatible bucket** | Supports Signature Version 4. It needs no CORS settings and no public access. |
| **Access key** | Has permission to read, write, list, and delete objects in that bucket. |
| **Node.js** | 22.23+, 24.22+, or 26.12+. |
| **pnpm** | 12.16+. |

Give the access key permissions on this one bucket only. alcyone keeps nothing else in it.

## 1. Install

```bash
# Clone the repository, switch to the latest release, and install the dependencies
git clone https://github.com/etak64n/alcyone.git
cd alcyone
git checkout latest
pnpm install
```

## 2. Configure

```bash
# Create your settings from the example. Git ignores alcyone.config.ts.
cp alcyone.config.example.ts alcyone.config.ts
```

Replace every value in alcyone.config.ts. [Configuration](../../settings/configuration/) explains each setting.

## 3. Add the keys of the bucket

```bash
# Git ignores .env.production. pnpm stack:deploy uploads the keys to the Worker as secrets.
cp .env.example .env.production
```

Fill in `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` in .env.production.

## 4. Deploy

```bash
# Sign in to Cloudflare in the browser
pnpm exec cf auth login

# Create or update the stack
pnpm stack:deploy
```

`pnpm stack:deploy` does these steps in order.

1. It checks that the access key may read, write, list, and delete objects in the bucket, with keys under `alcyone-check/` that it deletes again. A key without one of these permissions stops the deploy before it changes anything.
2. It creates the Access application of the domain, or updates it. Its only policy allows the emails of `production.access.allow`, and its sign-in page offers the login methods of `production.access.loginMethods`.
3. It deploys the Worker with its two Durable Object classes, and gives it the keys of the bucket, the team domain of the Zero Trust organization, and the AUD tag of the Access application as secrets.
4. It tags the Access application and the Worker with `alcyone.stack=<workerName>`, which `pnpm stack:delete` finds them by.

Open your domain, sign in, and create a board.

## Update

```bash
# Switch to the latest release, install its dependencies, and deploy it
git fetch --tags --force
git checkout latest
pnpm install
pnpm stack:deploy
```

People on a board when the new Worker starts lose their connection for a moment. Their browsers connect again and send the edits that were on their way.

## Delete

```bash
# List the resources of the stack, and delete them after you type the name of the stack
pnpm stack:delete
```

The boards and their images stay in your bucket. Delete them there if you no longer need them.
