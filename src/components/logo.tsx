import { cn } from "@/lib/utils";

// Ícono de marca: las mismas esquinas HUD del motivo `.corner-brackets`,
// llevadas a un isotipo — un visor enfocando un punto.
export function LogoMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      fill="none"
      className={cn("text-accent", className)}
    >
      <path d="M1 6.5V1H6.5" stroke="currentColor" strokeWidth="2" />
      <path d="M21 15.5V21H15.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="11" cy="11" r="3" fill="currentColor" />
    </svg>
  );
}

const wordmarkSizes = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

const markSizes = {
  sm: 16,
  md: 20,
  lg: 26,
};

export function Logo({
  size = "md",
  className,
}: {
  size?: keyof typeof wordmarkSizes;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark size={markSizes[size]} />
      <span className={cn("font-display font-bold tracking-tight text-ink", wordmarkSizes[size])}>
        Zócalo
      </span>
    </span>
  );
}
