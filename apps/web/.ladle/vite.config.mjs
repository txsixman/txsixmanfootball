// Vite settings for Ladle only: the site's `@/` path, and plain links in place of Next's router (stories run outside
// Next). Tailwind comes from postcss.config.mjs, as in the site.
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");

export default {
  resolve: {
    alias: {
      "@": web,
      "next/link": path.join(web, ".ladle/next-link.tsx"),
    },
  },
};
