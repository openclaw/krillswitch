import * as SelectPrimitive from "@radix-ui/react-select";
import type { ComponentProps } from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/brand";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      // oc-select carries the control box (size, border, background, focus and
      // disabled states); only layout and Radix-specific bits stay here,
      // because Radix renders its own chevron rather than the native one.
      className={cn(
        "oc-select select-trigger",
        "inline-flex cursor-pointer items-center justify-between gap-2",
        "data-[placeholder]:text-muted-foreground",
        "disabled:cursor-not-allowed",
        "[&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 shrink-0 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        className={cn(
          "relative z-50 max-h-[var(--radix-select-content-available-height)] min-w-[8rem] overflow-y-auto",
          "rounded-md border border-border bg-popover p-[5px] text-popover-foreground",
          "shadow-[var(--shadow-pop)]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  description,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item> & { description?: string }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-pointer select-none items-start rounded-sm py-1 pl-2 pr-8 text-[13px] outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 top-[8px] flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-[var(--accent-text)]" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex flex-col gap-0.5">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description && (
          <span className="text-[12px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </SelectPrimitive.Item>
  );
}
