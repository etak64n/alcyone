// A bucket in memory, with the part of the R2 binding that alcyone uses.

export class MemoryBucket implements R2Bucket {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  /** Keys whose reads and writes fail, as with a storage service that is down. */
  readonly failing = new Set<string>();

  async get(key: string): Promise<R2ObjectBody | null> {
    this.#check(key);
    const object = this.objects.get(key);
    if (object === undefined) return null;
    const body = object.body;
    return {
      body: new Blob([body as BlobPart]).stream(),
      size: body.byteLength,
      httpMetadata: { contentType: object.contentType },
      text: async () => new TextDecoder().decode(body),
    };
  }

  async put(key: string, value: string | ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown> {
    this.#check(key);
    const body = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType ?? "application/octet-stream" });
    return {};
  }

  async delete(key: string): Promise<void> {
    this.#check(key);
    this.objects.delete(key);
  }

  async list(options: { prefix: string; limit: number }): Promise<{ objects: { key: string }[] }> {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
    return { objects: keys.slice(0, options.limit).map((key) => ({ key })) };
  }

  /** The object as text, for the checks of a test. */
  text(key: string): string | null {
    const object = this.objects.get(key);
    return object === undefined ? null : new TextDecoder().decode(object.body);
  }

  json<T>(key: string): T {
    const text = this.text(key);
    if (text === null) throw new Error(`The bucket has no ${key}.`);
    return JSON.parse(text) as T;
  }

  #check(key: string): void {
    if (this.failing.has(key)) throw new Error(`The storage service failed for ${key}.`);
  }
}
