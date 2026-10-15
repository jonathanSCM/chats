import { NextResponse } from "next/server";
import { authenticateIntegration, type IntegrationContext } from "./auth";
import { ApiError, errorResponse } from "./http";
import type { IntegrationScope } from "./keys";

/**
 * Envuelve un handler de la API v1: autentica, convierte ApiError al formato
 * `{error, code}` y nunca filtra detalles internos en un 500.
 */
export function integrationRoute<P = Record<string, never>>(
  scope: IntegrationScope,
  handler: (ctx: IntegrationContext, req: Request, params: P) => Promise<NextResponse>,
) {
  return async (req: Request, routeCtx: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      const ctx = await authenticateIntegration(req, scope);
      return await handler(ctx, req, await routeCtx.params);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e);
      console.error("[integrations/v1] error inesperado:", e instanceof Error ? e.message : e);
      return errorResponse(new ApiError(500, "internal_error", "Error interno."));
    }
  };
}
