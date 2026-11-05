import { cookies } from "next/headers";
import { en } from "./en";
import { LOCALE_COOKIE, normalizeLocale, translate, type Dictionary, type Locale } from "./index";

export const dictionaries: Record<Locale, Dictionary> = { es: {}, en };

/** Idioma elegido por la persona (cookie), o el español por defecto. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

/** Para componentes de servidor: `const t = await getT(); t("Guardar")`. */
export async function getT() {
  const locale = await getLocale();
  const dictionary = dictionaries[locale];
  return (text: string, vars?: Record<string, string | number>) => translate(dictionary, text, vars);
}
