---
title: "Configuration"
description: "Every setting of alcyone.config.ts, and the secrets."
---

alcyone.config.ts holds every setting of one deployment.
Every field is required, and alcyone stops with the list of problems when one is missing, wrong, or unknown, so a deployment behaves exactly as its settings say.
Storage keys do not go in this file: they go in `.env` for `cf dev`, and in `.env.production` for `pnpm stack:deploy`.

## Example

This is alcyone.config.example.ts. Copy it to alcyone.config.ts and replace every value.

```ts
// Settings of this alcyone deployment.
//
// Copy this file to alcyone.config.ts and replace every value. Git ignores
// alcyone.config.ts. Storage access keys are secrets, so they do not go here:
// see .env.example.

import { defineAlcyoneConfig } from "./config/settings.ts";

export default defineAlcyoneConfig({
  // Cloudflare account that owns the Worker and the domain
  accountId: "0123456789abcdef0123456789abcdef",
  workerName: "alcyone",
  // People who can rename and delete every board, by the email that Cloudflare Access
  // reports. Everyone else renames and deletes only the boards that they created.
  admins: ["admin@example.com"],
  production: {
    domain: "boards.example.com",
    // The bucket that holds the boards and their images
    storage: {
      type: "s3",
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "alcyone-boards",
      urlStyle: "path",
    },
    // Cloudflare Access, which lets only these people open alcyone. pnpm stack:deploy
    // reads the team domain from the Zero Trust organization of the account.
    access: {
      // The emails that may sign in. They include every admin.
      allow: ["admin@example.com"],
      // The login methods that the sign-in page offers: "all" for every login method of your
      // Zero Trust organization, or a list of their types, such as ["passkeys", "onetimepin"]
      loginMethods: "all",
    },
  },
  // `cf dev` serves alcyone on localhost without Cloudflare Access.
  // "local-r2" keeps boards in a simulated R2 bucket on this machine and needs
  // no keys. To develop against real storage, write an "s3" storage here as in
  // production, with a bucket that holds no production boards.
  development: {
    // Cloudflare Access does not run on this machine, so cf dev signs you in as this email.
    signInAs: "admin@example.com",
    storage: {
      type: "local-r2",
    },
  },
});
```

## Settings

| Setting | Value |
| --- | --- |
| `accountId` | The 32-character ID of the Cloudflare account that owns the Worker and the domain. |
| `workerName` | The name of the Worker, and of the stack: lowercase letters, digits, and hyphens. |
| `admins` | The emails of the people who rename and delete every board. They must be in `production.access.allow`. An empty list makes nobody an admin. |
| `production.domain` | The hostname that serves alcyone, such as boards.example.com. Its zone must be in the account. |
| `production.storage` | The bucket of the boards: see [Storage](#storage). It must be `"s3"`. |
| `production.access.allow` | The emails of the people who may sign in, in lowercase. |
| `production.access.loginMethods` | `"all"` for every login method of the Zero Trust organization, or a list of login methods by type, such as `"onetimepin"`, `"github"`, or `"passkeys"`, or by ID. |
| `development.signInAs` | The email that `cf dev` signs you in as, since Access does not run on your machine. |
| `development.storage` | The bucket that `cf dev` uses: `{ type: "local-r2" }` for a bucket on your machine, or an `"s3"` storage. |

### Storage

An `"s3"` storage names a bucket at any S3-compatible provider.

| Field | Value |
| --- | --- |
| `type` | `"s3"` |
| `endpoint` | The origin of the S3-compatible API, such as `https://s3.us-east-1.amazonaws.com`. Development storage may also use `http://` on localhost. |
| `region` | The region that the provider expects in request signatures, such as `us-east-1`, or `auto` for Cloudflare R2. |
| `bucket` | The name of the bucket. |
| `urlStyle` | `"path"` to put the bucket in the path of each URL, or `"virtual-hosted"` to put it in the hostname. Most providers other than Amazon S3 need `"path"`. |

## Secrets

The access key of the bucket goes in an env file that Git ignores. `.env.example` lists the keys.

| Key | Value |
| --- | --- |
| `S3_ACCESS_KEY_ID` | The ID of the access key. |
| `S3_SECRET_ACCESS_KEY` | The secret of the access key. |

`pnpm stack:deploy` reads `.env.production` and uploads both keys to the Worker as secrets, with the team domain and the AUD tag of Access.
`cf dev` reads `.env` when the development storage is `"s3"`. The `"local-r2"` storage needs no keys.
