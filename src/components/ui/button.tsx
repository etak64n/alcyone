// The button of the app, in the way of shadcn/ui: one component with variants and sizes.
// asChild renders the look on its child instead, such as a link that looks like a button.

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm font-semibold whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none pointer-coarse:min-h-11 pointer-coarse:min-w-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The button of most actions: white, with a line of 1px drawn by a shadow. A disabled one keeps its line.
        secondary: "bg-surface text-control shadow-[0_0_0_1px_var(--theme-border)] hover:bg-surface-subdued disabled:text-subdued",
        // The one most important action of a screen.
        primary: "bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-50",
        // Buttons without a line, such as the menu button and the actions in a row.
        ghost: "text-control hover:bg-surface-hover disabled:text-subdued",
        // An action that cannot be undone, in the dialog that asks first.
        danger: "bg-critical text-on-accent hover:opacity-90 disabled:opacity-50",
      },
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-7 px-2 text-sm",
        lg: "h-9 px-3 text-sm",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      data-slot="button"
      // A button outside a form does nothing on its own, so it is never a submit button unless asked.
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
