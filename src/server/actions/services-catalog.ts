"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import type { ActionState } from "./types";

const PATH = "/dashboard/organization";

async function requireOwner() {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    throw new Error("Solo el dueño de la organización puede cambiar esto");
  }
  return session.user.organizationId;
}

const labelSchema = z.object({ label: z.string().trim().min(1, "Requerido").max(40) });

export async function createServiceAction(label: string): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const parsed = labelSchema.safeParse({ label });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const services = await prisma.service.findMany({ where: { organizationId }, select: { order: true } });
  const nextOrder = services.length ? Math.max(...services.map((s) => s.order)) + 1 : 0;

  await prisma.service.create({ data: { organizationId, label: parsed.data.label, order: nextOrder } });

  revalidatePath(PATH);
  return { error: null };
}

async function getOwnedService(organizationId: string, serviceId: string) {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || service.organizationId !== organizationId) return null;
  return service;
}

export async function renameServiceAction(serviceId: string, label: string): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const parsed = labelSchema.safeParse({ label });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const service = await getOwnedService(organizationId, serviceId);
  if (!service) return { error: "Servicio no encontrado" };

  await prisma.service.update({ where: { id: serviceId }, data: { label: parsed.data.label } });

  revalidatePath(PATH);
  return { error: null };
}

/** Intercambia el orden con el vecino -- mismo mecanismo que movePipelineStageAction. */
export async function moveServiceAction(serviceId: string, direction: "up" | "down"): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const services = await prisma.service.findMany({ where: { organizationId }, orderBy: { order: "asc" } });
  const index = services.findIndex((s) => s.id === serviceId);
  if (index === -1) return { error: "Servicio no encontrado" };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= services.length) return { error: null };

  const a = services[index];
  const b = services[swapIndex];
  await prisma.$transaction([
    prisma.service.update({ where: { id: a.id }, data: { order: -1 } }),
    prisma.service.update({ where: { id: b.id }, data: { order: a.order } }),
    prisma.service.update({ where: { id: a.id }, data: { order: b.order } }),
  ]);

  revalidatePath(PATH);
  return { error: null };
}

/**
 * A diferencia de las etapas del pipeline, borrar un servicio no exige
 * reasignar nada: Opportunity.serviceInterest es texto libre, no una
 * relación -- las oportunidades que ya tenían este valor lo conservan tal
 * cual (se muestran igual, solo dejan de aparecer como opción para
 * elegir de nuevo).
 */
export async function deleteServiceAction(serviceId: string): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const service = await getOwnedService(organizationId, serviceId);
  if (!service) return { error: "Servicio no encontrado" };

  await prisma.service.delete({ where: { id: serviceId } });

  revalidatePath(PATH);
  return { error: null };
}
