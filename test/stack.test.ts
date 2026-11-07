import { describe, expect, it } from "vitest";
import example from "../alcyone.config.example.ts";
import { validateSettings } from "../config/settings.ts";
import { CfError, type Cf } from "../stack/cf.ts";
import { parseEnvFile } from "../stack/env-file.ts";
import { deleteStack, deployStack, offeredLoginMethods, STACK_TAG, stackResources, type LoginMethod } from "../stack/stack.ts";
import { missingPermissionsMessage, missingStoragePermissions } from "../stack/storage-check.ts";
import { R2BucketStore, type ObjectStore } from "../worker/storage.ts";
import { MemoryBucket } from "./support/bucket.ts";

const settings = validateSettings(example);
const SECRETS = { s3AccessKeyId: "key-id", s3SecretAccessKey: "secret" };
const ORGANIZATION = { name: "example", auth_domain: "example.cloudflareaccess.com" };
const LOGIN_METHODS: LoginMethod[] = [
  { id: "idp-otp", type: "onetimepin", name: "" },
  { id: "idp-github", type: "github", name: "GitHub" },
];

/** Answers cf commands from a function, and records every command. */
class FakeCf implements Cf {
  readonly calls: string[][] = [];
  readonly answer: (args: string[]) => unknown;

  constructor(answer: (args: string[]) => unknown) {
    this.answer = answer;
  }

  json(args: readonly string[]): unknown {
    this.calls.push([...args]);
    const answer = this.answer([...args]);
    if (answer instanceof Error) throw answer;
    return answer;
  }

  run(args: readonly string[]): void {
    this.json(args);
  }

  pause(): void {}

  callsOf(...words: string[]): string[][] {
    return this.calls.filter((call) => words.every((word, index) => call[index] === word));
  }
}

const notFound = (args: string[]) => new CfError(args, "404 Not Found · HTTP /accounts/x/workers/workers/alcyone");

/** A Cloudflare account with the given Access applications and Worker, and tags by resource ID. */
function account(options: { apps?: { id: string; domain: string }[]; worker?: boolean; tags?: Record<string, Record<string, string>> } = {}) {
  let workerExists = options.worker ?? false;
  return new FakeCf((args) => {
    const command = args.slice(0, 4).join(" ");
    if (command === "zero-trust access applications list") return options.apps ?? [];
    if (command === "zero-trust access applications create") return { id: "app-1", aud: "aud-1" };
    if (command.startsWith("zero-trust access applications update")) return { id: args[4], aud: "aud-1" };
    if (args.join(" ") === "zero-trust organization get") return ORGANIZATION;
    if (args.join(" ") === "zero-trust identity-providers list") return LOGIN_METHODS;
    if (args[0] === "workers" && args[1] === "get") return workerExists ? { id: "worker-1" } : notFound(args);
    if (args[0] === "deploy") {
      workerExists = true;
      return null;
    }
    if (command === "tags account-resources get --resource-type") return { tags: options.tags?.[args[6] ?? ""] ?? {} };
    if (command === "tags account-resources update --body") return {};
    throw new Error(`Unexpected command: cf ${args.join(" ")}`);
  });
}

function deploy(cf: FakeCf) {
  const written: Record<string, string>[] = [];
  const removed: string[] = [];
  const resources = deployStack({
    settings,
    secrets: SECRETS,
    cf,
    log: () => undefined,
    writeSecretsFile: (values) => {
      written.push(values);
      return { path: "/tmp/alcyone-test/secrets.json", remove: () => removed.push("secrets") };
    },
  });
  return { resources, written, removed };
}

describe("deployStack", () => {
  it("creates the Access application and the Worker, tags both, and gives the Worker its secrets", () => {
    const cf = account();
    const { resources, written, removed } = deploy(cf);
    expect(resources.map((resource) => resource.type)).toEqual(["access_application", "worker"]);
    const body = JSON.parse(cf.callsOf("zero-trust", "access", "applications", "create")[0]?.at(-1) ?? "{}");
    expect(body).toMatchObject({ domain: "boards.example.com", type: "self_hosted", policies: [{ include: [{ email: { email: "admin@example.com" } }] }] });
    expect(body.allowed_idps).toBeUndefined();
    expect(written).toEqual([
      { S3_ACCESS_KEY_ID: "key-id", S3_SECRET_ACCESS_KEY: "secret", ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com", ACCESS_AUD: "aud-1" },
    ]);
    expect(removed).toEqual(["secrets"]);
    const tags = cf.callsOf("tags", "account-resources", "update").map((call) => JSON.parse(call.at(-1) ?? "{}"));
    expect(tags.map((tag) => tag.tags[STACK_TAG])).toEqual(["alcyone", "alcyone"]);
  });

  it("updates the application of the domain and keeps its other tags", () => {
    const cf = account({ apps: [{ id: "app-9", domain: "boards.example.com" }], worker: true, tags: { "app-9": { team: "design" } } });
    deploy(cf);
    expect(cf.callsOf("zero-trust", "access", "applications", "update")).toHaveLength(1);
    const tags = cf.callsOf("tags", "account-resources", "update").map((call) => JSON.parse(call.at(-1) ?? "{}"));
    expect(tags[0]).toMatchObject({ resource_id: "app-9", tags: { team: "design", [STACK_TAG]: "alcyone" } });
  });

  it("stops before any change when a resource belongs to another stack", () => {
    const cf = account({ apps: [{ id: "app-9", domain: "boards.example.com" }], tags: { "app-9": { [STACK_TAG]: "other" } } });
    expect(() => deploy(cf)).toThrow(/belongs to the stack other/);
    expect(cf.callsOf("deploy")).toHaveLength(0);
    expect(cf.callsOf("zero-trust", "access", "applications", "update")).toHaveLength(0);
  });
});

describe("offeredLoginMethods", () => {
  it("offers every method for all, and the named ones by type or ID", () => {
    expect(offeredLoginMethods("all", LOGIN_METHODS)).toEqual(LOGIN_METHODS);
    expect(offeredLoginMethods(["github", "idp-otp"], LOGIN_METHODS).map((method) => method.id)).toEqual(["idp-github", "idp-otp"]);
  });

  it("names the methods that the organization has when the settings name another", () => {
    expect(() => offeredLoginMethods(["passkeys"], LOGIN_METHODS)).toThrow(/It has onetimepin, github \(GitHub\)/);
    expect(() => offeredLoginMethods("all", [])).toThrow(/^Please add a login method/);
  });
});

describe("stackResources and deleteStack", () => {
  it("deletes the Worker first, and counts a resource that is gone as deleted", () => {
    const cf = new FakeCf((args) => {
      if (args[0] === "tags" && args[1] === "resources") {
        return [
          { type: "access_application", id: "app-1", name: "alcyone" },
          { type: "worker", id: "worker-1", name: "alcyone" },
          { type: "r2_bucket", id: "bucket-1", name: "other" },
        ];
      }
      if (args[0] === "workers" && args[1] === "delete") return notFound(args);
      return {};
    });
    const { resources, others } = stackResources(cf, "alcyone");
    expect(resources.map((resource) => resource.type)).toEqual(["worker", "access_application"]);
    expect(others).toEqual(["r2_bucket other"]);
    const lines: string[] = [];
    deleteStack({ cf, log: (line) => lines.push(line), resources });
    expect(lines).toEqual(["Worker alcyone: already gone", "Access application alcyone: deleted"]);
    expect(cf.callsOf("tags", "account-resources", "delete")).toHaveLength(2);
  });
});

describe("missingStoragePermissions", () => {
  it("finds nothing missing for a key that may do everything, and leaves nothing behind", async () => {
    const bucket = new MemoryBucket();
    expect(await missingStoragePermissions(new R2BucketStore(bucket), "check-1")).toEqual([]);
    expect(bucket.objects.size).toBe(0);
  });

  it("names what the bucket refuses", async () => {
    const inner = new R2BucketStore(new MemoryBucket());
    const store: ObjectStore = {
      getText: (key) => inner.getText(key),
      getObject: (key) => inner.getObject(key),
      put: (key, body, type) => inner.put(key, body, type),
      delete: (key) => inner.delete(key),
      list: async () => {
        throw new Error("ListObjectsV2 failed with HTTP 403 (AccessDenied).");
      },
    };
    const missing = await missingStoragePermissions(store, "check-2");
    expect(missing.map((item) => item.permission)).toEqual(["list objects"]);
    expect(missingPermissionsMessage("alcyone-boards", missing)).toMatch(/^Please give the access key in .env.production permission to list objects in the bucket alcyone-boards/);
  });

  it("stops at once when the key may not delete", async () => {
    const writes: string[] = [];
    const store: ObjectStore = {
      getText: async () => null,
      getObject: async () => null,
      put: async (key) => {
        writes.push(key);
      },
      delete: async () => {
        throw new Error("DeleteObject failed with HTTP 403.");
      },
      list: async () => [],
    };
    expect((await missingStoragePermissions(store, "check-3")).map((item) => item.permission)).toEqual(["delete objects"]);
    expect(writes).toEqual([]);
  });
});

describe("parseEnvFile", () => {
  it("reads keys and values, without comments and quotes", () => {
    expect(parseEnvFile('# keys\nS3_ACCESS_KEY_ID="abc"\n\nS3_SECRET_ACCESS_KEY=xyz\n')).toEqual(
      new Map([
        ["S3_ACCESS_KEY_ID", "abc"],
        ["S3_SECRET_ACCESS_KEY", "xyz"],
      ]),
    );
  });
});
