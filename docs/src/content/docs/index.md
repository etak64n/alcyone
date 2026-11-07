---
title: "alcyone"
description: "A whiteboard for your team on Cloudflare Workers, with every board in your S3-compatible bucket."
---

alcyone is a whiteboard that the people you allow open in their browsers and edit together.
A board holds sticky notes, text, shapes, lines that join them, pen strokes, and images, and everyone on it sees the edits and the pointers of the others as they happen.

alcyone runs in your Cloudflare account and keeps everything in your bucket.

1. Cloudflare Access lets in only the people whose emails you list.
2. A Worker serves the pages and the API.
3. A Durable Object for each board holds the board while people edit it, and saves it to the bucket.
4. The bucket, at any S3-compatible provider, keeps the list of boards, every board as a JSON file, and every image.

alcyone needs no database and no server of yours.

## Where to start

- [Try it locally](getting-started/try-locally/) runs alcyone on your machine, without a Cloudflare account or a bucket.
- [Deploy](getting-started/deploy/) creates alcyone in your Cloudflare account with `pnpm stack:deploy`.
- [Edit a board](guides/editing/) lists the tools and the keys.
- [Architecture](internals/architecture/) explains how the parts work together.
