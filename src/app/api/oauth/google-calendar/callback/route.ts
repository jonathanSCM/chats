import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/server/auth/guards";
import { exchangeGoogleCalendarCode } from "@/server/services/google-calendar-user";

const PROFILE_PATH = "/dashboard/perfil";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`${PROFILE_PATH}?calendarError=${encodeURIComponent(error)}`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL(`${PROFILE_PATH}?calendarError=sin_codigo`, req.url));
  }

  try {
    await exchangeGoogleCalendarCode(code, session.user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "error_desconocido";
    return NextResponse.redirect(new URL(`${PROFILE_PATH}?calendarError=${encodeURIComponent(message)}`, req.url));
  }

  return NextResponse.redirect(new URL(`${PROFILE_PATH}?calendarConnected=1`, req.url));
}
