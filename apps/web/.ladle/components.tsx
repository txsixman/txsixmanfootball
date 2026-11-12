import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "../app/globals.css";

/** Every story gets the site's fonts, colors and page background. */
// Typed here, not from @ladle/react: its types ship as .tsx files that fail the site's typecheck.
export const Provider = ({ children }: { children: ReactNode }) => <div className="min-h-screen bg-page p-4 font-sans text-ink">{children}</div>;
