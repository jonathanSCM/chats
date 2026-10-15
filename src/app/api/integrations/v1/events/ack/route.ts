import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/server/integrations/http";
import { integrationRoute } from "@/server/integrations/route";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ eventIds: z.array(z.string().max(200)).max(200) });

// La entrega ya se confirma con el 2xx del webhook; este endpoint existe por
// compatibilidad con integradores que prefieren confirmar explícitamente.
export const POST = integrationRoute("read", async (_ctx, req) => {
  const json = await req.json().catch(() => null);
  if (!bodySchema.safeParse(json).success) {
    throw new ApiError(422, "validation_error", "Se esperaba { eventIds: string[] } (máximo 200).");
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});
