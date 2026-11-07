import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run in Node.js. The Worker tests use an in-memory bucket and in-memory stand-ins
// for the Durable Objects, so they need no Cloudflare account. The Durable Objects import
// their base class from the module of the Workers runtime, which a stand-in replaces.
export default defineConfig({
  resolve: {
    alias: { "cloudflare:workers": fileURLToPath(new URL("./test/support/cloudflare-workers.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
