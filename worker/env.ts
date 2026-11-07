// Bindings that cloudflare.config.ts gives the Worker and its Durable Objects.

import type { DirectoryRpc, RoomRpc } from "./rpc.ts";

/** The static assets of the browser app, the part of the Workers API that alcyone uses. */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  /** The browser app. The Worker returns its pages with the headers of security-headers.ts. */
  ASSETS: AssetsBinding;
  /** One BoardRoom for each board, by the ID of the board. */
  ROOMS: DurableObjectNamespace<RoomRpc>;
  /** The one BoardDirectory, under the name DIRECTORY_NAME. */
  DIRECTORY: DurableObjectNamespace<DirectoryRpc>;
  AUTH_MODE: string;
  /** Bound only in the "cloudflare-access" mode. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The AUD tag of the Access application, which `pnpm stack:deploy` uploads as a secret. */
  ACCESS_AUD?: string;
  /** JSON list of the lowercase emails of admins. */
  ADMIN_EMAILS: string;
  /** Only under `cf dev`: the email that the Worker signs in, because Access does not run there. */
  LOCAL_USER_EMAIL?: string;
  /** "s3" for S3-compatible storage, or "local-r2" for the local bucket of `cf dev`. */
  STORAGE_TYPE: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_URL_STYLE?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  /** Only with "local-r2". */
  LOCAL_BUCKET?: R2Bucket;
}
