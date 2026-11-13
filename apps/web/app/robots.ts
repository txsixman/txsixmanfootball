import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

// Open to search engines since the owner's go-ahead (Nov 11, 2026). Other addresses of the same site (the vercel.app one,
// previews) send noindex instead (next.config.ts), so only SITE_URL is listed.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_URL}/sitemap.xml`, host: SITE_URL };
}
