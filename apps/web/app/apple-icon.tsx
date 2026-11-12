import { ImageResponse } from "next/og";
import { Mark } from "./mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function AppleIcon() {
  return new ImageResponse(<Mark size={180} />, size);
}
