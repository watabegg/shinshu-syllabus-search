import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset} collisionPadding={14} className={cn('z-50 w-64 max-w-[calc(100vw-28px)] max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-md border bg-popover p-1.5 text-popover-foreground shadow-md outline-none', className)} {...props} /></PopoverPrimitive.Portal>;
}
