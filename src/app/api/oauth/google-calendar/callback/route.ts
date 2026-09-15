import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/server/auth/guards";
import { exchangeGoogleCalendarCode } from "@/server/services/google-calendar-user";

const PROFILE_PATH = "/dashboard/perfil";

// NEXTAUTH_URL como base en vez de req.url -- detrás del proxy de Coolify,
// req.url a veces resuelve al origen interno del contenedor (0.0.0.0:3000)
// en vez del dominio público, y el navegador del usuario no puede resolver
// esa dirección.
function redirectTo(path: string): NextResponse {
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return redirectTo(`${PROFILE_PATH}?calendarError=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return redirectTo(`${PROFILE_PATH}?calendarError=sin_codigo`);
  }

  try {
    await exchangeGoogleCalendarCode(code, session.user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "error_desconocido";
    return redirectTo(`${PROFILE_PATH}?calendarError=${encodeURIComponent(message)}`);
  }

  return redirectTo(`${PROFILE_PATH}?calendarConnected=1`);
}
