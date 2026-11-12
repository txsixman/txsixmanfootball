// Ladle (MIT): the key components in each state, invented demo schools only (`npm run stories`; CI builds them with
// `npm run stories:build`, so a broken story fails; never deployed).
/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "stories/**/*.stories.tsx",
  viteConfig: ".ladle/vite.config.mjs",
  outDir: ".ladle/build",
  addons: { width: { enabled: true, options: { phone: 375, desktop: 1280 }, defaultState: 375 } },
};
