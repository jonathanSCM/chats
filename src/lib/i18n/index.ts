/**
 * Idiomas de la interfaz. El texto fuente es el español: `t("Guardar")` devuelve la traducción si existe en el diccionario
 * del idioma activo y, si falta, el mismo texto en español. Así una pantalla sin traducir sigue funcionando y se puede ir
 * traduciendo de a poco. Los datos variables van con llaves: t("Hola, {name}", { name }).
 */
export type Locale = "es" | "en";

export const LOCALES: readonly Locale[] = ["es", "en"];
export const DEFAULT_LOCALE: Locale = "es";
export const LOCALE_COOKIE = "lang";

export type Dictionary = Readonly<Record<string, string>>;

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : DEFAULT_LOCALE;
}

export function translate(dictionary: Dictionary, text: string, vars?: Record<string, string | number>): string {
  const translated = dictionary[text] ?? text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
