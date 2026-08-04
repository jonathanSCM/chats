import { NextResponse } from "next/server";
import { auth } from "@/server/auth";

// La llave pública VAPID no es secreta (el navegador la necesita para
// suscribirse), pero se sirve en runtime para poder configurarla desde
// Coolify sin rehacer el build.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}
