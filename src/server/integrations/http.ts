import { NextResponse } from "next/server";

/** Error de la API v1: mismo formato siempre, `{ error, code }`, sin caché. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function errorResponse(e: ApiError): NextResponse {
  return NextResponse.json(
    { error: e.message, code: e.code },
    { status: e.status, headers: { "Cache-Control": "no-store", ...e.headers } },
  );
}

export function jsonResponse(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

// ─── Paginación por cursor (keyset) ─────────────────────────────────

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "invalid_limit", "limit debe ser un entero entre 1 y 200");
  return Math.min(n, MAX_LIMIT);
}

export function parseDate(raw: string | null, name: string): Date | null {
  if (raw === null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, "invalid_date", `${name} no es una fecha ISO válida`);
  return d;
}

export interface Cursor {
  t: Date;
  id: string;
}

export function encodeCursor(t: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: t.toISOString(), id })).toString("base64url");
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    const t = typeof parsed.t === "string" ? new Date(parsed.t) : null;
    if (!t || Number.isNaN(t.getTime()) || typeof parsed.id !== "string" || !parsed.id) throw new Error();
    return { t, id: parsed.id };
  } catch {
    throw new ApiError(400, "invalid_cursor", "cursor inválido");
  }
}

/**
 * Fragmento `where` para continuar después de `cursor` con orden (campo asc, id asc).
 * Cubre filas con el mismo timestamp sin saltarlas ni repetirlas.
 */
export function keysetAfter(field: string, cursor: Cursor | null) {
  if (!cursor) return {};
  return { OR: [{ [field]: { gt: cursor.t } }, { [field]: cursor.t, id: { gt: cursor.id } }] };
}

/** Recibe `limit + 1` filas; devuelve la página y el cursor siguiente (o null). */
export function finishPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  timeOf: (row: T) => Date,
): { data: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { data: rows, nextCursor: null };
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, nextCursor: encodeCursor(timeOf(last), last.id) };
}
