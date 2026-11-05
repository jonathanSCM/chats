"use client";

import { useActionState } from "react";
import { changeMyPasswordAction } from "@/server/actions/profile";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";

export function PasswordForm() {
  const t = useT();
  const [state, formAction, isPending] = useActionState(changeMyPasswordAction, { error: null });

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="currentPassword">{t("Contraseña actual")}</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="newPassword">{t("Contraseña nueva")}</Label>
        <Input id="newPassword" name="newPassword" type="password" minLength={8} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirmPassword">{t("Repetir contraseña nueva")}</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" minLength={8} required />
      </div>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      {state.message && !state.error && <p className="text-xs text-accent">{state.message}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? t("Guardando…") : t("Cambiar contraseña")}
      </Button>
    </form>
  );
}
