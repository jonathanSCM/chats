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

/**
 * Logo propio de una organización. No se fuerza a un cuadrado (eso aplastaba los logos anchos):
 *  - "square": conserva su proporción dentro de una caja de alto fijo (hasta 3,5 veces más ancho que alto).
 *  - "round": se recorta en círculo, centrado, llenando el círculo.
 */
export function BrandLogoImage({
  src,
  shape,
  size,
  className,
}: {
  src: string;
  shape: "square" | "round";
  size: number;
  className?: string;
}) {
  return shape === "round" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full object-cover", className)}
      style={{ width: size, height: size }}
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      height={size}
      className={cn("shrink-0 rounded-md object-contain", className)}
      style={{ height: size, width: "auto", maxWidth: size * 3.5 }}
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
  display = "both",
  logoShape = "square",
}: {
  size?: keyof typeof wordmarkSizes;
  className?: string;
  /** Marca propia de la organización (si su plan la permite); sin esto, la de la plataforma. */
  brandName?: string | null;
  logoSrc?: string | null;
  display?: "both" | "logo" | "name";
  logoShape?: "square" | "round";
  /** Sobre el menú lateral oscuro: texto blanco y sin nombre cuando el menú está contraído. */
  onDark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {logoSrc && display !== "name" ? (
        <BrandLogoImage src={logoSrc} shape={logoShape} size={markSizes[size] + (display === "logo" ? 8 : 0)} />
      ) : logoSrc ? null : (
        <LogoMark size={markSizes[size]} />
      )}
      {(display !== "logo" || !logoSrc) && (
        <span className={cn("font-bold tracking-tight", onDark ? "nav-label text-white" : "text-ink", wordmarkSizes[size])}>
          {brandName ?? "WhatsApp ProShop"}
        </span>
      )}
    </span>
  );
}
