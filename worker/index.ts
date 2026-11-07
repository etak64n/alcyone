// Entry point of the alcyone Worker. It answers /api/* and, in a deployment, returns the
// pages of the browser app from the static assets with their security headers. The
// built files under /assets/ never run the Worker. It also exports the two Durable
// Object classes: a BoardRoom for each board, and the one BoardDirectory.

import { randomId } from "../shared/ids.ts";
import { remoteKeySet } from "./access.ts";
import { createApp } from "./app.ts";
import type { Env } from "./env.ts";
import { DIRECTORY_NAME } from "./rpc.ts";
import { objectStoreFor } from "./storage.ts";

export { BoardDirectory } from "./board-directory.ts";
export { BoardRoom } from "./board-room.ts";

const app = createApp({
  keySetFor: remoteKeySet,
  objectStoreFor: (config) => objectStoreFor(config.storage),
  directoryFor: (env) => env.DIRECTORY.getByName(DIRECTORY_NAME),
  // The room of a board has the name of the board's ID.
  roomFor: (env, boardId) => env.ROOMS.getByName(boardId),
  now: () => new Date(),
  newId: randomId,
});

export default {
  fetch: (request: Request, env: Env, context: Parameters<typeof app.fetch>[2]) => app.fetch(request, env, context),
};
