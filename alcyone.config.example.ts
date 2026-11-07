// Settings of this alcyone deployment.
//
// Copy this file to alcyone.config.ts and replace every value. Git ignores
// alcyone.config.ts. Storage access keys are secrets, so they do not go here:
// see .env.example.

import { defineAlcyoneConfig } from "./config/settings.ts";

export default defineAlcyoneConfig({
  // Cloudflare account that owns the Worker and the domain
  accountId: "0123456789abcdef0123456789abcdef",
  workerName: "alcyone",
  // People who can rename and delete every board, by the email that Cloudflare Access
  // reports. Everyone else renames and deletes only the boards that they created.
  admins: ["admin@example.com"],
  production: {
    domain: "boards.example.com",
    // The bucket that holds the boards and their images
    storage: {
      type: "s3",
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "alcyone-boards",
      urlStyle: "path",
    },
    // Cloudflare Access, which lets only these people open alcyone. pnpm stack:deploy
    // reads the team domain from the Zero Trust organization of the account.
    access: {
      // The emails that may sign in. They include every admin.
      allow: ["admin@example.com"],
      // The login methods that the sign-in page offers: "all" for every login method of your
      // Zero Trust organization, or a list of their types, such as ["passkeys", "onetimepin"]
      loginMethods: "all",
    },
  },
  // `cf dev` serves alcyone on localhost without Cloudflare Access.
  // "local-r2" keeps boards in a simulated R2 bucket on this machine and needs
  // no keys. To develop against real storage, write an "s3" storage here as in
  // production, with a bucket that holds no production boards.
  development: {
    // Cloudflare Access does not run on this machine, so cf dev signs you in as this email.
    signInAs: "admin@example.com",
    storage: {
      type: "local-r2",
    },
  },
});
