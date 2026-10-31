/**
 * Cómo se distinguen en Google Calendar los eventos creados por ProShop: un color propio
 * (Pavo real, el azul turquesa de Google) y una propiedad privada para poder filtrarlos
 * por API. Solo se aplica al crear; los eventos que ya existen no se tocan.
 */
export const PROSHOP_EVENT_COLOR_ID = "7";

export function proshopEventStyle() {
  return {
    colorId: PROSHOP_EVENT_COLOR_ID,
    extendedProperties: { private: { proshop: "1" } },
  };
}
