import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Input (MIT), on the site's colors. */
/** `accent`: the field sits on the accent tint instead of the page color (a class that replaces another is a prop, not an override, ADR 0100). */
export function Input({ className, type, accent = false, ...props }: ComponentProps<"input"> & { accent?: boolean }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-11 w-full min-w-0 border border-input px-3 text-[16px] text-foreground placeholder:text-muted outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        accent ? "bg-accent" : "bg-background",
        className,
      )}
      {...props}
    />
  );
}
