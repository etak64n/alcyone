// The parts of the Workers runtime that alcyone uses and that the WebWorker library of
// TypeScript does not describe: Durable Objects with their SQLite storage and alarms, the
// WebSockets that a Durable Object accepts, and the R2 binding of `cf dev`. Declaring this
// subset here keeps the Worker free of a separate package of runtime types.

declare module "cloudflare:workers" {
  /** The base class of a Durable Object. Its public methods are RPC methods of its stubs. */
  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  /** Runs the callback while no other event of the object runs. */
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  /** Accepts a WebSocket that the object may sleep through: its events arrive as webSocketMessage and webSocketClose. */
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  /** Answers one message with another without waking the object. */
  setWebSocketAutoResponse(pair?: WebSocketRequestResponsePair): void;
  waitUntil(promise: Promise<unknown>): void;
}

declare class WebSocketRequestResponsePair {
  constructor(request: string, response: string);
}

interface DurableObjectStorage {
  readonly sql: SqlStorage;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  /** Deletes everything that the object stored. */
  deleteAll(): Promise<void>;
}

type SqlStorageValue = ArrayBuffer | string | number | null;

interface SqlStorage {
  exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): SqlStorageCursor<T>;
}

interface SqlStorageCursor<T> extends Iterable<T> {
  toArray(): T[];
}

interface WebSocket {
  /** Keeps a value with the connection, which survives while the object sleeps. At most 16 KiB. */
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface ResponseInit {
  /** The end of a WebSocket that goes back to the client, with status 101. */
  webSocket?: WebSocket | null;
}

/** The namespace of a Durable Object class: one object for each name. */
interface DurableObjectNamespace<T> {
  getByName(name: string): DurableObjectStub<T>;
}

type DurableObjectStub<T> = T & { fetch(request: Request): Promise<Response> };

/** The part of an R2 binding that the "local-r2" storage of `cf dev` uses. */
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: string | ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit: number }): Promise<{ objects: { key: string }[] }>;
}

interface R2ObjectBody {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly httpMetadata?: { contentType?: string };
  text(): Promise<string>;
}
