import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge knows the sizes of Tailwind, but not the two of this app. Without them,
// it takes text-figure for a color and drops it next to a text color, or the other way.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["figure", "display"] }],
      shadow: [{ shadow: ["tooltip", "popover"] }],
    },
  },
});

/** Joins class names, and lets a later Tailwind class win over an earlier one of the same kind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
