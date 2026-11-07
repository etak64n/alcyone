// The documentation site of alcyone, built with Starlight. .github/workflows/docs.yml
// publishes it to GitHub Pages at https://etak64n.github.io/alcyone/.
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://etak64n.github.io",
  // GitHub Pages serves the site under the name of the repository.
  base: "/alcyone",
  integrations: [
    starlight({
      title: "alcyone",
      description: "A whiteboard for your team on Cloudflare Workers, with every board in your S3-compatible bucket.",
      logo: { src: "./src/assets/alcyone-icon.svg" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/etak64n/alcyone" }],
      editLink: { baseUrl: "https://github.com/etak64n/alcyone/edit/main/docs/" },
      sidebar: [
        { label: "Getting started", items: ["getting-started/try-locally", "getting-started/deploy"] },
        { label: "Guides", items: ["guides/boards", "guides/editing", "guides/together"] },
        { label: "Settings", items: ["settings/configuration"] },
        { label: "Internals", items: ["internals/architecture", "internals/storage"] },
        { label: "Project", items: ["project/limits", "project/development", "project/releases"] },
      ],
    }),
  ],
});
