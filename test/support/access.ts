// Signs tokens the way Cloudflare Access does, with a key pair made for the test.

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";

export const TEAM_DOMAIN = "https://example.cloudflareaccess.com";
export const AUD = "test-audience";
/** The person that signedRequest signs in. */
export const VIEWER_EMAIL = "viewer@example.com";
/** The admin of the test deployment. */
export const ADMIN_EMAIL = "admin@example.com";

export interface TokenOptions {
  issuer?: string;
  audience?: string;
  /** The email claim. null signs a token without one, as for a service token. */
  email?: string | null;
  /** Expiration as a time span such as "5m", or as seconds since the epoch. */
  expiresAt?: string | number;
  /** Issue time in seconds since the epoch. The default is now. */
  issuedAt?: number;
}

export interface AccessKeys {
  keySet: JWTVerifyGetKey;
  sign: (options?: TokenOptions) => Promise<string>;
}

export async function createAccessKeys(): Promise<AccessKeys> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const sign = (options: TokenOptions = {}) =>
    new SignJWT(options.email === null ? {} : { email: options.email ?? VIEWER_EMAIL })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(options.issuer ?? TEAM_DOMAIN)
      .setAudience(options.audience ?? AUD)
      .setIssuedAt(options.issuedAt)
      .setExpirationTime(options.expiresAt ?? "5m")
      .sign(privateKey);
  return { keySet, sign };
}
