import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotAccess } from "@/server/auth/guards";
import { toErrorResponse } from "@/server/http/errors";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  price: z.number().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
) {
  try {
    const { botId } = await params;
    await requireBotAccess(botId);
    const items = await prisma.catalogItem.findMany({
      where: { botId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(items);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
) {
  try {
    const { botId } = await params;
    await requireBotAccess(botId);
    const body = createSchema.parse(await req.json());

    const item = await prisma.catalogItem.create({
      data: { botId, ...body },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
