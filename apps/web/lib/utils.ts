import { clsx, type ClassValue } from "clsx";

/** shadcn/ui's class joiner. It no longer merges conflicting Tailwind classes (tailwind-merge was about 10 KB sent on every page with a
 * button or field, ADR 0100): the components name every override as a prop or variant instead. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
