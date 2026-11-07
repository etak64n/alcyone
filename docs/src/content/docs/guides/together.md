---
title: "Work together"
description: "What the others see of you, how edits of several people combine, and what happens when the connection breaks."
---

Everyone on a board edits it at the same time.

## What you see of the others

- The people on the board show at the top right. Each person has a color of their own.
- The pointer of each person moves on your screen with their name.
- What someone selects shows with an outline in their color.
- A move, a resize, a line, and a pen stroke show while the person drags, before they let go.

## How edits combine

Your edits show at once, before they reach the others. The room of the board, which holds it in Cloudflare, applies the edits of everyone in the order in which they arrive, and sends each one to everyone.

When two people change the same item at the same moment, the change that arrives last wins, field by field: one person can move a note while another changes its color, and both changes stay.

## When the connection breaks

The board says **Reconnecting** at the top left while the connection is down, and connects again by itself.
Your edits wait in the browser and leave once the connection is back. The browser asks before you leave a page whose last edits have not reached the room.

## Saving

There is no Save button. The room keeps every edit as soon as it arrives, and writes the board to the bucket about two seconds after a change.

## A deleted board

When someone deletes a board, it closes for everyone on it.
