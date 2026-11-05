"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALES, normalizeLocale } from "@/lib/i18n";
import type { ActionState } from "./types";

/** Guarda el idioma de la interfaz en este navegador (cookie de un año). El cliente recarga la página al terminar. */
export async function setLocaleAction(locale: string): Promise<ActionState> {
  if (!LOCALES.includes(locale as (typeof LOCALES)[number])) return { error: "Idioma no disponible" };
  const store = await cookies();
  store.set(LOCALE_COOKIE, normalizeLocale(locale), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return { error: null };
}
