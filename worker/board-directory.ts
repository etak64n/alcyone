// The one BoardDirectory: it keeps the list of boards, and writes it to index.json in the
// bucket after each change. Every change of the list goes through it, one at a time, so
// two people who create boards at the same moment both find them in the list.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";
import { Directory } from "./directory.ts";
import { indexJson, INDEX_KEY, readIndex } from "./layout.ts";
import { errorFields, log } from "./log.ts";
import type { BoardEntry, DirectoryRpc } from "./rpc.ts";
import { readStorageConfig } from "./runtime-config.ts";
import { objectStoreFor, type ObjectStore } from "./storage.ts";

// A change of a board moves it up the list. Changes that come close together share one
// write of index.json, this long after the first of them.
const TOUCH_SAVE_DELAY_MS = 5_000;

export class BoardDirectory extends DurableObject<Env> implements DirectoryRpc {
  #directory: Directory | null = null;
  // Writes of index.json run one after another, so an older list never replaces a newer one.
  #writes: Promise<void> = Promise.resolve();
  // A write that waits for its turn. A change before it starts rides along with it.
  #queuedWrite: Promise<void> | null = null;
  #touchTimer: ReturnType<typeof setTimeout> | null = null;

  async list(): Promise<BoardEntry[]> {
    return (await this.#load()).list();
  }

  async get(id: string): Promise<BoardEntry | null> {
    return (await this.#load()).get(id);
  }

  async create(entry: BoardEntry): Promise<void> {
    const directory = await this.#load();
    if (!directory.create(entry)) throw new Error(`A board with the ID ${entry.id} already exists.`);
    await this.#save();
  }

  async rename(id: string, name: string): Promise<BoardEntry | null> {
    const entry = (await this.#load()).rename(id, name);
    if (entry !== null) await this.#save();
    return entry;
  }

  async remove(id: string): Promise<boolean> {
    const removed = (await this.#load()).remove(id);
    if (removed) await this.#save();
    return removed;
  }

  async touch(id: string, updatedAt: string): Promise<void> {
    if (!(await this.#load()).touch(id, updatedAt)) return;
    if (this.#touchTimer !== null) return;
    this.#touchTimer = setTimeout(() => {
      this.#touchTimer = null;
      this.#save().catch((error: unknown) => log("ERROR", "The list of boards could not be saved", null, errorFields(error)));
    }, TOUCH_SAVE_DELAY_MS);
  }

  // Reads index.json once, while no other request runs. A bucket without it has no boards yet.
  async #load(): Promise<Directory> {
    if (this.#directory !== null) return this.#directory;
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.#directory !== null) return this.#directory;
      const text = await this.#store().getText(INDEX_KEY);
      this.#directory = new Directory(text === null ? [] : readIndex(text));
      return this.#directory;
    });
  }

  #save(): Promise<void> {
    if (this.#queuedWrite !== null) return this.#queuedWrite;
    const write = this.#writes.then(async () => {
      this.#queuedWrite = null;
      const directory = this.#directory;
      if (directory === null) return;
      await this.#store().put(INDEX_KEY, indexJson(directory.list()), "application/json");
    });
    this.#queuedWrite = write;
    this.#writes = write.catch(() => undefined);
    return write;
  }

  #store(): ObjectStore {
    return objectStoreFor(readStorageConfig(this.env));
  }
}
