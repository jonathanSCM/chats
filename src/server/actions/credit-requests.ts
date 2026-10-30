"use server";

import { revalidatePath } from "next/cache";
import { requireSession, HttpError } from "@/server/auth/guards";
import { approveRequest, createRequest, rejectRequest } from "@/server/services/credit-requests";
import type { ActionState } from "./types";

async function requireOwner() {
  const session = await requireSession();
  const organizationId = session.user.organizationId;
  if (session.user.role !== "OWNER" || !organizationId) {
    throw new HttpError(403, "Solo el administrador de la organización puede hacer esto");
  }
  return { userId: session.user.id, organizationId };
}

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

/** El dueño pide más créditos de IA. Le llega al superadmin como solicitud pendiente. */
export async function requestCreditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, organizationId } = await requireOwner();
  const raw = String(formData.get("credits") ?? "").replace(/[\s.]/g, "");
  const credits = raw === "" ? null : Number(raw);
  const result = await createRequest({
    organizationId,
    userId,
    kind: "CREDITS",
    credits: credits !== null && Number.isFinite(credits) ? credits : null,
    note: String(formData.get("note") ?? ""),
  });
  if ("error" in result) return { error: result.error };
  revalidatePath("/dashboard/organization");
  revalidatePath("/admin", "layout");
  return { error: null, message: "Solicitud enviada. Verás los créditos en tu panel cuando se carguen." };
}

/** El dueño pide renovar su plan. */
export async function requestRenewalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { userId, organizationId } = await requireOwner();
  const result = await createRequest({ organizationId, userId, kind: "RENEWAL", note: String(formData.get("note") ?? "") });
  if ("error" in result) return { error: result.error };
  revalidatePath("/dashboard/organization");
  revalidatePath("/admin", "layout");
  return { error: null, message: "Solicitud de renovación enviada." };
}

export async function approveRequestAction(requestId: string): Promise<ActionState> {
  const session = await requireSuperadmin();
  const result = await approveRequest(requestId, session.user.id);
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
  return { error: null, message: result.message };
}

export async function rejectRequestAction(requestId: string, note: string): Promise<ActionState> {
  const session = await requireSuperadmin();
  const result = await rejectRequest(requestId, session.user.id, note);
  if ("error" in result) return { error: result.error };
  revalidatePath("/admin", "layout");
  return { error: null, message: "Solicitud rechazada." };
}
