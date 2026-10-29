"use client";

import { useActionState, useState } from "react";
import { updateBrandAction } from "@/server/actions/brand";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function BrandForm({
  brandName,
  assistantName,
  brandColor,
  logoPath,
}: {
  brandName: string;
  assistantName: string;
  brandColor: string;
  logoPath: string | null;
}) {
  const [state, formAction, isPending] = useActionState(updateBrandAction, { error: null });
  const [color, setColor] = useState(brandColor);

  return (
    <form action={formAction} className="space-y-4" key={`${brandName}-${assistantName}-${brandColor}-${logoPath}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="brandName">Nombre de tu marca</Label>
          <Input id="brandName" name="brandName" defaultValue={brandName} maxLength={60} placeholder="Ej. Acme Financiera" />
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
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoPath} alt="Logo actual" className="h-10 w-10 rounded-md border border-border object-contain" />
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" name="removeLogo" className="h-4 w-4" /> Quitar el logo
            </label>
          </div>
        )}
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="block w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:text-ink"
        />
        <p className="text-xs text-ink-faint">PNG, JPG o WebP, cuadrado de preferencia, hasta 400 KB.</p>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar marca"}
      </Button>
    </form>
  );
}
