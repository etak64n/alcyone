// A label that shows over a control while the pointer rests on it or the keyboard selects
// it, on Radix UI. The board uses it for the tools, whose buttons show icons alone.

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ label, shortcut, side = "right", children }: { label: string; shortcut?: string; side?: "top" | "right" | "bottom" | "left"; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-50 flex items-center gap-2 rounded-sm bg-surface px-2 py-1 text-xs font-semibold text-strong shadow-tooltip data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0"
        >
          {label}
          {shortcut !== undefined && <kbd className="rounded-xs bg-surface-subdued px-1 font-sans text-subdued">{shortcut}</kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
