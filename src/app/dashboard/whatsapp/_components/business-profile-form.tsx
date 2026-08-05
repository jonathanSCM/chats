"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Camera, Loader2 } from "lucide-react";
import {
  updateBusinessProfileAction,
  updateBusinessPhotoAction,
} from "@/server/actions/business-profile";
import { BUSINESS_VERTICALS } from "@/lib/business-verticals";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

export interface BusinessProfileData {
  about: string;
  description: string;
  address: string;
  email: string;
  websites: string[];
  vertical: string;
  profilePictureUrl: string | null;
}

export function BusinessProfileForm({
  botId,
  profile,
}: {
  botId: string;
  profile: BusinessProfileData;
}) {
  const action = updateBusinessProfileAction.bind(null, botId);
  const [state, formAction, isPending] = useActionState(action, { error: null });

  return (
    <Card className="max-w-xl space-y-5">
      <div>
        <CardTitle className="text-sm">Perfil de WhatsApp</CardTitle>
        <CardDescription>
          Lo que ve el cliente al abrir el chat: foto, descripción y datos de contacto del
          negocio.
        </CardDescription>
      </div>

      <PhotoUploader botId={botId} currentUrl={profile.profilePictureUrl} />

      <form action={formAction} className="space-y-4" key={JSON.stringify(profile)}>
        <div className="space-y-1.5">
          <Label htmlFor="about">Estado (about)</Label>
          <Input
            id="about"
            name="about"
            defaultValue={profile.about}
            maxLength={139}
            placeholder="Ej. Atendiendo tus pedidos"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="description">Descripción del negocio</Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={profile.description}
            maxLength={512}
            rows={3}
            placeholder="A qué se dedica el negocio, en pocas líneas"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address">Dirección</Label>
          <Input id="address" name="address" defaultValue={profile.address} maxLength={256} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Correo de contacto</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={profile.email}
            maxLength={128}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="website1">Sitio web 1</Label>
            <Input
              id="website1"
              name="website1"
              type="url"
              defaultValue={profile.websites[0] ?? ""}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website2">Sitio web 2</Label>
            <Input
              id="website2"
              name="website2"
              type="url"
              defaultValue={profile.websites[1] ?? ""}
              placeholder="https://…"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="vertical">Categoría</Label>
          <Select id="vertical" name="vertical" defaultValue={profile.vertical}>
            {BUSINESS_VERTICALS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>

        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}

        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar perfil"}
        </Button>
      </form>
    </Card>
  );
}

function PhotoUploader({ botId, currentUrl }: { botId: string; currentUrl: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPreview(URL.createObjectURL(file));
    setError(null);

    const formData = new FormData();
    formData.append("photo", file);
    startTransition(async () => {
      const result = await updateBusinessPhotoAction(botId, formData);
      if (result.error) setError(result.error);
    });
  }

  const shown = preview ?? currentUrl;

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isPending}
        className="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2 text-ink-faint transition-opacity hover:opacity-80 disabled:opacity-50"
        title="Cambiar foto de perfil"
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="Foto de perfil de WhatsApp" className="h-full w-full object-cover" />
        ) : (
          <Camera size={20} />
        )}
        {isPending && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 size={18} className="animate-spin text-white" />
          </span>
        )}
      </button>
      <div className="space-y-1">
        <p className="text-sm text-ink">Foto de perfil</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isPending}
          className="text-xs text-accent hover:opacity-80 disabled:opacity-50"
        >
          Cambiar imagen
        </button>
        <p className="text-[11px] text-ink-faint">JPEG o PNG, hasta 5 MB.</p>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={handlePick}
      />
    </div>
  );
}
