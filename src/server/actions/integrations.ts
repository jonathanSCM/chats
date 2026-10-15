"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import { assertSafeWebhookUrl, deliverOnce } from "@/server/integrations/delivery";
import { buildEvent, INTEGRATION_EVENT_TYPES } from "@/server/integrations/events";
import { generateApiKey, isIntegrationScope } from "@/server/integrations/keys";

const PATH = "/dashboard/organization";

export interface IntegrationActionState {
  error: string | null;
  message?: string;
  /** Se muestra UNA vez: la clave o el secreto recién generados. */
  secret?: string;
}

/** Solo el Admin (OWNER) de la organización administra integraciones. */
async function requireOwner() {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    throw new Error("Solo un administrador puede gestionar integraciones.");
  }
  return { organizationId: session.user.organizationId, userId: session.user.id };
}

// ─── Claves de API ──────────────────────────────────────────────────

export async function createIntegrationKeyAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const { organizationId, userId } = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 80) return { error: "Poné un nombre de 2 a 80 caracteres." };

  const scopes = formData.getAll("scopes").map(String).filter(isIntegrationScope);
  if (scopes.length === 0) return { error: "Elegí al menos un permiso." };
  // Escribir tareas sin poder leer no tiene sentido práctico, y evita claves a medias.
  if (!scopes.includes("read")) scopes.unshift("read");

  const { key, keyHash, prefix } = generateApiKey();
  const created = await prisma.integrationKey.create({
    data: { organizationId, name, prefix, keyHash, scopes, createdById: userId },
  });
  await audit({
    entityType: "IntegrationKey",
    entityId: created.id,
    action: "create",
    userId,
    organizationId,
    after: { name, prefix, scopes },
  });

  revalidatePath(PATH);
  return { error: null, message: "Clave creada. Copiala ahora: no se vuelve a mostrar.", secret: key };
}

export async function revokeIntegrationKeyAction(keyId: string): Promise<IntegrationActionState> {
  const { organizationId, userId } = await requireOwner();

  const key = await prisma.integrationKey.findFirst({ where: { id: keyId, organizationId, revokedAt: null } });
  if (!key) return { error: "Clave no encontrada." };

  await prisma.integrationKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  await audit({
    entityType: "IntegrationKey",
    entityId: key.id,
    action: "revoke",
    userId,
    organizationId,
    before: { name: key.name, prefix: key.prefix },
  });

  revalidatePath(PATH);
  return { error: null, message: "Clave revocada." };
}

// ─── Webhook de eventos ─────────────────────────────────────────────

function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export async function saveWebhookAction(
  _prev: IntegrationActionState,
  formData: FormData,
): Promise<IntegrationActionState> {
  const { organizationId, userId } = await requireOwner();

  const url = String(formData.get("url") ?? "").trim();
  try {
    await assertSafeWebhookUrl(url);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "URL inválida." };
  }

  const known = new Set<string>(INTEGRATION_EVENT_TYPES);
  const events = formData.getAll("events").map(String).filter((e) => known.has(e));
  const enabled = formData.get("enabled") === "on";

  const existing = await prisma.integrationWebhook.findFirst({ where: { organizationId } });
  if (existing) {
    await prisma.integrationWebhook.update({ where: { id: existing.id }, data: { url, events, enabled } });
    await audit({
      entityType: "IntegrationWebhook",
      entityId: existing.id,
      action: "update",
      userId,
      organizationId,
      after: { url, events, enabled },
    });
    revalidatePath(PATH);
    return { error: null, message: "Webhook actualizado." };
  }

  const secret = newWebhookSecret();
  const created = await prisma.integrationWebhook.create({
    data: { organizationId, url, events, enabled, secretEncrypted: encrypt(secret) },
  });
  await audit({
    entityType: "IntegrationWebhook",
    entityId: created.id,
    action: "create",
    userId,
    organizationId,
    after: { url, events, enabled },
  });
  revalidatePath(PATH);
  return { error: null, message: "Webhook creado. Copiá el secreto ahora: no se vuelve a mostrar.", secret };
}

export async function rotateWebhookSecretAction(): Promise<IntegrationActionState> {
  const { organizationId, userId } = await requireOwner();
  const webhook = await prisma.integrationWebhook.findFirst({ where: { organizationId } });
  if (!webhook) return { error: "Todavía no configuraste el webhook." };

  const secret = newWebhookSecret();
  await prisma.integrationWebhook.update({ where: { id: webhook.id }, data: { secretEncrypted: encrypt(secret) } });
  await audit({ entityType: "IntegrationWebhook", entityId: webhook.id, action: "rotate_secret", userId, organizationId });

  revalidatePath(PATH);
  return { error: null, message: "Secreto rotado. Actualizalo en el receptor.", secret };
}

export async function deleteWebhookAction(): Promise<IntegrationActionState> {
  const { organizationId, userId } = await requireOwner();
  const webhook = await prisma.integrationWebhook.findFirst({ where: { organizationId } });
  if (!webhook) return { error: null };

  await prisma.integrationWebhook.delete({ where: { id: webhook.id } });
  await audit({ entityType: "IntegrationWebhook", entityId: webhook.id, action: "delete", userId, organizationId });

  revalidatePath(PATH);
  return { error: null, message: "Webhook eliminado." };
}

/** Envía un evento `ping` firmado y muestra el resultado al instante. */
export async function sendTestEventAction(): Promise<IntegrationActionState> {
  const { organizationId } = await requireOwner();
  const webhook = await prisma.integrationWebhook.findFirst({ where: { organizationId } });
  if (!webhook) return { error: "Todavía no configuraste el webhook." };

  const event = buildEvent({
    eventId: `ping_${Date.now()}`,
    type: "ping",
    organizationId,
    data: { message: "Evento de prueba del CRM" },
  });
  const result = await deliverOnce(webhook, event);

  await prisma.integrationWebhook.update({
    where: { id: webhook.id },
    data: result.ok
      ? { lastSuccessAt: new Date(), lastError: null }
      : { lastFailureAt: new Date(), lastError: result.error ?? "Falló la entrega" },
  });

  revalidatePath(PATH);
  return result.ok
    ? { error: null, message: "El destino respondió correctamente." }
    : { error: result.error ?? "El destino no respondió bien." };
}
