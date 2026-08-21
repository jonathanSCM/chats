import { NextResponse } from "next/server";

// TEMPORAL: solo para confirmar que Sentry captura errores del servidor.
// Borrar este archivo (y la carpeta sentry-example-page) una vez verificado.
export async function GET() {
  throw new Error("Sentry test error (servidor) — borrar esta ruta después de verificar");
  // eslint-disable-next-line no-unreachable
  return NextResponse.json({ ok: true });
}
