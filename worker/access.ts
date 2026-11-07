// Checks the Cloudflare Access token on API requests.
//
// Access adds a signed JWT to every request it lets through, in the
// Cf-Access-Jwt-Assertion header, WebSocket upgrades included. The Worker verifies it on
// every API request, so a deployment that forgot to set up Access returns nothing
// instead of exposing the boards.

import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { retry } from "../shared/retry.ts";
import type { AccessConfig } from "./runtime-config.ts";

export type KeySetProvider = (teamDomain: string) => JWTVerifyGetKey;

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

const keySets = new Map<string, JWTVerifyGetKey>();

/**
 * Loads the signing keys of an Access team and keeps them for the life of the isolate. A load
 * that failed in a way that may pass runs again, twice at most.
 */
export const remoteKeySet: KeySetProvider = (teamDomain) => {
  let keySet = keySets.get(teamDomain);
  if (keySet === undefined) {
    const remote = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain));
    keySet = (header, token) => retry(() => remote(header, token), { attempts: 3, firstDelayMs: 200, retryable: isKeyLoadFailure });
    keySets.set(teamDomain, keySet);
  }
  return keySet;
};

// The keys did not arrive: a lost connection, no answer in time, or an answer other than 200.
function isKeyLoadFailure(error: unknown): boolean {
  return error instanceof TypeError
    || error instanceof errors.JWKSTimeout
    || (error instanceof errors.JOSEError && error.message.startsWith("Expected 200 OK"));
}

/** Verifies the token, and returns the email of the person that it names. */
export async function verifyAccessToken(token: string | undefined, access: AccessConfig, keySet: JWTVerifyGetKey): Promise<string> {
  if (token === undefined || token === "") {
    throw new AccessDeniedError("The request has no Cloudflare Access token.");
  }
  let email: unknown;
  try {
    const { payload } = await jwtVerify(token, keySet, { issuer: access.teamDomain, audience: access.aud });
    email = payload["email"];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AccessDeniedError(`The Cloudflare Access token is not valid: ${reason}`);
  }
  if (typeof email !== "string" || email === "") {
    throw new AccessDeniedError("The Cloudflare Access token names no person. alcyone needs a person who signs in.");
  }
  return email.toLowerCase();
}

/** True for requests to this machine, the only place where local development mode answers. */
export function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}
