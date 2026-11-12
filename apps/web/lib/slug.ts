/** Twin of `slugify` in packages/db/seed.mjs: change both together, or program URLs stop matching the database. No
 * imports, so pages in the browser can use it. */
export const slugify = (name: string) =>
  name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
