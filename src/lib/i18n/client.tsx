"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, translate, type Dictionary, type Locale } from "./index";

interface I18nValue {
  locale: Locale;
  dictionary: Dictionary;
}

const I18nContext = createContext<I18nValue>({ locale: DEFAULT_LOCALE, dictionary: {} });

/** Lo monta el layout raíz con el idioma de la persona y, si no es español, su diccionario. */
export function I18nProvider({ locale, dictionary, children }: I18nValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, dictionary }), [locale, dictionary]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/** Para componentes de cliente: `const t = useT(); t("Guardar")`. */
export function useT() {
  const { dictionary } = useContext(I18nContext);
  return (text: string, vars?: Record<string, string | number>) => translate(dictionary, text, vars);
}
