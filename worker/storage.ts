// Talks to the bucket that holds the boards and their images: an S3-compatible service,
// with Signature Version 4, or under `cf dev`, a local R2 bucket through its binding.
// Every byte of a board passes through the Worker and the Durable Objects, so the bucket
// needs no CORS settings and stays private.

import { AwsClient } from "aws4fetch";
import { retry } from "../shared/retry.ts";
import type { S3Config, StorageConfig } from "./runtime-config.ts";

/** An object read from the bucket, as a stream. */
export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}

export interface ObjectStore {
  /** Reads an object as text, or returns null when it does not exist. */
  getText(key: string): Promise<string | null>;
  /** Reads an object as a stream, or returns null when it does not exist. */
  getObject(key: string): Promise<StoredObject | null>;
  /** Writes an object, and replaces the one that the key held. */
  put(key: string, body: string | ArrayBuffer, contentType: string): Promise<void>;
  /** Deletes an object. Deleting a key that holds no object succeeds. */
  delete(key: string): Promise<void>;
  /** Returns the keys of at most `limit` objects whose keys start with the prefix. */
  list(prefix: string, limit: number): Promise<string[]>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export function objectStoreFor(storage: StorageConfig): ObjectStore {
  return storage.type === "s3" ? new S3ObjectStore(storage) : new R2BucketStore(storage.bucket);
}

// aws4fetch sends a request again after an answer of 429 or 5xx, with a growing wait, and
// #send sends it again after a lost connection. Every request of alcyone reads, writes,
// or deletes a whole object, so sending it twice does no harm. Three more tries ride out a
// short outage of the storage service without keeping a person waiting long.
const STORAGE_RETRIES = 3;

export class S3ObjectStore implements ObjectStore {
  readonly #client: AwsClient;
  readonly #storage: S3Config;

  constructor(storage: S3Config) {
    this.#storage = storage;
    this.#client = new AwsClient({
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      service: "s3",
      region: storage.region,
      retries: STORAGE_RETRIES,
    });
  }

  async getText(key: string): Promise<string | null> {
    const response = await this.#send("GetObject", objectUrl(this.#storage, key), { method: "GET" });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    const body = await response.text();
    if (!response.ok) throw failure("GetObject", response.status, body);
    return body;
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const response = await this.#send("GetObject", objectUrl(this.#storage, key), { method: "GET" });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok || response.body === null) throw failure("GetObject", response.status, await response.text());
    const size = Number(response.headers.get("content-length"));
    return {
      body: response.body,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      size: Number.isSafeInteger(size) ? size : -1,
    };
  }

  async put(key: string, body: string | ArrayBuffer, contentType: string): Promise<void> {
    const response = await this.#send("PutObject", objectUrl(this.#storage, key), {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw failure("PutObject", response.status, text);
  }

  async delete(key: string): Promise<void> {
    const response = await this.#send("DeleteObject", objectUrl(this.#storage, key), { method: "DELETE" });
    const text = await response.text();
    // S3 answers 204 for a key that holds no object too. Some compatible services answer 404.
    if (!response.ok && response.status !== 404) throw failure("DeleteObject", response.status, text);
  }

  async list(prefix: string, limit: number): Promise<string[]> {
    const url = objectUrl(this.#storage, "");
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", String(limit));
    const response = await this.#send("ListObjectsV2", url, { method: "GET" });
    const body = await response.text();
    if (!response.ok) throw failure("ListObjectsV2", response.status, body);
    return readXmlElements(body, "Key");
  }

  // A request that cannot reach the storage service is a storage failure, not a bug in the
  // Worker. Requests skip the cache of Cloudflare, which would otherwise answer a GET of an
  // image from its copy and turn a HEAD into a GET that the signature does not match.
  async #send(operation: string, url: URL, init: RequestInit): Promise<Response> {
    try {
      return await retry(() => this.#client.fetch(url.toString(), { ...init, cache: "no-store" }), {
        attempts: STORAGE_RETRIES + 1,
        firstDelayMs: 200,
        // fetch throws a TypeError when the connection fails.
        retryable: (error) => error instanceof TypeError,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StorageError(`${operation} could not reach the storage service at ${url.origin}: ${reason}`);
    }
  }
}

/** The local bucket of `cf dev`, which answers as an S3-compatible service would. */
export class R2BucketStore implements ObjectStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async getText(key: string): Promise<string | null> {
    const object = await this.#bucket.get(key);
    return object === null ? null : await object.text();
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const object = await this.#bucket.get(key);
    if (object === null) return null;
    return { body: object.body, contentType: object.httpMetadata?.contentType ?? "application/octet-stream", size: object.size };
  }

  async put(key: string, body: string | ArrayBuffer, contentType: string): Promise<void> {
    await this.#bucket.put(key, body, { httpMetadata: { contentType } });
  }

  async delete(key: string): Promise<void> {
    await this.#bucket.delete(key);
  }

  async list(prefix: string, limit: number): Promise<string[]> {
    const listed = await this.#bucket.list({ prefix, limit });
    return listed.objects.map((object) => object.key);
  }
}

/** URL of an object, with the bucket in the path or in the hostname. Both follow the path of the endpoint. */
export function objectUrl(storage: Pick<S3Config, "endpoint" | "bucket" | "urlStyle">, key: string): URL {
  const endpoint = new URL(storage.endpoint);
  const base = endpoint.pathname.replace(/\/+$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (storage.urlStyle === "path") return new URL(`${endpoint.origin}${base}/${storage.bucket}/${path}`);
  return new URL(`${endpoint.protocol}//${storage.bucket}.${endpoint.host}${base}/${path}`);
}

/** The text of every element with the given name, in order. */
export function readXmlElements(xml: string, name: string): string[] {
  const pattern = new RegExp(`<${name}>([^<]*)</${name}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => unescapeXml(match[1] ?? ""));
}

function failure(operation: string, status: number, body: string): StorageError {
  const code = readXmlElements(body, "Code")[0] ?? null;
  const message = readXmlElements(body, "Message")[0] ?? null;
  const detail = [code, message].filter((part) => part !== null).join(": ");
  return new StorageError(`${operation} failed with HTTP ${status}${detail === "" ? "" : ` (${detail})`}.`);
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
