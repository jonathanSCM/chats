import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotAccess } from "@/server/auth/guards";
import { toErrorResponse } from "@/server/http/errors";

const updateSchema = z.object({
  companyName: z.string().min(1).max(120).optional(),
  personality: z.string().max(2000).optional(),
  instructions: z.string().max(4000).optional(),
  welcomeMessage: z.string().max(1000).optional(),
  primaryColor: z.string().max(20).optional(),
  logoUrl: z.string().url().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
) {
  try {
    const { botId } = await params;
    await requireBotAccess(botId);
    const config = await prisma.botConfig.findUnique({ where: { botId } });
    return NextResponse.json(config);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ botId: string }> },
) {
  try {
    const { botId } = await params;
    await requireBotAccess(botId);

    const body = updateSchema.parse(await req.json());

    const config = await prisma.botConfig.upsert({
      where: { botId },
      create: { botId, ...body },
      update: body,
    });

    return NextResponse.json(config);
  } catch (error) {
    return toErrorResponse(error);
  }
}
