"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import { uniqueOrgSlug } from "@/lib/slugify";
import { generateToken } from "@/lib/tokens";
import { DEFAULT_PIPELINE_STAGES, DEFAULT_SERVICES } from "@/lib/pipeline";
import { sendMail } from "@/server/services/mailer";
import { inviteEmail } from "@/server/services/email-templates";
import { addMembership, removeMembership } from "@/server/services/organization-membership";
import { audit } from "@/server/services/audit";
import type { ActionState } from "./types";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días — mismo plazo que las invitaciones normales de equipo.

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

const createOrgSchema = z.object({
  companyName: z.string().min(2, "Requerido").max(120),
  ownerEmail: z.string().email("Correo inválido").optional(),
});

/**
 * Da de alta un cliente nuevo en la plataforma: crea la organización (vacía,
 * sin bots ni datos) y una invitación de OWNER — el mismo mecanismo que ya
 * usa "Invitar a alguien" dentro de una organización existente
 * (team.ts:createInviteAction / acceptInviteAction), así el dueño nuevo pone
 * su propia contraseña al aceptar, en vez de que el superadmin tenga que
 * inventarle una.
 */
export async function createOrganizationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSuperadmin();

  const parsed = createOrgSchema.safeParse({
    companyName: formData.get("companyName"),
    ownerEmail: formData.get("ownerEmail") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const slug = await uniqueOrgSlug(parsed.data.companyName);
  const { token, tokenHash } = generateToken();

  const org = await prisma.$transaction(async (tx) => {
    const newOrg = await tx.organization.create({ data: { name: parsed.data.companyName, slug } });
    // Pipeline comercial: toda organización nueva arranca con las mismas 9
    // etapas de siempre (ver DEFAULT_PIPELINE_STAGES) — configurables
    // después, pero el punto de partida es igual para todos.
    await tx.pipelineStage.createMany({
      data: DEFAULT_PIPELINE_STAGES.map((s) => ({
        organizationId: newOrg.id,
        label: s.label,
        color: s.color,
        criteria: s.criteria,
        order: s.order,
        role: s.role,
        isDefaultEntry: s.isDefaultEntry,
        requiresProposalFields: s.requiresProposalFields,
      })),
    });
    await tx.service.createMany({
      data: DEFAULT_SERVICES.map((label, order) => ({ organizationId: newOrg.id, label, order })),
    });
    await tx.organizationInvite.create({
      data: {
        organizationId: newOrg.id,
        email: parsed.data.ownerEmail,
        role: "OWNER",
        tokenHash,
        invitedById: session.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    return newOrg;
  });

  const inviteUrl = `${process.env.NEXTAUTH_URL}/invite?token=${token}`;

  if (parsed.data.ownerEmail) {
    try {
      const { subject, text, html } = inviteEmail({ orgName: org.name, inviteUrl });
      await sendMail({ to: parsed.data.ownerEmail, subject, text, html });
    } catch (error) {
      // Igual que en team.ts: un correo caído no debe tumbar la creación —
      // el link queda disponible para compartirlo a mano.
      console.error("[admin] No se pudo mandar el correo de invitación a la organización nueva:", error);
    }
  }

  await audit({
    entityType: "Organization",
    entityId: org.id,
    action: "org_created",
    userId: session.user.id,
    organizationId: org.id,
    after: { name: org.name, ownerEmail: parsed.data.ownerEmail ?? null },
  });

  revalidatePath("/admin");
  return { error: null, message: inviteUrl };
}

export async function toggleOrgSuspensionAction(
  orgId: string,
  suspended: boolean,
): Promise<ActionState> {
  const session = await requireSuperadmin();

  await prisma.organization.update({ where: { id: orgId }, data: { suspended } });
  await audit({
    entityType: "Organization",
    entityId: orgId,
    action: suspended ? "org_suspended" : "org_unsuspended",
    userId: session.user.id,
    organizationId: orgId,
  });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/admin");
  return { error: null };
}

/**
 * Borra solo la conexión de WhatsApp de un bot (token, phone_number_id,
 * waba_id) para poder volver a intentar Embedded Signup desde cero. No
 * toca la organización, el bot, sus conversaciones ni ningún otro dato.
 */
export async function disconnectWhatsAppAction(botId: string): Promise<ActionState> {
  const session = await requireSuperadmin();

  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { organizationId: true } });
  if (!bot) return { error: "Bot no encontrado" };

  await prisma.whatsAppConnection.deleteMany({ where: { botId } });
  await audit({
    entityType: "WhatsAppConnection",
    entityId: botId,
    action: "whatsapp_disconnected",
    userId: session.user.id,
    organizationId: bot.organizationId,
    after: { by: "superadmin" },
  });

  revalidatePath(`/admin/organizations/${bot.organizationId}`);
  return { error: null, message: "Conexión de WhatsApp eliminada." };
}

const roleSchema = z.enum(["OWNER", "MEMBER"]);

/** Mete a un usuario en una organización (o le cambia el rol si ya estaba). */
export async function setUserOrgRoleAction(
  userId: string,
  organizationId: string,
  role: "OWNER" | "MEMBER",
): Promise<ActionState> {
  const session = await requireSuperadmin();
  if (!roleSchema.safeParse(role).success) return { error: "Rol inválido" };

  const [user, org, existing] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
    prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    }),
  ]);
  if (!user || !org) return { error: "Usuario u organización no encontrados" };
  if (user.role === "SUPERADMIN" || user.role === "SYSTEM") {
    return { error: "Esa cuenta no pertenece a organizaciones" };
  }

  await addMembership(userId, organizationId, role);
  await audit({
    entityType: "Membership",
    entityId: userId,
    action: existing ? "member_role_changed" : "member_added",
    userId: session.user.id,
    organizationId,
    before: existing ? { role: existing.role } : undefined,
    after: { role, email: user.email, by: "superadmin" },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/organizations/${organizationId}`);
  return { error: null };
}

export async function removeUserFromOrgAction(userId: string, organizationId: string): Promise<ActionState> {
  const session = await requireSuperadmin();

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const removed = await removeMembership(userId, organizationId);
  if (!removed) return { error: "Ese usuario no es miembro de esa organización" };

  await audit({
    entityType: "Membership",
    entityId: userId,
    action: "member_removed",
    userId: session.user.id,
    organizationId,
    after: { email: user?.email ?? null, by: "superadmin" },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/organizations/${organizationId}`);
  return { error: null };
}
