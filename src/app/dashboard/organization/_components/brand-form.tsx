"use client";

import { useActionState, useEffect, useState } from "react";
import { updateBrandAction } from "@/server/actions/brand";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { LOGO_SCALE_MAX, LOGO_SCALE_MIN } from "@/lib/brand";

type Display = "both" | "logo" | "name";
type Shape = "square" | "round";

export function BrandForm({
  brandName,
  assistantName,
  brandColor,
  logoPath,
  brandDisplay,
  brandLogoShape,
  brandLogoScale,
}: {
  brandName: string;
  assistantName: string;
  brandColor: string;
  logoPath: string | null;
  brandDisplay: Display;
  brandLogoShape: Shape;
  brandLogoScale: number;
}) {
  const [state, formAction, isPending] = useActionState(updateBrandAction, { error: null });
  const [color, setColor] = useState(brandColor);
  const [name, setName] = useState(brandName);
  const [display, setDisplay] = useState<Display>(brandDisplay);
  const [shape, setShape] = useState<Shape>(brandLogoShape);
  const [scale, setScale] = useState(brandLogoScale);
  const [removeLogo, setRemoveLogo] = useState(false);
  // Logo recién elegido (todavía sin guardar), para verlo en la vista previa.
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    };
  }, [pickedUrl]);

  const previewSrc = pickedUrl ?? (removeLogo ? null : logoPath);

  return (
    <form
      action={formAction}
      className="space-y-4"
      key={`${brandName}-${assistantName}-${brandColor}-${logoPath}-${brandDisplay}-${brandLogoShape}-${brandLogoScale}`}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brandName">Nombre de tu marca</Label>
          <Input
            id="brandName"
            name="brandName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Ej. Acme Financiera"
          />
          <p className="text-xs text-ink-faint">Se ve en el menú, en los correos y en el saludo del bot.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assistantName">Nombre del asistente</Label>
          <Input id="assistantName" name="assistantName" defaultValue={assistantName} maxLength={40} placeholder="Ej. Lía" />
          <p className="text-xs text-ink-faint">
            Cómo se presenta el asistente en las reuniones. Vacío = &quot;Asistente de tu marca&quot;.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="brandColor">Color principal</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Elegir color"
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#7c5cff"}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
          <Input
            id="brandColor"
            name="brandColor"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#1d4ed8 (vacío = el de la plataforma)"
            className="max-w-xs font-code"
          />
        </div>
        <p className="text-xs text-ink-faint">
          Botones y detalles de la app. Debe ser un color oscuro, para que el texto blanco se lea.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="logo">Logo</Label>
        {logoPath && (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              name="removeLogo"
              checked={removeLogo}
              onChange={(e) => setRemoveLogo(e.target.checked)}
              className="h-4 w-4"
            />{" "}
            Quitar el logo actual
          </label>
        )}
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPickedUrl(file ? URL.createObjectURL(file) : null);
            if (file) setRemoveLogo(false);
          }}
          className="block w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-ink"
        />
        <p className="text-xs text-ink-faint">PNG, JPG o WebP, hasta 400 KB. Mientras más grande la imagen, más nítido se ve.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-ink">Qué mostrar en el menú</legend>
          {(
            [
              ["both", "Logo y nombre"],
              ["logo", "Solo el logo"],
              ["name", "Solo el nombre"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="brandDisplay"
                value={value}
                checked={display === value}
                onChange={() => setDisplay(value)}
                className="h-4 w-4"
              />
              {label}
            </label>
          ))}
          <p className="text-xs text-ink-faint">Sin logo cargado se muestra el nombre.</p>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-ink">Forma del logo</legend>
          {(
            [
              ["square", "Cuadrado / rectangular (se respeta su proporción)"],
              ["round", "Redondo (se recorta en círculo)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="brandLogoShape"
                value={value}
                checked={shape === value}
                onChange={() => setShape(value)}
                className="h-4 w-4"
              />
              {label}
            </label>
          ))}
          <p className="text-xs text-ink-faint">Si tu logo ya es redondo, elige &quot;Cuadrado&quot; para que no se recorte.</p>
        </fieldset>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="brandLogoScale">Tamaño del logo: {scale}%</Label>
        <input
          id="brandLogoScale"
          name="brandLogoScale"
          type="range"
          min={LOGO_SCALE_MIN}
          max={LOGO_SCALE_MAX}
          step={10}
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
          className="w-full max-w-sm cursor-pointer"
        />
        <p className="text-xs text-ink-faint">
          Si tu logo se ve muy chico en el menú, agrándalo aquí. Un logo pequeño ampliado mucho puede verse borroso:
          lo ideal es subir una imagen más grande.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">Así se verá en el menú</p>
        <div className="flex min-h-14 items-center rounded-control bg-sidebar px-3 py-2">
          <Logo onDark brandName={name || null} logoSrc={previewSrc} display={display} logoShape={shape} logoScale={scale} />
        </div>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar marca"}
      </Button>
    </form>
  );
}
