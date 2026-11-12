import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Input (MIT), on the site's colors. */
export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "min-h-11 w-full min-w-0 border border-input bg-background px-3 text-[16px] text-foreground placeholder:text-muted outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
