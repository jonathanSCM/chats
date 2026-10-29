import { cn } from "@/lib/utils";

// Ícono de marca: el rayo de la app, como tile cuadrado redondeado.
export function LogoMark({ className, size = 22, src = "/logo-mark.png" }: { className?: string; size?: number; src?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
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
  brandName,
  logoSrc,
}: {
  size?: keyof typeof wordmarkSizes;
  className?: string;
  /** Marca propia de la organización (si su plan la permite); sin esto, la de la plataforma. */
  brandName?: string | null;
  logoSrc?: string | null;
  /** Sobre el menú lateral oscuro: texto blanco y sin nombre cuando el menú está contraído. */
  onDark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark size={markSizes[size]} src={logoSrc ?? undefined} />
      <span className={cn("font-bold tracking-tight", onDark ? "nav-label text-white" : "text-ink", wordmarkSizes[size])}>
        {brandName ?? "WhatsApp ProShop"}
      </span>
    </span>
  );
}
