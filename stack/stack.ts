// An alcyone deployment as one stack: `pnpm stack:deploy` creates or updates every
// Cloudflare resource that the settings describe, and `pnpm stack:delete` deletes them
// all. The bucket of the boards is outside the stack, as it can be at any S3-compatible
// provider.
//
// Cloudflare keeps the list of the resources of a stack. Each one carries the tag
// alcyone.stack=<Worker name> (Resource Tagging), so this machine keeps no state. A
// resource that already carries the tag of another stack is never taken over. The
// Durable Objects belong to the Worker: they come and go with it.

import type { AlcyoneSettings } from "../config/settings.ts";
import { CF_ATTEMPTS, CF_FIRST_DELAY_MS, CfError, isPassingCfError, type Cf } from "./cf.ts";

/** The tag that marks the resources of a stack. Its value is the name of the stack, the Worker name. */
export const STACK_TAG = "alcyone.stack";

export type ResourceType = "worker" | "access_application";

export interface StackResource {
  type: ResourceType;
  /** The ID that Resource Tagging uses: the Worker ID or the Access application ID. */
  id: string;
  /** What people know the resource by: the Worker name, or the name of the application. */
  name: string;
}

/** Keys of the production storage, from .env.production. */
export interface StackSecrets {
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
}

export interface SecretsFile {
  path: string;
  remove(): void;
}

export interface DeployOptions {
  settings: AlcyoneSettings;
  secrets: StackSecrets;
  cf: Cf;
  log: (line: string) => void;
  /** Writes the secrets that cf deploy uploads to a file that only this user can read. */
  writeSecretsFile: (values: Record<string, string>) => SecretsFile;
}

/** Creates or updates the resources of the stack, deploys the Worker, and returns the resources. */
export function deployStack({ settings, secrets, cf, log, writeSecretsFile }: DeployOptions): StackResource[] {
  const stack = settings.workerName;
  const domain = settings.production.domain;

  // Find what exists, and stop before any change if part of it belongs to another stack.
  const existingApp = accessApplications(cf).find((app) => app.domain === domain) ?? null;
  const existingWorker = findWorker(cf, stack);
  const tagsOf = new Map<string, Record<string, string>>();
  const claim = (resource: StackResource) => {
    const tags = readOwnTags(cf, resource);
    const owner = tags[STACK_TAG];
    if (owner !== undefined && owner !== stack) {
      throw new Error(`${describe(resource)} belongs to the stack ${owner}, so the stack ${stack} cannot use it.`);
    }
    tagsOf.set(key(resource), tags);
  };
  if (existingApp !== null) claim({ type: "access_application", id: existingApp.id, name: stack });
  if (existingWorker !== null) claim({ type: "worker", id: existingWorker.id, name: stack });
  // The Zero Trust organization signs the tokens of Access. An account without one, or a
  // login method that the organization lacks, stops the deploy here too.
  const teamDomain = accessTeamDomain(cf);
  const loginSetting = settings.production.access.loginMethods;
  const loginMethods = offeredLoginMethods(loginSetting, identityProviders(cf));

  const resources: StackResource[] = [];
  const mark = (resource: StackResource) => {
    writeTags(cf, resource, { ...(tagsOf.get(key(resource)) ?? {}), [STACK_TAG]: stack });
    resources.push(resource);
  };

  // The Access application of the domain, whose only policy allows the people in the
  // settings, and whose sign-in page offers the login methods in the settings.
  const body = JSON.stringify(accessApplicationBody(settings, loginSetting === "all" ? null : loginMethods.map((method) => method.id)));
  const app = readAccessApplication(
    existingApp === null
      ? createOnce(cf, ["zero-trust", "access", "applications", "create", "--body", body], () =>
          list(cf.json(["zero-trust", "access", "applications", "list"])).find((item) => text(item, "domain") === domain),
        )
      : cf.json(["zero-trust", "access", "applications", "update", existingApp.id, "--body", body]),
  );
  const appResource: StackResource = { type: "access_application", id: app.id, name: stack };
  mark(appResource);
  log(`${describe(appResource)}: ${existingApp === null ? "created" : "updated"}`);
  log(`  Sign-in: ${loginMethods.map(describeLoginMethod).join(", ")}`);

  // The Worker with its Durable Objects, the storage keys of .env.production, and the team
  // domain and the AUD tag of Access, which cloudflare.config.ts reads.
  const file = writeSecretsFile({
    S3_ACCESS_KEY_ID: secrets.s3AccessKeyId,
    S3_SECRET_ACCESS_KEY: secrets.s3SecretAccessKey,
    ACCESS_TEAM_DOMAIN: teamDomain,
    ACCESS_AUD: app.aud,
  });
  try {
    cf.run(["deploy", "--secrets-file", file.path]);
  } finally {
    file.remove();
  }
  const worker = findWorker(cf, stack);
  if (worker === null) throw new Error(`cf deploy finished, but the Worker ${stack} does not exist.`);
  const workerResource: StackResource = { type: "worker", id: worker.id, name: stack };
  mark(workerResource);
  log(`${describe(workerResource)}: ${existingWorker === null ? "created" : "updated"}`);
  return resources;
}

/** The resources that carry the tag of the stack, in the order in which they can be deleted. */
export function stackResources(cf: Cf, stack: string): { resources: StackResource[]; others: string[] } {
  const raw = cf.json(["tags", "resources", "list", "--tag", `${STACK_TAG}=${stack}`]);
  const resources: StackResource[] = [];
  const others: string[] = [];
  for (const item of list(raw)) {
    const type = text(item, "type") ?? text(item, "resource_type");
    const id = text(item, "id") ?? text(item, "resource_id");
    if (type === undefined || id === undefined) continue;
    const name = text(item, "name") ?? id;
    if (type === "worker" || type === "access_application") resources.push({ type, id, name });
    else others.push(`${type} ${name}`);
  }
  // Stop serving first, then remove who may sign in.
  const order: ResourceType[] = ["worker", "access_application"];
  resources.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return { resources, others };
}

/**
 * Deletes the resources of a stack, which the person has confirmed, so cf asks nothing
 * more (--force).
 *
 * Cloudflare keeps the tags of a resource after the resource is gone, so each tag is
 * removed too. A resource that is already gone counts as deleted, so a delete that
 * stopped halfway can run again.
 */
export function deleteStack({ cf, log, resources }: { cf: Cf; log: (line: string) => void; resources: StackResource[] }): void {
  for (const resource of resources) {
    const existed = unlessGone(() => {
      switch (resource.type) {
        case "worker":
          cf.json(["workers", "delete", resource.id, "--force"]);
          break;
        case "access_application":
          cf.json(["zero-trust", "access", "applications", "delete", resource.id, "--force"]);
          break;
      }
    });
    cf.json(["tags", "account-resources", "delete", "--resource-type", resource.type, "--resource-id", resource.id, "--force"]);
    log(`${describe(resource)}: ${existed ? "deleted" : "already gone"}`);
  }
}

export function describe(resource: StackResource): string {
  switch (resource.type) {
    case "worker":
      return `Worker ${resource.name}`;
    case "access_application":
      return `Access application ${resource.name}`;
  }
}

/**
 * The Access application that lets only the people in the settings open the domain,
 * through the login methods of these IDs, or through every login method of the Zero
 * Trust organization, ones added later included, without a list. Cloudflare replaces the
 * whole application on an update, so the body holds every setting that alcyone makes.
 */
export function accessApplicationBody(settings: AlcyoneSettings, loginMethodIds: readonly string[] | null) {
  return {
    name: settings.workerName,
    domain: settings.production.domain,
    type: "self_hosted",
    ...(loginMethodIds === null ? {} : { allowed_idps: loginMethodIds }),
    policies: [
      {
        name: "Allowed people",
        decision: "allow",
        include: settings.production.access.allow.map((email) => ({ email: { email } })),
      },
    ],
  };
}

/** A login method of the Zero Trust organization, which the Cloudflare API calls an identity provider. */
export interface LoginMethod {
  id: string;
  /** The kind of login method, such as onetimepin, github, or passkeys. */
  type: string;
  /** The name in the dashboard. Cloudflare leaves it empty for the one-time PIN. */
  name: string;
}

/**
 * The login methods that the sign-in page offers: every one of the organization for
 * "all", or the ones that the settings name. A setting names a login method by its ID,
 * or by its type when the organization has one login method of that type.
 */
export function offeredLoginMethods(setting: "all" | readonly string[], methods: readonly LoginMethod[]): LoginMethod[] {
  const path = "production.access.loginMethods";
  if (methods.length === 0) {
    throw new Error("Please add a login method to the Zero Trust organization in Zero Trust > Integrations > Identity providers, so that people can sign in.");
  }
  if (setting === "all") return [...methods];
  const problems: string[] = [];
  const offered: LoginMethod[] = [];
  for (const name of setting) {
    const byId = methods.find((method) => method.id === name);
    const matches = byId === undefined ? methods.filter((method) => method.type === name) : [byId];
    const [match] = matches;
    if (match === undefined) {
      problems.push(
        `${path} names ${name}, but the Zero Trust organization has no login method of that type or ID. It has ${methods.map(describeLoginMethod).join(", ")}. Write one of them, write "all", or add ${name} in Zero Trust > Integrations > Identity providers.`,
      );
    } else if (matches.length > 1) {
      const listed = matches.map((method) => (method.name === "" ? method.id : `${method.id} (${method.name})`)).join(", ");
      problems.push(`The Zero Trust organization has ${matches.length} login methods of the type ${name}: ${listed}. Write the ID of the one to allow in ${path}.`);
    } else if (!offered.includes(match)) {
      offered.push(match);
    }
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return offered;
}

/** A login method as the settings can name it: its type, and its name in the dashboard when it has one. */
function describeLoginMethod(method: LoginMethod): string {
  return method.name === "" ? method.type : `${method.type} (${method.name})`;
}

/** The team domain of the Zero Trust organization of the account, which signs the tokens of Access. */
function accessTeamDomain(cf: Cf): string {
  let organization: unknown = null;
  try {
    organization = cf.json(["zero-trust", "organization", "get"]);
  } catch (error) {
    if (error instanceof CfError && (error.status === 401 || error.status === 403)) {
      throw new Error(
        "Please give the API token that deploys alcyone the permission Access: Organizations, Identity Providers, and Groups Read: Cloudflare refused to show the Zero Trust organization.",
      );
    }
    if (!(error instanceof CfError && error.status === 404)) throw error;
  }
  const domain = text(organization, "auth_domain");
  if (domain === undefined) {
    throw new Error(
      "Please create a Zero Trust organization under Zero Trust in the Cloudflare dashboard, which runs Cloudflare Access. The Free plan is enough.",
    );
  }
  return `https://${domain}`;
}

function identityProviders(cf: Cf): LoginMethod[] {
  return list(cf.json(["zero-trust", "identity-providers", "list"])).flatMap((item) => {
    const id = text(item, "id");
    const type = text(item, "type");
    return id === undefined || type === undefined ? [] : [{ id, type, name: text(item, "name") ?? "" }];
  });
}

/**
 * Runs a cf command that creates a resource, and returns what Cloudflare answered. A failure that
 * may pass can come after Cloudflare made the resource, so before the command runs again, the
 * stack waits and looks for the resource, and takes it when it is there: it never makes two.
 */
function createOnce(cf: Cf, args: readonly string[], find: () => unknown): unknown {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return cf.json(args, { retry: false });
    } catch (error) {
      if (attempt >= CF_ATTEMPTS || !isPassingCfError(error)) throw error;
      cf.pause(CF_FIRST_DELAY_MS * 2 ** (attempt - 1));
      const found = find();
      if (found !== undefined && found !== null) return found;
    }
  }
}

function accessApplications(cf: Cf): { id: string; domain: string }[] {
  return list(cf.json(["zero-trust", "access", "applications", "list"])).flatMap((item) => {
    const id = text(item, "id");
    const domain = text(item, "domain");
    return id === undefined || domain === undefined ? [] : [{ id, domain }];
  });
}

function readAccessApplication(raw: unknown): { id: string; aud: string } {
  const id = text(raw, "id");
  const aud = text(raw, "aud");
  if (id === undefined || aud === undefined) throw new Error("Cloudflare answered an Access application without an ID or an AUD tag.");
  return { id, aud };
}

function findWorker(cf: Cf, name: string): { id: string } | null {
  try {
    const id = text(cf.json(["workers", "get", name]), "id");
    if (id === undefined) throw new Error(`Cloudflare answered the Worker ${name} without an ID.`);
    return { id };
  } catch (error) {
    if (error instanceof CfError && error.status === 404) return null;
    throw error;
  }
}

/** The tags that a resource has now. A resource that never had tags answers 500 during the beta of Resource Tagging. */
function readOwnTags(cf: Cf, resource: StackResource): Record<string, string> {
  try {
    // No retry: a 500 here is the answer for a resource without tags, which runs again in vain.
    const raw = cf.json(["tags", "account-resources", "get", "--resource-type", resource.type, "--resource-id", resource.id], { retry: false });
    const tags = isRecord(raw) ? raw["tags"] : undefined;
    if (!isRecord(tags)) return {};
    return Object.fromEntries(Object.entries(tags).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch (error) {
    if (error instanceof CfError && (error.status === 404 || error.status === 500)) return {};
    throw error;
  }
}

/** Sets the tags of a resource. Cloudflare replaces all of them, so `tags` holds the ones to keep too. */
function writeTags(cf: Cf, resource: StackResource, tags: Record<string, string>): void {
  cf.json(["tags", "account-resources", "update", "--body", JSON.stringify({ resource_type: resource.type, resource_id: resource.id, tags })]);
}

/** Runs a deletion, and answers false when the resource did not exist. */
function unlessGone(remove: () => void): boolean {
  try {
    remove();
    return true;
  } catch (error) {
    if (error instanceof CfError && error.status === 404) return false;
    throw error;
  }
}

function key(resource: StackResource): string {
  return `${resource.type}/${resource.id}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const found = value[field];
  return typeof found === "string" && found !== "" ? found : undefined;
}
