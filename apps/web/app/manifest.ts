import type { MetadataRoute } from "next";
import { SITE_NAME } from "../lib/site";

// Lets a phone add the site to its home screen and open it full screen, like an app (ADR 0001: a PWA). It opens on the scoreboard,
// the page a fan wants on a game night, and the worker keeps that page for no signal (ADR 0096).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/scores",
    name: SITE_NAME,
    short_name: "TX Six-Man",
    description: "Scores, rankings, standings and every State Championship.",
    lang: "en-US",
    start_url: "/scores",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    categories: ["sports", "news"],
    background_color: "#ffffff",
    theme_color: "#0a2a5e",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Tonight's games", short_name: "Tonight", url: "/scores/tonight" },
      { name: "Playoff brackets", short_name: "Playoffs", url: "/playoffs" },
    ],
  };
}
