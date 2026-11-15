import type { MetadataRoute } from "next";
import { SITE_NAME } from "../lib/site";

// Lets a phone add the site to its home screen and open it full screen, like an app (ADR 0001: a PWA).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "TX Six-Man",
    description: "Scores, rankings, standings and every State Championship.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0a2a5e",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
