import { z } from "zod";

export const MAX_MEETING_GUESTS = 20;

/**
 * Parsea "a@x.com, b@y.com" en una lista de correos válidos, sin
 * duplicados. Usado al crear una reunión (crm.ts, adhoc-meetings.ts) —
 * mismo formato en los dos lugares.
 */
export function parseGuestEmails(raw: string | null | undefined): { emails: string[] } | { error: string } {
  const parts = (raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length > MAX_MEETING_GUESTS) {
    return { error: `Máximo ${MAX_MEETING_GUESTS} invitados por reunión.` };
  }

  const emails: string[] = [];
  for (const part of parts) {
    const result = z.email().safeParse(part);
    if (!result.success) return { error: `"${part}" no es un correo válido.` };
    if (!emails.includes(result.data)) emails.push(result.data);
  }

  return { emails };
}
