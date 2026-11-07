import { afterEach, describe, expect, it, vi } from "vitest";
import type { S3Config } from "../worker/runtime-config.ts";
import { objectUrl, readXmlElements, S3ObjectStore, StorageError } from "../worker/storage.ts";

const config: S3Config = {
  type: "s3",
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "alcyone-boards",
  urlStyle: "path",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
};

function answer(handler: (request: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    return handler(request);
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("S3ObjectStore", () => {
  it("reads an object as text, and answers null for a key without one", async () => {
    const calls = answer((request) => (request.url.endsWith("/missing.json") ? new Response("<Error/>", { status: 404 }) : new Response("{}")));
    const store = new S3ObjectStore(config);
    await expect(store.getText("boards/abc/board.json")).resolves.toBe("{}");
    await expect(store.getText("missing.json")).resolves.toBeNull();
    expect(calls[0]?.url).toBe("https://s3.example.com/alcyone-boards/boards/abc/board.json");
    expect(calls[0]?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  });

  it("writes an object with its content type, and names the error of the service", async () => {
    const calls = answer((request) =>
      request.url.includes("denied")
        ? new Response("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", { status: 403 })
        : new Response(null, { status: 200 }),
    );
    const store = new S3ObjectStore(config);
    await store.put("index.json", '{"a":1}', "application/json");
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    await expect(calls[0]?.text()).resolves.toBe('{"a":1}');
    await expect(store.put("denied.json", "x", "application/json")).rejects.toThrow("PutObject failed with HTTP 403 (AccessDenied: Access Denied).");
  });

  it("lists the keys under a prefix", async () => {
    const calls = answer(
      () => new Response("<ListBucketResult><Contents><Key>boards/a/board.json</Key></Contents><Contents><Key>boards/a/assets/x&amp;y</Key></Contents></ListBucketResult>"),
    );
    const store = new S3ObjectStore(config);
    await expect(store.list("boards/a/", 40)).resolves.toEqual(["boards/a/board.json", "boards/a/assets/x&y"]);
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/alcyone-boards/");
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("prefix")).toBe("boards/a/");
    expect(url.searchParams.get("max-keys")).toBe("40");
  });

  it("deletes a key that holds no object without an error", async () => {
    answer(() => new Response(null, { status: 404 }));
    await expect(new S3ObjectStore(config).delete("gone")).resolves.toBeUndefined();
  });

  it("sends a request again after a lost connection", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return new Response("ok");
    });
    await expect(new S3ObjectStore(config).getText("index.json")).resolves.toBe("ok");
    expect(attempts).toBe(2);
  });

  it("reports a service that cannot be reached as a storage failure", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(new S3ObjectStore(config).getText("index.json")).rejects.toThrow(StorageError);
  });
});

describe("objectUrl", () => {
  it("puts the bucket in the path or in the host name, after the path of the endpoint", () => {
    expect(objectUrl({ ...config, endpoint: "https://s3.example.com/storage" }, "boards/a b/board.json").href).toBe(
      "https://s3.example.com/storage/alcyone-boards/boards/a%20b/board.json",
    );
    expect(objectUrl({ ...config, urlStyle: "virtual-hosted" }, "index.json").href).toBe("https://alcyone-boards.s3.example.com/index.json");
  });
});

describe("readXmlElements", () => {
  it("reads every element of a name", () => {
    expect(readXmlElements("<a><Key>1</Key><Key>2 &lt; 3</Key></a>", "Key")).toEqual(["1", "2 < 3"]);
  });
});
