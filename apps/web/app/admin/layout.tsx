import type { Metadata } from "next";
import type { ReactNode } from "react";

// Everything under /admin is rendered per request, never cached, never indexed. (proxy.ts adds the no-store header.)
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
