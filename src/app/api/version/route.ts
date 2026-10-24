import { NextResponse } from "next/server";

// Identificador de la versión desplegada (se fija al compilar). La app abierta
// lo compara con el suyo para avisar "hay una versión nueva". Es público a
// propósito: no revela nada más que un identificador.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
