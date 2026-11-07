// `pnpm stack:deploy` and `pnpm stack:delete`: create, update, or delete every Cloudflare
// resource of this alcyone deployment. Sign in with `cf auth login` first. The settings
// come from alcyone.config.ts and the storage keys from .env.production. The deploy first
// checks that the storage keys may do what alcyone does in the bucket
// (stack/storage-check.ts).
//
//   pnpm stack:deploy
//   pnpm stack:delete [--confirm <stack name>]

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSettings, type AlcyoneSettings } from "../config/settings.ts";
import { S3ObjectStore } from "../worker/storage.ts";
import { projectCf } from "./cf.ts";
import { parseEnvFile } from "./env-file.ts";
import { deleteStack, deployStack, describe, stackResources, STACK_TAG, type SecretsFile, type StackSecrets } from "./stack.ts";
import { missingPermissionsMessage, missingStoragePermissions } from "./storage-check.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const USAGE = "Usage: pnpm stack:deploy | pnpm stack:delete [--confirm <stack name>]";

async function main(args: string[]): Promise<void> {
  const [command, ...options] = args;
  if (command !== "deploy" && command !== "delete") throw new Error(USAGE);
  const settings = await readSettings();
  const cf = projectCf(ROOT);
  const log = (line: string) => console.log(line);

  if (command === "deploy") {
    if (options.length > 0) throw new Error(USAGE);
    const env = readProductionEnv();
    const s3AccessKeyId = env.get("S3_ACCESS_KEY_ID") ?? "";
    const s3SecretAccessKey = env.get("S3_SECRET_ACCESS_KEY") ?? "";
    if (s3AccessKeyId === "" || s3SecretAccessKey === "") {
      throw new Error("Please write the keys of the production bucket in S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY of .env.production.");
    }
    console.log(`Deploying the stack ${settings.workerName}.`);
    await checkStorageKeys(settings, { s3AccessKeyId, s3SecretAccessKey });
    deployStack({ settings, secrets: { s3AccessKeyId, s3SecretAccessKey }, cf, log, writeSecretsFile });
    console.log(`\nalcyone runs at https://${settings.production.domain}/`);
    return;
  }

  const confirmation = readConfirmOption(options);
  const { resources, others } = stackResources(cf, settings.workerName);
  if (resources.length === 0) {
    console.log(`No resource carries the tag ${STACK_TAG}=${settings.workerName}.`);
  } else {
    console.log(`The stack ${settings.workerName} has these resources:`);
    for (const resource of resources) console.log(`  ${describe(resource)}`);
    if (resources.some((resource) => resource.type === "worker")) {
      console.log("\nDeleting the Worker deletes its rooms too, with the edits of the last seconds that they have not saved to the bucket yet.");
    }
    if (!(await confirmed(settings.workerName, confirmation))) {
      console.log("Nothing was deleted.");
      return;
    }
    deleteStack({ cf, log, resources });
  }
  // What the stack does not own, which stays where it is.
  const storage = settings.production.storage;
  console.log("\nDelete these yourself if you no longer need them:");
  console.log(`  The boards and images in the bucket ${storage.bucket} at ${storage.endpoint}, and its access keys in .env.production`);
  for (const other of others) console.log(`  ${other}, which carries the tag of the stack but is not a resource that alcyone creates`);
}

/** Stops the deploy before it changes anything when the storage keys may not do what alcyone does in the bucket. */
async function checkStorageKeys(settings: AlcyoneSettings, secrets: StackSecrets): Promise<void> {
  const storage = settings.production.storage;
  const store = new S3ObjectStore({
    type: "s3",
    endpoint: storage.endpoint,
    region: storage.region,
    bucket: storage.bucket,
    urlStyle: storage.urlStyle,
    accessKeyId: secrets.s3AccessKeyId,
    secretAccessKey: secrets.s3SecretAccessKey,
  });
  const missing = await missingStoragePermissions(store, randomUUID());
  if (missing.length > 0) throw new Error(missingPermissionsMessage(storage.bucket, missing));
  console.log(`Bucket ${storage.bucket}: the access key reads, writes, lists, and deletes objects`);
}

async function readSettings(): Promise<AlcyoneSettings> {
  const file = join(ROOT, "alcyone.config.ts");
  if (!existsSync(file)) throw new Error("Please copy alcyone.config.example.ts to alcyone.config.ts and fill in the values.");
  const module = (await import(pathToFileURL(file).href)) as { default: unknown };
  return validateSettings(module.default);
}

function readProductionEnv(): Map<string, string> {
  const file = join(ROOT, ".env.production");
  if (!existsSync(file)) throw new Error("Please copy .env.example to .env.production and fill in the keys of the production bucket.");
  return parseEnvFile(readFileSync(file, "utf8"));
}

function readConfirmOption(options: string[]): string | null {
  if (options.length === 0) return null;
  const [flag, value] = options;
  if (flag !== "--confirm" || value === undefined || options.length !== 2) throw new Error(USAGE);
  return value;
}

/** The person types the stack name, or passes it with --confirm where nobody can type. */
async function confirmed(stack: string, confirmation: string | null): Promise<boolean> {
  if (confirmation !== null) return confirmation === stack;
  if (!process.stdin.isTTY) throw new Error(`Please pass --confirm ${stack} to delete the stack without a prompt.`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(`\nType ${stack} to delete all of them: `)).trim() === stack;
  } finally {
    prompt.close();
  }
}

/** The secrets for cf deploy, in a folder that only this user can read, which is removed after the deploy. */
function writeSecretsFile(values: Record<string, string>): SecretsFile {
  const folder = mkdtempSync(join(tmpdir(), "alcyone-"));
  const path = join(folder, "secrets.json");
  writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
  return { path, remove: () => rmSync(folder, { recursive: true, force: true }) };
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? `\n${error.message}` : error);
  process.exitCode = 1;
}
