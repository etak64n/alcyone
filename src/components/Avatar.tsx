import { initialsOf } from "../lib/format.ts";
import { cn } from "../lib/utils.ts";

/** The initials of a person on a circle of their color. */
export function Avatar({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white select-none", className)}
      style={{ background: color }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
