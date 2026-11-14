import "@fontsource-variable/inter";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Search } from "lucide-react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { ReactNode } from "react";
import "./globals.css";
import { MainNav } from "./main-nav";
import { Offline } from "./offline-notice";
import { SITE_NAME, SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: "Texas six-man football: scores, rankings, playoffs, standings and every state championship.",
  // Share cards and canonical links use the public address, whichever host served the page.
  metadataBase: new URL(SITE_URL),
};

export const viewport: Viewport = { themeColor: "#0a2a5e" };

// The headings' font (Barlow Condensed, OFL), the same files @fontsource ships, loaded by Next so each page preloads
// them from its <head> and sizes the fallback to match. Through @fontsource's CSS the browser found them only after
// the stylesheet, and a program page's name heading, its largest paint, waited on that (Lighthouse LCP up to 3.2 s).
const barlow = localFont({
  src: [
    { path: "../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2", weight: "600" },
    { path: "../node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-barlow",
  display: "swap",
});

const SECTIONS = [
  { href: "/scores", label: "Scores" },
  { href: "/playoffs", label: "Playoffs" },
  { href: "/programs", label: "Programs" },
  { href: "/rankings", label: "Rankings" },
  { href: "/results", label: "Results" },
  { href: "/standings", label: "Standings" },
  { href: "/championships", label: "Championships" },
  { href: "/records", label: "Records" },
  { href: "/search", label: "Search" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={barlow.variable}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <Offline>
          {/* First stop for a keyboard or screen reader: past the header's links to the page itself. Out of sight until focused. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:bg-white focus:px-4 focus:font-bold focus:text-navy focus:outline-2 focus:outline-navy"
          >
            Skip to content
          </a>
          <header className="border-b-4 border-red bg-navy text-white">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between px-4">
              <Link href="/" className="inline-flex min-h-11 items-center font-num text-[26px] font-bold tracking-wide sm:min-h-12">
                {SITE_NAME}
              </Link>
              {/* A fan's quickest way to a team: on a phone the nav below scrolls and Search is its last stop, so the header
                  carries it too, always in view. From `sm` up the whole nav shows. */}
              <Link href="/search" aria-label="Search" className="inline-flex size-11 items-center justify-center hover:text-white sm:hidden">
                <Search aria-hidden="true" className="size-6" strokeWidth={2.5} />
              </Link>
              {/* On a phone the sections scroll sideways; the right edge fades out to show there is more, and the footer lists them all. */}
              <MainNav sections={SECTIONS} />
            </div>
          </header>
          <main id="main" tabIndex={-1} className="mx-auto outline-none w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">{children}</main>
          <footer className="mt-10 border-t-4 border-red bg-navy text-white">
            <div className="mx-auto max-w-5xl px-4 py-6">
              <p className="font-num text-[22px] font-bold tracking-wide">{SITE_NAME}</p>
              <nav aria-label="Site sections" className="mt-2 grid grid-cols-2 gap-x-4 sm:grid-cols-5">
                {[...SECTIONS, { href: "/matchup", label: "Matchup" }].map((s) => (
                  <Link key={s.href} href={s.href} className="inline-flex min-h-11 items-center text-[15px] text-white/85 hover:text-white hover:underline">
                    {s.label}
                  </Link>
                ))}
              </nav>
              <p className="mt-3 max-w-prose text-[13px] text-white/75">
                Ratings, projected margins and chances to win are estimates. Scores may be corrected if a mistake is found.
              </p>
            </div>
          </footer>
        </Offline>
        {/* Vercel Web Analytics and Speed Insights: cookieless page views and real visitors' load times, no personal
            data. Built in only on Vercel (VERCEL=1), which serves their same-origin /_vercel/ scripts; elsewhere
            (CI's next start) the scripts would 404. */}
        {process.env.VERCEL && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}
