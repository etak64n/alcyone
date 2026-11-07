// Settings of one alcyone deployment.
//
// Each deployment writes its settings in alcyone.config.ts. cloudflare.config.ts
// validates them with validateSettings() and turns them into the Worker
// configuration. Every field is required: alcyone has no default values, so a
// deployment behaves exactly as its settings say.
//
// Node.js loads this file directly when the Cloudflare CLI reads
// cloudflare.config.ts, so it uses only TypeScript syntax that Node.js can strip.

export type UrlStyle = "path" | "virtual-hosted";

/** Object storage with an S3-compatible API, which holds the boards and their images. */
export interface S3StorageSettings {
  type: "s3";
  /** Origin of the S3-compatible API, such as https://s3.example.com. */
  endpoint: string;
  /** Region name that the storage service expects in request signatures. */
  region: string;
  /** Bucket that holds the boards and their images. */
  bucket: string;
  /** Whether object URLs carry the bucket name in the path or in the hostname. */
  urlStyle: UrlStyle;
}

/**
 * An R2 bucket that `cf dev` keeps on this machine. It exists only in development,
 * so that alcyone runs on a machine without a bucket of its own.
 */
export interface LocalR2StorageSettings {
  type: "local-r2";
}

export type StorageSettings = S3StorageSettings | LocalR2StorageSettings;

/**
 * Cloudflare Access, which asks for a sign-in before alcyone opens. The team domain of
 * the Zero Trust organization is not a setting: an account has one organization, and
 * `pnpm stack:deploy` reads its team domain from Cloudflare.
 */
export interface AccessSettings {
  /**
   * Emails of the people who may sign in. `pnpm stack:deploy` gives the domain an
   * Access application whose only policy allows these addresses.
   */
  allow: string[];
  /**
   * The login methods that the sign-in page of the domain offers: "all" for every login
   * method of the Zero Trust organization, or a list of them, each by its type, such as
   * "onetimepin", "github", or "passkeys", or by its ID.
   */
  loginMethods: "all" | string[];
}

export interface ProductionSettings {
  /** Hostname that serves alcyone. Its zone must be in the same Cloudflare account. */
  domain: string;
  storage: S3StorageSettings;
  access: AccessSettings;
}

export interface DevelopmentSettings {
  /**
   * The email that `cf dev` signs you in as. Cloudflare Access does not run on
   * this machine, so this setting stands in for the email that Access reports.
   */
  signInAs: string;
  /** Storage that `cf dev` uses: the local R2 bucket, or a bucket that holds no production boards. */
  storage: StorageSettings;
}

export interface AlcyoneSettings {
  /** Cloudflare account that owns the Worker and the domain. */
  accountId: string;
  /** Name of the Worker. */
  workerName: string;
  /** Emails of the people who can rename and delete every board. Everyone else renames and deletes their own. */
  admins: string[];
  production: ProductionSettings;
  development: DevelopmentSettings;
}

/** Declares the settings of a deployment with type checking. */
export function defineAlcyoneConfig(settings: AlcyoneSettings): AlcyoneSettings {
  return settings;
}

/** Thrown when alcyone.config.ts is incomplete or has invalid values. */
export class SettingsError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `alcyone.config.ts has ${problems.length} problem(s):\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "SettingsError";
    this.problems = problems;
  }
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const NO_WHITESPACE = /^\S+$/;
// A lowercase email address. alcyone compares it with the email that Cloudflare Access reports, in lowercase.
const EMAIL = /^[^\sA-Z@]+@[^\sA-Z@]+\.[^\sA-Z@]+$/;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

type Problems = string[];
type Fields = Record<string, unknown>;

/** Checks the settings and returns them with URLs normalized to their origins. */
export function validateSettings(input: unknown): AlcyoneSettings {
  const problems: Problems = [];
  const root = readObject(input, "settings", problems);
  if (root === null) throw new SettingsError(problems);
  checkKeys(root, "", ["accountId", "workerName", "admins", "production", "development"], problems);

  const accountId = readPattern(root, "accountId", "", ACCOUNT_ID, "a 32-character lowercase hexadecimal account ID", problems);
  const workerName = readPattern(root, "workerName", "", WORKER_NAME, "lowercase letters, digits, and hyphens (at most 63 characters)", problems);
  const admins = readEmails(root, "admins", problems);

  const production = readObject(root["production"], "production", problems);
  let domain = "";
  let productionStorage: S3StorageSettings | null = null;
  let access: AccessSettings | null = null;
  if (production !== null) {
    checkKeys(production, "production.", ["domain", "storage", "access"], problems);
    domain = readPattern(production, "domain", "production.", HOSTNAME, "a lowercase hostname without a scheme or path", problems);
    productionStorage = readProductionStorage(production["storage"], problems);
    access = readAccess(production["access"], problems);
  }

  const development = readObject(root["development"], "development", problems);
  let signInAs = "";
  let developmentStorage: StorageSettings | null = null;
  if (development !== null) {
    checkKeys(development, "development.", ["signInAs", "storage"], problems);
    signInAs = readPattern(development, "signInAs", "development.", EMAIL, "a lowercase email address", problems);
    developmentStorage = readDevelopmentStorage(development["storage"], problems);
  }

  // Admins sign in through Access too, so Access has to let them in.
  const locked = access === null ? [] : admins.filter((admin) => !access.allow.includes(admin));
  if (locked.length > 0) problems.push(`production.access.allow must include every admin, so that they can sign in: ${locked.join(", ")}.`);

  if (problems.length > 0 || productionStorage === null || access === null || developmentStorage === null) {
    throw new SettingsError(problems);
  }
  return {
    accountId,
    workerName,
    admins,
    production: { domain, storage: productionStorage, access },
    development: { signInAs, storage: developmentStorage },
  };
}

function readProductionStorage(input: unknown, problems: Problems): S3StorageSettings | null {
  const path = "production.storage";
  const storage = readObject(input, path, problems);
  if (storage === null) return null;
  if (!("type" in storage)) {
    problems.push(`${path}.type is missing.`);
    return null;
  }
  if (storage["type"] !== "s3") {
    problems.push(`${path}.type must be "s3". The local R2 bucket exists only in cf dev.`);
    return null;
  }
  return readS3Storage(storage, path, false, problems);
}

function readDevelopmentStorage(input: unknown, problems: Problems): StorageSettings | null {
  const path = "development.storage";
  const storage = readObject(input, path, problems);
  if (storage === null) return null;
  if (!("type" in storage)) {
    problems.push(`${path}.type is missing.`);
    return null;
  }
  if (storage["type"] === "local-r2") {
    checkKeys(storage, `${path}.`, ["type"], problems);
    return { type: "local-r2" };
  }
  if (storage["type"] !== "s3") {
    problems.push(`${path}.type must be "s3" or "local-r2".`);
    return null;
  }
  return readS3Storage(storage, path, true, problems);
}

function readS3Storage(storage: Fields, path: string, allowLocalHttp: boolean, problems: Problems): S3StorageSettings | null {
  const prefix = `${path}.`;
  checkKeys(storage, prefix, ["type", "endpoint", "region", "bucket", "urlStyle"], problems);
  const endpoint = readOrigin(storage, "endpoint", prefix, allowLocalHttp, problems);
  const region = readPattern(storage, "region", prefix, NO_WHITESPACE, "a region name without spaces", problems);
  const bucket = readPattern(storage, "bucket", prefix, BUCKET, "a bucket name of 3 to 63 lowercase letters, digits, dots, and hyphens", problems);
  if (!("urlStyle" in storage)) {
    problems.push(`${prefix}urlStyle is missing.`);
    return null;
  }
  const urlStyle = storage["urlStyle"];
  if (urlStyle !== "path" && urlStyle !== "virtual-hosted") {
    problems.push(`${prefix}urlStyle must be "path" or "virtual-hosted".`);
    return null;
  }
  return { type: "s3", endpoint, region, bucket, urlStyle };
}

function readAccess(input: unknown, problems: Problems): AccessSettings | null {
  const access = readObject(input, "production.access", problems);
  if (access === null) return null;
  checkKeys(access, "production.access.", ["allow", "loginMethods"], problems);
  const allow = readEmails(access, "allow", problems, "production.access.");
  if (Array.isArray(access["allow"]) && access["allow"].length === 0) problems.push("production.access.allow must name at least one person.");
  const loginMethods = readLoginMethods(access, problems);
  return { allow, loginMethods };
}

// Reads the login methods of the Access application. `pnpm stack:deploy` looks them up
// in the Zero Trust organization, because only Cloudflare knows which ones exist.
function readLoginMethods(access: Fields, problems: Problems): "all" | string[] {
  const path = "production.access.loginMethods";
  if (!("loginMethods" in access)) {
    problems.push(`${path} is missing.`);
    return [];
  }
  const value = access["loginMethods"];
  if (value === "all") return "all";
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && NO_WHITESPACE.test(item))) {
    problems.push(`${path} must be "all" or a list of login method types or IDs, such as ["onetimepin"].`);
    return [];
  }
  if (value.length === 0) problems.push(`${path} must name at least one login method.`);
  const repeated = value.filter((item, index) => value.indexOf(item) !== index);
  if (repeated.length > 0) problems.push(`${path} must name each login method once: ${[...new Set(repeated)].join(", ")}.`);
  return value as string[];
}

// Reads a list of lowercase email addresses. An empty list is allowed: then nobody is an admin.
function readEmails(fields: Fields, key: string, problems: Problems, prefix = ""): string[] {
  if (!(key in fields)) {
    problems.push(`${prefix}${key} is missing.`);
    return [];
  }
  const value = fields[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && EMAIL.test(item))) {
    problems.push(`${prefix}${key} must be a list of lowercase email addresses.`);
    return [];
  }
  return value as string[];
}

function readObject(value: unknown, path: string, problems: Problems): Fields | null {
  if (value === undefined) {
    problems.push(`${path} is missing.`);
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push(`${path} must be an object.`);
    return null;
  }
  return value as Fields;
}

function readPattern(fields: Fields, key: string, prefix: string, pattern: RegExp, description: string, problems: Problems): string {
  if (!(key in fields)) {
    problems.push(`${prefix}${key} is missing.`);
    return "";
  }
  const value = fields[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    problems.push(`${prefix}${key} must be ${description}.`);
    return "";
  }
  return value;
}

// Accepts an https:// origin. Development storage may also use http:// on this machine.
function readOrigin(fields: Fields, key: string, prefix: string, allowLocalHttp: boolean, problems: Problems): string {
  if (!(key in fields)) {
    problems.push(`${prefix}${key} is missing.`);
    return "";
  }
  const value = fields[key];
  const expectation = allowLocalHttp ? "an https:// origin, or an http:// origin on localhost" : "an https:// origin";
  if (typeof value !== "string" || !URL.canParse(value)) {
    problems.push(`${prefix}${key} must be ${expectation}.`);
    return "";
  }
  const url = new URL(value);
  const isOrigin = url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
  const schemeAllowed = url.protocol === "https:" || (allowLocalHttp && url.protocol === "http:" && LOCAL_HOSTNAMES.has(url.hostname));
  if (!isOrigin || !schemeAllowed) {
    problems.push(`${prefix}${key} must be ${expectation}.`);
    return "";
  }
  return url.origin;
}

// Reports keys that alcyone does not read, which are usually misspelled settings.
function checkKeys(fields: Fields, prefix: string, allowed: readonly string[], problems: Problems): void {
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) problems.push(`${prefix}${key} is not a setting that alcyone reads.`);
  }
}
