"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/guards";
import { disconnectGoogleCalendar } from "@/server/services/google-calendar-user";
import type { ActionState } from "./types";

export async function disconnectGoogleCalendarAction(): Promise<ActionState> {
  const session = await requireSession();
  await disconnectGoogleCalendar(session.user.id);
  revalidatePath("/dashboard/perfil");
  return { error: null, message: "Google Calendar desconectado." };
}
