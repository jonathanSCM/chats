import { cn } from "@/lib/utils";

// Ícono de marca: el rayo de la app, como tile cuadrado redondeado.
export function LogoMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-mark.png"
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-md", className)}
      style={{ width: size, height: size }}
    />
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
  onDark,
}: {
  size?: keyof typeof wordmarkSizes;
  className?: string;
  /** Sobre el menú lateral oscuro: texto blanco y sin nombre cuando el menú está contraído. */
  onDark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark size={markSizes[size]} />
      <span className={cn("font-bold tracking-tight", onDark ? "nav-label text-white" : "text-ink", wordmarkSizes[size])}>
        WhatsApp ProShop
      </span>
    </span>
  );
}
