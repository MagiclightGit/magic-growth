import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Both research entry points share the same viewport boundary. Only their content scrolls.
export function ResearchDetailFrame({
  className,
  ...props
}: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 top-16 bottom-0 z-10 flex min-h-0 flex-col gap-3 overflow-hidden bg-background p-4 lg:left-60 sm:p-5',
        className,
      )}
      {...props}
    />
  );
}
