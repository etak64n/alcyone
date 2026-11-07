// A menu that opens from a button, in the way of shadcn/ui, on Radix UI. Radix moves the
// focus into the menu, lets the arrow keys walk the items, and closes it on Escape.

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex min-w-48 flex-col gap-0.5 overflow-hidden rounded-md bg-surface p-1 text-strong shadow-popover",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex min-h-7 cursor-pointer items-center gap-2 rounded-xs px-2 py-1 text-sm outline-none select-none pointer-coarse:min-h-11",
        "data-[highlighted]:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:text-subdued [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-subdued",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/**
 * An item of a menu that chooses one value. The chosen one shows on the subtle accent with
 * the accent for its text, without a check mark.
 */
export function DropdownMenuRadioItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "flex min-h-7 cursor-pointer items-center rounded-xs px-2 py-1 text-sm outline-none select-none pointer-coarse:min-h-11",
        "data-[highlighted]:bg-surface-hover data-[state=checked]:bg-accent-subtle data-[state=checked]:text-accent",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" className={cn("px-2 py-1.5", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn("-mx-1 my-1 h-px bg-hairline", className)} {...props} />;
}
