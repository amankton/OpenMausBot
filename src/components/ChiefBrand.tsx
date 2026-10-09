import { cn } from "@/lib/cn";

/** Owner-supplied marks; CSS follows the application's active skin. */
export function ChiefBrand({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) return <img src="/brand/chief-avatar-ink.svg" alt="Chief Executive Suite" className={cn("size-8 object-contain", className)} />;
  return <span className={cn("chief-wordmark inline-flex", className)}>
    <img className="chief-on-dark h-full w-full object-contain" src="/brand/chief-lockup-full-color-on-ink.svg" alt="Chief Executive Suite" />
    <img className="chief-on-light h-full w-full object-contain" src="/brand/chief-lockup-full-color-on-light.svg" alt="Chief Executive Suite" />
  </span>;
}
