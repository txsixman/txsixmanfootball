import { ImageResponse } from "next/og";
import { pngToIco } from "../../lib/ico";
import { Mark } from "../mark";

// Browsers, crawlers and link checkers ask for /favicon.ico without being told where the icon is (the page's own icon link says
// /icon). The same mark at 48 pixels, drawn at build time and wrapped as a one-picture .ico.
export const dynamic = "force-static";

const SIZE = 48;

export async function GET() {
  const png = new Uint8Array(await new ImageResponse(<Mark size={SIZE} />, { width: SIZE, height: SIZE }).arrayBuffer());
  return new Response(pngToIco(png, SIZE) as BodyInit, {
    headers: { "Content-Type": "image/x-icon", "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
