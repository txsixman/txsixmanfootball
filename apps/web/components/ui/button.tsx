import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

// shadcn/ui Button (MIT), on the site's colors (globals.css maps its tokens). Every size is at least 44px tall. A className is
// appended as it is, not merged with tailwind-merge (about 10 KB sent on every page with a button, ADR 0100): a class that must
// beat one of these is a variant here (`danger`, `wrap`), not an override.
const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 text-[15px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-accent-foreground bg-background text-accent-foreground hover:bg-accent",
        ghost: "text-accent-foreground hover:bg-accent",
        danger: "bg-alert text-white hover:bg-alert/90",
      },
      size: {
        default: "px-4",
        icon: "w-11",
      },
      // Text that may wrap (a long school name in a follow button); the default keeps a label on one line.
      wrap: {
        true: "whitespace-normal",
        false: "whitespace-nowrap",
      },
    },
    defaultVariants: { variant: "default", size: "default", wrap: false },
  },
);

export function Button({
  className,
  variant,
  size,
  wrap,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={buttonVariants({ variant, size, wrap, className })} {...props} />;
}
