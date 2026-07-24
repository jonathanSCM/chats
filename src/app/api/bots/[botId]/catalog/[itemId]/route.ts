import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotAccess, HttpError } from "@/server/auth/guards";
import { toErrorResponse } from "@/server/http/errors";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  active: z.boolean().optional(),
});

async function getOwnedItem(botId: string, itemId: string) {
  const item = await prisma.catalogItem.findUnique({ where: { id: itemId } });
  if (!item || item.botId !== botId) throw new HttpError(404, "Producto no encontrado");
  return item;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ botId: string; itemId: string }> },
) {
  try {
    const { botId, itemId } = await params;
    await requireBotAccess(botId);
    await getOwnedItem(botId, itemId);

    const body = updateSchema.parse(await req.json());
    const updated = await prisma.catalogItem.update({ where: { id: itemId }, data: body });

    return NextResponse.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ botId: string; itemId: string }> },
) {
  try {
    const { botId, itemId } = await params;
    await requireBotAccess(botId);
    await getOwnedItem(botId, itemId);

    await prisma.catalogItem.delete({ where: { id: itemId } });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
