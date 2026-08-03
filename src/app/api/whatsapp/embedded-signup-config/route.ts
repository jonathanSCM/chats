import { NextResponse } from "next/server";
import { auth } from "@/server/auth";

// Config pública (App ID + config_id de Embedded Signup) que el cliente
// necesita para inicializar el SDK de Facebook. Se sirve en runtime en vez
// de venir "horneada" en el bundle (NEXT_PUBLIC_) para que se pueda
// configurar/cambiar desde Coolify sin tener que rehacer el build.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const appId = process.env.WHATSAPP_APP_ID ?? null;
  const configId = process.env.WHATSAPP_CONFIG_ID ?? null;

  return NextResponse.json({ appId, configId });
}
