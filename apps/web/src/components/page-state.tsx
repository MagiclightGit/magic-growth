import type { ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

export function Loading() {
  return (
    <div
      className="flex min-h-36 items-center justify-center gap-2 text-[13px] text-muted-foreground"
      role="status"
    >
      <LoaderCircle className="size-4 animate-spin text-primary" />
      正在加载…
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-destructive/25 bg-status-danger-bg/50 p-4"
      role="alert"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-status-danger-fg">
        <AlertCircle className="size-4 shrink-0" />
        加载遇到问题
      </div>
      <p className="mt-1.5 mb-3 text-[13px] text-muted-foreground">
        {error.message}
      </p>
      {retry && (
        <Button size="sm" variant="outline" onClick={retry}>
          重新加载
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card px-5 py-10 text-center">
      <div className="mb-3 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Inbox className="size-4" />
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="mt-1 mb-4 max-w-md text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      {action}
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}

export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-3 flex flex-col gap-2.5 rounded-lg border bg-card p-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
