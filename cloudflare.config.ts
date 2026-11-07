// Worker configuration that the Cloudflare CLI (cf) reads.
//
// The values come from alcyone.config.ts, so a deployment does not edit this
// file. `cf dev` runs in the "development" mode: it uses the development
// storage and answers localhost without Cloudflare Access. `cf build` and
// `pnpm stack:deploy`, which runs `cf deploy`, use the "production" mode.
// Commands that only call the Cloudflare API load this file without a mode and
// read the production settings, which name the account.

import { bindings, defineConfig, exports } from "cf/config";
import alcyoneConfig from "./alcyone.config.ts";
import { validateSettings, type StorageSettings } from "./config/settings.ts";

// The bucket that `cf dev` keeps on this machine for the "local-r2" development storage.
const LOCAL_BUCKET = "alcyone-local";

export default defineConfig(({ mode }) => {
  const settings = validateSettings(alcyoneConfig);
  if (mode !== undefined && mode !== "development" && mode !== "production") {
    throw new Error(`alcyone runs in the "development" or "production" mode, not "${mode}".`);
  }
  const isDevelopment = mode === "development";
  const storage: StorageSettings = isDevelopment ? settings.development.storage : settings.production.storage;

  return {
    accountId: settings.accountId,
    worker: {
      name: settings.workerName,
      entrypoint: "./worker/index.ts",
      compatibilityDate: "2026-11-01",
      domains: [settings.production.domain],
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
      // The browser app is static assets. A deployment runs the Worker for /api/* and
      // for the pages, which it returns with the security headers of
      // worker/security-headers.ts; the built files under /assets/ skip the Worker.
      // Under `cf dev`, only /api/* runs the Worker: the dev server of Vite puts inline
      // scripts into its pages, which the Content-Security-Policy would block.
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: isDevelopment ? ["/api/*"] : ["/*", "!/assets/*"],
      },
      // One BoardRoom for each board holds the board while people edit it, and one
      // BoardDirectory keeps the list of boards. Both keep their data in the bucket.
      exports: {
        BoardRoom: exports.durableObject({ storage: "sqlite" }),
        BoardDirectory: exports.durableObject({ storage: "sqlite" }),
      },
      env: {
        // The Worker reads the pages from here.
        ASSETS: bindings.assets(),
        ROOMS: bindings.durableObject({ worker: settings.workerName, exportName: "BoardRoom" }),
        DIRECTORY: bindings.durableObject({ worker: settings.workerName, exportName: "BoardDirectory" }),
        // "local-development" lets the Worker answer localhost without an Access token.
        AUTH_MODE: bindings.text(isDevelopment ? "local-development" : "cloudflare-access"),
        ...(isDevelopment
          ? {}
          : {
            // The team domain of the Zero Trust organization of the account, which
            // `pnpm stack:deploy` reads from Cloudflare.
            ACCESS_TEAM_DOMAIN: bindings.secret(),
            // The AUD tag of the Access application that `pnpm stack:deploy` creates for the domain.
            ACCESS_AUD: bindings.secret(),
          }),
        // A JSON list, so that a deployment without admins still has the binding.
        ADMIN_EMAILS: bindings.text(JSON.stringify(settings.admins)),
        // Access does not run under `cf dev`, so the Worker signs in this email instead.
        ...(isDevelopment ? { LOCAL_USER_EMAIL: bindings.text(settings.development.signInAs) } : {}),
        ...(storage.type === "s3"
          ? {
            STORAGE_TYPE: bindings.text("s3"),
            S3_ENDPOINT: bindings.text(storage.endpoint),
            S3_REGION: bindings.text(storage.region),
            S3_BUCKET: bindings.text(storage.bucket),
            S3_URL_STYLE: bindings.text(storage.urlStyle),
            // Secrets: .env for `cf dev`, and .env.production, which `pnpm stack:deploy` uploads.
            S3_ACCESS_KEY_ID: bindings.secret(),
            S3_SECRET_ACCESS_KEY: bindings.secret(),
          }
          : {
            // Only `cf dev` uses this storage, through the R2 binding of the local bucket.
            STORAGE_TYPE: bindings.text("local-r2"),
            LOCAL_BUCKET: bindings.r2({ name: LOCAL_BUCKET }),
          }),
      },
    },
  };
});
