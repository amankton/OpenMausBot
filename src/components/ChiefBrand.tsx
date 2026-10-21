import { cn } from "@/lib/cn";

/** Owner-supplied marks; CSS follows the application's active skin. */
export function ChiefBrand({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) return <span className={cn("chief-wordmark inline-flex size-8", className)}>
    <img className="chief-on-dark h-full w-full object-contain" src="/brand/chief-avatar-ink.svg" alt="Chief Executive Suite" />
    <img className="chief-on-light h-full w-full object-contain" src="/brand/chief-mark-full-color-on-light.svg" alt="Chief Executive Suite" />
  </span>;
  return <span className={cn("chief-wordmark inline-flex", className)}>
    <img className="chief-on-dark h-full w-full object-contain" src="/brand/chief-lockup-full-color-on-ink.svg" alt="Chief Executive Suite" />
    <img className="chief-on-light h-full w-full object-contain" src="/brand/chief-lockup-full-color-on-light.svg" alt="Chief Executive Suite" />
  </span>;
}
