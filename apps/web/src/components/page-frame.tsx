import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Content shell with Cloudflare-style max-width guide rails.
 * Vertical lines mark the content edges; optional crosses sit on section rules.
 */
export function PageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative mx-auto w-full max-w-6xl", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-px bg-redop-grid sm:block"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-px bg-redop-grid sm:block"
      />
      {children}
    </div>
  );
}

export function FrameRule({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div className="h-px w-full bg-redop-grid" />
      <span
        aria-hidden
        className="absolute top-1/2 left-0 hidden -translate-x-1/2 -translate-y-1/2 font-mono text-[11px] text-redop-ink/35 sm:inline"
      >
        +
      </span>
      <span
        aria-hidden
        className="absolute top-1/2 right-0 hidden translate-x-1/2 -translate-y-1/2 font-mono text-[11px] text-redop-ink/35 sm:inline"
      >
        +
      </span>
    </div>
  );
}
