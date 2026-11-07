---
title: "Limits"
description: "The limits of a board, and the limits of Cloudflare that a deployment meets."
---

## Boards

| Limit | Value |
| --- | --- |
| Items on one board | 10,000 |
| Text of one item | 10,000 characters |
| Points of one pen stroke | 5,000 |
| Name of a board | 100 characters |
| Operations in one batch | 2,000, and 1.9 MB |
| Size of an image | 20 MB |
| Kinds of images | PNG, JPEG, GIF, WebP, AVIF |
| Distance from the middle of a board | 10,000,000 board units |

The browser splits a large paste into several batches, so a paste of many items stays within the limits of a batch.

## Cloudflare

A BoardRoom is a Durable Object with SQLite storage, which the Workers Free plan includes within daily limits. On the Free plan, an operation past one of the limits fails until the limits reset at 00:00 UTC.

What a board uses:

- Each message of a browser is a request to the BoardRoom: each batch of edits, and each update of the pointer, which a browser sends at most 20 times a second while the pointer moves.
- The BoardRoom is active, and counts duration, while messages arrive. It sleeps while nobody sends anything.
- Each batch writes a row to the journal. A save deletes the rows that it includes, and the next change sets an alarm for the next save.

See the [pricing of Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) for the limits of each plan.
