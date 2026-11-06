"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { useLocale, useT } from "@/lib/i18n/client";
import { zoneLabel } from "@/lib/timezone";

/**
 * La hora de una reunión se muestra SIEMPRE en la zona horaria de la organización (la misma en la que el bot ofrece los
 * horarios por WhatsApp), no en la del navegador de quien mira. Antes cada pantalla usaba la zona del navegador: con el
 * equipo en Bolivia (GMT-4) atendiendo clientes de Lima (GMT-5), una reunión que el cliente eligió a las 9:00 se veía a las 10:00.
 */
const OrgTimeZoneContext = createContext<string | undefined>(undefined);

export function OrgTimeZoneProvider({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  return <OrgTimeZoneContext.Provider value={timeZone}>{children}</OrgTimeZoneContext.Provider>;
}

export function useOrgTimeZone(): string | undefined {
  return useContext(OrgTimeZoneContext);
}

const subscribeNone = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Solo la hora ("09:00"), en la zona indicada. */
export function formatTimeIn(iso: string, timeZone: string | undefined, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone });
}

/**
 * Fecha y hora de una reunión en la zona de la organización. Si el navegador está en otra zona, lo dice al lado
 * ("· hora de Lima (GMT-5)") para que nadie la lea en la suya sin darse cuenta.
 */
export function MeetingWhen({ iso, year = false }: { iso: string; year?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const timeZone = useOrgTimeZone();
  // En el servidor no se conoce la zona del navegador: null hasta hidratar, así no hay diferencias entre servidor y cliente.
  const browserZone = useSyncExternalStore(subscribeNone, browserTimeZone, () => null);

  const date = new Date(iso);
  const text = date.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    ...(year ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const differs = Boolean(timeZone && browserZone && browserZone !== timeZone);
  return (
    <>
      {text}
      {differs && timeZone && <span className="text-ink-faint"> · {t("hora de {zone}", { zone: zoneLabel(timeZone, date) })}</span>}
    </>
  );
}
