import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/guards";
import { buildGoogleCalendarAuthUrl, isGoogleCalendarOAuthEnabled } from "@/server/services/google-calendar-user";

/** Botón "Conectar mi Google Calendar" en Mi Perfil -- redirige al consentimiento de Google. */
export async function GET() {
  if (!isGoogleCalendarOAuthEnabled()) {
    return new NextResponse("Google Calendar no está configurado en el servidor.", { status: 500 });
  }
  const session = await requireSession();
  const url = buildGoogleCalendarAuthUrl(session.user.id);
  return NextResponse.redirect(url);
}
