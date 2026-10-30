/**
 * Título de una reunión: lo que ve el CLIENTE en la invitación de Google Calendar. Solo sale de lo que
 * escribió el vendedor o, si lo dejó vacío, de "Reunión con {nombre}". Nunca incluye datos internos del
 * pipeline (como "Necesidad / Contexto" de la oportunidad): eso se queda dentro del CRM.
 */
export function meetingTitleForClient(params: {
  title?: string | null;
  contactName?: string | null;
  phone?: string | null;
}): string {
  const typed = params.title?.trim();
  if (typed) return typed;
  const who = params.contactName?.trim() || params.phone?.trim() || "cliente";
  return `Reunión con ${who}`;
}
