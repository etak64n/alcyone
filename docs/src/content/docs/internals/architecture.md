---
title: "Architecture"
description: "How the Worker, the two Durable Objects, and the bucket work together."
---

alcyone is one Worker with two Durable Object classes, in front of one bucket.

| Part | Role |
| --- | --- |
| **Worker** | Serves the pages of the browser app and the API under `/api`. It checks the Access token of every API request. |
| **BoardRoom** | One Durable Object for each board, named by the ID of the board. It holds the board while people edit it, takes their WebSockets, and saves the board to the bucket. |
| **BoardDirectory** | One Durable Object for the list of boards. It writes the list to the bucket after each change. |
| **Bucket** | Keeps the list of boards, every board, and every image. [Storage](../storage/) describes its files. |

## Opening a board

1. The browser opens a WebSocket at `/api/boards/<board>/socket`.
2. The Worker checks the Access token, checks that the page that opens the WebSocket is a page of alcyone, and asks the BoardDirectory whether the board exists.
3. The Worker passes the connection to the BoardRoom of the board, with the email of the person and the name of the board.
4. The BoardRoom reads the board from the bucket if it does not hold it yet, accepts the WebSocket, and sends the board and the people on it.

## Editing

1. The browser applies an edit to its own copy of the board at once, and sends it as a batch of operations: a put of a whole item, a patch of some fields of an item, or a delete.
2. The BoardRoom checks every operation of the batch. A batch with a wrong operation changes nothing, and only its sender hears why.
3. The BoardRoom applies the batch, writes it to a journal in its own storage, and sends it to everyone on the board, the sender included.
4. Each browser applies the batch. The sender learns that its batch arrived, and stops waiting for it.

The BoardRoom applies the batches of everyone in one order, so every browser ends with the same board. Each operation names absolute values, so a batch that a browser sends again after a lost connection does no harm.

Where each person points, what they select, and what they drag go over the same WebSocket as a presence. The BoardRoom passes it on to the others and keeps none of it.

## Saving

Two seconds after a change, an alarm of the BoardRoom writes the whole board to `boards/<board>/board.json`, empties the journal up to the batches that the save includes, and tells the BoardDirectory the time of the change.

The journal keeps every batch that the BoardRoom acknowledged until a save includes it. When the BoardRoom restarts before a save, such as for a new version of the Worker, it reads the last save from the bucket and replays the journal over it. A save that fails runs again after 5 seconds, 15 seconds, 1 minute, and then every 5 minutes, and the journal keeps the batches meanwhile.

A BoardRoom sleeps while nobody sends anything, and keeps its WebSockets open while it sleeps. The browser pings every 25 seconds, and the runtime answers the ping without waking the BoardRoom.

## Deleting

1. The BoardRoom closes the board for everyone on it.
2. It deletes the files of the board from the bucket, 40 at a time, one alarm after another.
3. It deletes everything that it stored.
4. The BoardDirectory takes the board off the list.

## Security

- Access asks for a sign-in before any page or request reaches the Worker, and the Worker verifies the token of Access on every API request, so a deployment without Access answers nothing.
- The WebSocket of a board opens only from a page of the same host, so that another site cannot open a board in the name of a person who visits it.
- The pages carry a Content-Security-Policy that allows only the origin of alcyone.
- Images come from the Worker with a Content-Security-Policy that runs nothing, and alcyone takes no SVG images, which can carry scripts.
- The bucket needs no public access and no CORS settings: the browser never talks to it.
