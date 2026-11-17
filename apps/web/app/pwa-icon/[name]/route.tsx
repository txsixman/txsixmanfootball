import { ImageResponse } from "next/og";
import { Mark } from "../../mark";

// The two home-screen icons beside /icon (512, any purpose) that a phone wants to install the site (app/manifest.ts): 192 for the
// launcher and a maskable 512, drawn with the mark well inside the circle or squircle a phone cuts out of it.
export const dynamic = "force-static";
export const dynamicParams = false;
export const generateStaticParams = () => [{ name: "192" }, { name: "maskable" }];

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const size = name === "192" ? 192 : 512;
  return new ImageResponse(name === "maskable" ? <Mark size={size} inset={0.1} /> : <Mark size={size} />, { width: size, height: size });
}
