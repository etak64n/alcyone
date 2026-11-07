---
title: "Storage"
description: "The files that alcyone keeps in the bucket, and their form."
---

alcyone keeps everything in one bucket. Each file is JSON that a person can read, so the boards stay usable without alcyone.

```text
index.json                         the list of boards
boards/<board>/board.json          the items of a board
boards/<board>/assets/<image>      the images of a board
```

IDs of boards, items, and images are 16 digits and lowercase letters.

## index.json

The BoardDirectory writes the list of boards after each change.

```json
{
  "format": "alcyone.index",
  "version": 1,
  "boards": [
    {
      "id": "k3v9q0x7m2a8d1ze",
      "name": "Planning",
      "createdAt": "2026-11-08T09:00:00.000Z",
      "createdBy": "ada@example.com",
      "updatedAt": "2026-11-08T09:41:12.508Z"
    }
  ]
}
```

## board.json

The BoardRoom of a board writes it two seconds after a change. `seq` counts the batches of operations that the items include.

```json
{
  "format": "alcyone.board",
  "version": 1,
  "id": "k3v9q0x7m2a8d1ze",
  "name": "Planning",
  "seq": 42,
  "savedAt": "2026-11-08T09:41:12.508Z",
  "items": [
    { "id": "a1b2c3d4e5f6g7h8", "type": "sticky", "z": 1, "x": -100, "y": -100, "w": 200, "h": 200, "color": "yellow", "text": "Goals" }
  ]
}
```

Items draw in the order of `z`, the larger one over the smaller one. Positions and sizes are in board units: at a zoom of 100%, one unit is one CSS pixel.

| Type | Fields |
| --- | --- |
| `sticky` | `x`, `y`, `w`, `h`, `color` (yellow, orange, pink, violet, blue, green, gray, white), `text` |
| `text` | `x`, `y`, `w`, `h`, `color` (an ink color), `size` (s, m, l, xl), `text` |
| `shape` | `x`, `y`, `w`, `h`, `shape` (rect, ellipse, diamond), `stroke` (an ink color), `fill` (none or an ink color), `text` |
| `line` | `from` and `to`, each `{ x, y, item }`, `stroke` (an ink color), `arrow` (none, end, both) |
| `pen` | `x`, `y`, `w`, `h`, `stroke` (an ink color), `width` (2, 4, 8), `points` (x0, y0, x1, y1, … from the top left corner of the item) |
| `image` | `x`, `y`, `w`, `h`, `asset` (the ID of the image file) |

The ink colors are black, gray, red, orange, yellow, green, blue, and violet.
An end of a line with an `item` follows that item; its `x` and `y` are where it was last.

## Images

An image keeps the bytes that the browser sent, with their content type: PNG, JPEG, GIF, WebP, or AVIF.
An image stays in the bucket after someone deletes its item from the board, so that undo can bring the item back. The images of a board go away with the board.

## Backups and changes by hand

You can copy the bucket at any time to back up every board.
A change of a file by hand reaches alcyone only when nobody has the board open: a BoardRoom that holds a board writes its own copy over the file at its next save.
