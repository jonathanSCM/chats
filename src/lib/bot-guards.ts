/**
 * Guardas del bot de calificación que no dependen del modelo: lo que decide
 * el código aunque la IA se equivoque (el modelo rápido a veces marca
 * "listo_para_agendar" en el primer turno, contra la guía).
 */

export interface BotMessageLite {
  role: "CUSTOMER" | "BOT" | "STAFF" | "SYSTEM";
  content: string;
  createdAt: Date;
}

// Una conversación que lleva más de este tiempo sin actividad empieza una
// "sesión" nueva: el tope de mensajes del bot no arrastra lo de días atrás.
export const SESSION_GAP_HOURS = 24;

const INVITATION = /reuni[oó]n|agendar|videollamada|llamada|google meet/i;

/** Los registros internos de las listas de WhatsApp ("[Lista de días] ...") no son texto que leyó el cliente. */
const isListMarker = (content: string) => content.trimStart().startsWith("[");

/**
 * ¿El último mensaje de texto del bot invitó a una reunión y el cliente
 * contestó después? Solo entonces corresponde mandar la lista de días: así un
 * "listo_para_agendar" del modelo sin que el cliente haya aceptado no manda
 * horarios de golpe. Espera los mensajes en orden cronológico.
 */
export function clientAnsweredMeetingInvitation(messages: BotMessageLite[]): boolean {
  let lastBotText = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "BOT" && !isListMarker(m.content)) {
      lastBotText = i;
      break;
    }
  }
  if (lastBotText === -1) return false;
  if (!INVITATION.test(messages[lastBotText].content)) return false;
  return messages.slice(lastBotText + 1).some((m) => m.role === "CUSTOMER");
}

/**
 * Cantidad de mensajes del bot en la sesión actual (desde el último hueco de
 * SESSION_GAP_HOURS sin actividad). Espera orden cronológico.
 */
export function countBotMessagesInSession(
  messages: BotMessageLite[],
  gapHours = SESSION_GAP_HOURS,
): number {
  const gapMs = gapHours * 3_600_000;
  let start = 0;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].createdAt.getTime() - messages[i - 1].createdAt.getTime() > gapMs) start = i;
  }
  return messages.slice(start).filter((m) => m.role === "BOT").length;
}

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * Horario de reuniones de la organización (Organización > Ventas) en texto,
 * para que el bot pueda contestar "¿en qué horario atienden?" sin inventar.
 * Solo el rango general: los horarios puntuales los manda la lista del sistema.
 */
export function describeBookingWindow(s: {
  bookingDays: number[];
  bookingStartHour: number;
  bookingEndHour: number;
  bookingDurationMinutes: number;
  timezone: string;
}): string {
  const days = [...new Set(s.bookingDays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) return "(No hay días habilitados para reuniones.)";
  // Semana corrida de lunes a domingo para decir "de lunes a viernes" cuando son consecutivos.
  const order = days.map((d) => (d + 6) % 7).sort((a, b) => a - b);
  const consecutive = order.every((d, i) => i === 0 || d === order[i - 1] + 1);
  const names = days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_NAMES[d]);
  const dayText =
    consecutive && names.length > 2
      ? `de ${names[0]} a ${names[names.length - 1]}`
      : names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `Reuniones ${dayText}, de ${hh(s.bookingStartHour)} a ${hh(s.bookingEndHour)} (hora ${s.timezone}), de ${s.bookingDurationMinutes} minutos.`;
}
