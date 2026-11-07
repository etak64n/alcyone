// Reads the Worker bindings into typed configuration. A missing or invalid binding stops
// every API request, and every save of a board, so alcyone never runs half configured.

import type { Env } from "./env.ts";

export type AuthMode = "cloudflare-access" | "local-development";

/** The S3-compatible API that holds the boards and their images. */
export interface S3Config {
  type: "s3";
  endpoint: string;
  region: string;
  bucket: string;
  urlStyle: "path" | "virtual-hosted";
  accessKeyId: string;
  secretAccessKey: string;
}

/** The local bucket of `cf dev`, through its R2 binding. */
export interface LocalR2Config {
  type: "local-r2";
  bucket: R2Bucket;
}

export type StorageConfig = S3Config | LocalR2Config;

export interface AccessConfig {
  teamDomain: string;
  aud: string;
}

export interface RuntimeConfig {
  authMode: AuthMode;
  /** Null in the local development mode, where Access does not run. */
  access: AccessConfig | null;
  storage: StorageConfig;
  /** Lowercase emails of the people who can rename and delete every board. */
  admins: ReadonlySet<string>;
  /** In local development mode, the email that the Worker signs in. Null otherwise. */
  localUserEmail: string | null;
}

export class ConfigurationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The Worker configuration has ${problems.length} problem(s): ${problems.join(" ")}`);
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

const EMAIL = /^[^\sA-Z@]+@[^\sA-Z@]+\.[^\sA-Z@]+$/;

type TextBinding = "AUTH_MODE" | "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD" | "ADMIN_EMAILS" | "LOCAL_USER_EMAIL" | "STORAGE_TYPE"
  | "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_URL_STYLE" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY";

function textReader(env: Env, problems: string[]): (name: TextBinding) => string {
  return (name) => {
    const value: unknown = env[name];
    if (typeof value !== "string" || value === "") {
      problems.push(`${name} is not set.`);
      return "";
    }
    return value;
  };
}

/** Reads the whole configuration, for a request to the API. */
export function readRuntimeConfig(env: Env): RuntimeConfig {
  const problems: string[] = [];
  const text = textReader(env, problems);

  const authModeText = text("AUTH_MODE");
  if (authModeText !== "" && authModeText !== "cloudflare-access" && authModeText !== "local-development") {
    problems.push(`AUTH_MODE must be "cloudflare-access" or "local-development".`);
  }
  const authMode: AuthMode = authModeText === "local-development" ? "local-development" : "cloudflare-access";
  const storage = readStorage(env, problems);
  if (storage?.type === "local-r2" && authMode !== "local-development") {
    problems.push('STORAGE_TYPE "local-r2" works only with AUTH_MODE "local-development".');
  }
  const admins = readAdmins(text("ADMIN_EMAILS"), problems);
  let localUserEmail: string | null = null;
  if (authMode === "local-development") {
    localUserEmail = text("LOCAL_USER_EMAIL");
    if (localUserEmail !== "" && !EMAIL.test(localUserEmail)) problems.push("LOCAL_USER_EMAIL must be a lowercase email address.");
  }
  const access = authMode === "cloudflare-access" ? { teamDomain: text("ACCESS_TEAM_DOMAIN"), aud: text("ACCESS_AUD") } : null;
  if (problems.length > 0 || storage === null) throw new ConfigurationError(problems);
  return { authMode, access, storage, admins, localUserEmail };
}

/** Reads the storage alone, for the Durable Objects, which save the boards. */
export function readStorageConfig(env: Env): StorageConfig {
  const problems: string[] = [];
  const storage = readStorage(env, problems);
  if (problems.length > 0 || storage === null) throw new ConfigurationError(problems);
  return storage;
}

function readStorage(env: Env, problems: string[]): StorageConfig | null {
  const text = textReader(env, problems);
  const type = text("STORAGE_TYPE");
  if (type === "local-r2") {
    if (env.LOCAL_BUCKET === undefined) {
      problems.push('LOCAL_BUCKET is not bound to an R2 bucket, which STORAGE_TYPE "local-r2" needs.');
      return null;
    }
    return { type: "local-r2", bucket: env.LOCAL_BUCKET };
  }
  if (type !== "s3") {
    if (type !== "") problems.push('STORAGE_TYPE must be "s3" or "local-r2".');
    return null;
  }
  const urlStyle = text("S3_URL_STYLE");
  if (urlStyle !== "" && urlStyle !== "path" && urlStyle !== "virtual-hosted") {
    problems.push(`S3_URL_STYLE must be "path" or "virtual-hosted".`);
  }
  return {
    type: "s3",
    endpoint: text("S3_ENDPOINT"),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    urlStyle: urlStyle === "virtual-hosted" ? "virtual-hosted" : "path",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  };
}

function readAdmins(json: string, problems: string[]): ReadonlySet<string> {
  if (json === "") return new Set();
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    value = null;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && EMAIL.test(item))) {
    problems.push("ADMIN_EMAILS must be a JSON list of lowercase email addresses.");
    return new Set();
  }
  return new Set(value as string[]);
}
