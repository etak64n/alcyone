// Stand-ins for the state of a Durable Object, its SQLite storage with node:sqlite, and
// the WebSockets that it accepts, so that the tests run the BoardRoom and the
// BoardDirectory as they are.

import { DatabaseSync } from "node:sqlite";

/** The server end of a WebSocket in a room. It keeps what the room sends, as parsed JSON. */
export class FakeSocket {
  readonly sent: Record<string, unknown>[] = [];
  closed: { code: number; reason: string } | null = null;
  #attachment: unknown = null;

  send(text: string): void {
    if (this.closed !== null) throw new Error("The WebSocket is closed.");
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }

  close(code = 1000, reason = ""): void {
    this.closed = { code, reason };
  }

  serializeAttachment(value: unknown): void {
    this.#attachment = structuredClone(value);
  }

  deserializeAttachment(): unknown {
    return this.#attachment;
  }

  /** The messages of one type that the room sent to this socket. */
  messages(type: string): Record<string, unknown>[] {
    return this.sent.filter((message) => message["type"] === type);
  }

  last(type: string): Record<string, unknown> | undefined {
    return this.messages(type).at(-1);
  }
}

export class FakeState {
  readonly sockets: FakeSocket[] = [];
  alarm: number | null = null;
  readonly #db: DatabaseSync;
  readonly storage: DurableObjectStorage;

  /** A state over an existing database stands for the same object after a restart. */
  constructor(db = new DatabaseSync(":memory:")) {
    this.#db = db;
    const exec = (query: string, ...bindings: SqlStorageValue[]) => {
      const statement = db.prepare(query);
      const values = bindings as (string | number | null)[];
      const rows = /^\s*SELECT/i.test(query) ? (statement.all(...values) as Record<string, SqlStorageValue>[]) : (statement.run(...values), []);
      return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
    };
    this.storage = {
      sql: { exec } as unknown as SqlStorage,
      getAlarm: async () => this.alarm,
      setAlarm: async (time) => {
        this.alarm = Number(time);
      },
      deleteAlarm: async () => {
        this.alarm = null;
      },
      deleteAll: async () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
        for (const { name } of tables) db.exec(`DROP TABLE "${name}"`);
        this.alarm = null;
      },
    };
  }

  get database(): DatabaseSync {
    return this.#db;
  }

  /** The names of the tables that the object keeps. */
  tables(): string[] {
    return (this.#db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  }

  // The runtime runs no other event of the object until the callback finishes. Callbacks
  // here run one after another, which is the part of that rule that the tests rely on.
  #blocking: Promise<unknown> = Promise.resolve();
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const run = this.#blocking.then(callback);
    this.#blocking = run.catch(() => undefined);
    return run;
  }

  acceptWebSocket(ws: WebSocket): void {
    this.sockets.push(ws as unknown as FakeSocket);
  }

  getWebSockets(): WebSocket[] {
    return this.sockets.filter((socket) => socket.closed === null) as unknown as WebSocket[];
  }

  setWebSocketAutoResponse(): void {}

  waitUntil(): void {}
}

/** The globals of the Workers runtime that a room uses: WebSocket pairs, and responses with status 101. */
export function installWorkersGlobals(): () => void {
  const globals = globalThis as Record<string, unknown>;
  const saved = { WebSocketPair: globals["WebSocketPair"], WebSocketRequestResponsePair: globals["WebSocketRequestResponsePair"], Response: globals["Response"] };
  const NodeResponse = globalThis.Response;
  globals["WebSocketPair"] = class {
    0 = new FakeSocket();
    1 = new FakeSocket();
  };
  globals["WebSocketRequestResponsePair"] = class {
    readonly request: string;
    readonly response: string;
    constructor(request: string, response: string) {
      this.request = request;
      this.response = response;
    }
  };
  // Node.js refuses a response with status 101, which a Worker returns for an accepted WebSocket.
  globals["Response"] = class extends NodeResponse {
    readonly webSocket: unknown;
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
      const upgrade = init?.status === 101;
      super(body, upgrade ? { ...init, status: 200 } : init);
      this.webSocket = init?.webSocket ?? null;
      if (upgrade) Object.defineProperty(this, "status", { value: 101 });
    }
  };
  return () => {
    for (const [name, value] of Object.entries(saved)) globals[name] = value;
  };
}
