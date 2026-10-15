import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

// Adapted from shadcn/ui's new-york primitives (github.com/shadcn-ui/ui); use a native select instead of Radix to keep the mobile picker accessible with minimal dependencies.
export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-wrap">
      <select data-slot="select" className={cn('flex h-9 w-full appearance-none items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50', className)} {...props}>
        {children}
      </select>
    </span>
  );
}
