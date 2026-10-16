import { describe, expect, it } from "vitest";
import {
  clientAnsweredMeetingInvitation,
  countBotMessagesInSession,
  describeBookingWindow,
  type BotMessageLite,
} from "./bot-guards";

let t = Date.UTC(2026, 9, 8, 9, 0, 0);
function msg(role: BotMessageLite["role"], content: string, afterMinutes = 1): BotMessageLite {
  t += afterMinutes * 60_000;
  return { role, content, createdAt: new Date(t) };
}

describe("clientAnsweredMeetingInvitation", () => {
  it("no manda la lista en el primer turno (caso Gilberto)", () => {
    expect(clientAnsweredMeetingInvitation([msg("CUSTOMER", "¡Hola! Quiero más información")])).toBe(false);
  });

  it("no manda la lista si el bot todavía no invitó a la reunión (caso JGO)", () => {
    const chat = [
      msg("CUSTOMER", "Conta"),
      msg("BOT", "¿Qué aspecto de la contabilidad te gustaría mejorar?"),
      msg("CUSTOMER", "Todo lo hacemos manualmente"),
    ];
    expect(clientAnsweredMeetingInvitation(chat)).toBe(false);
  });

  it("manda la lista cuando el bot invitó y el cliente contestó", () => {
    const chat = [
      msg("CUSTOMER", "Todo lo hacemos manualmente"),
      msg("BOT", "¿Te gustaría agendar una reunión de 20–30 minutos?"),
      msg("CUSTOMER", "Sí, dale"),
    ];
    expect(clientAnsweredMeetingInvitation(chat)).toBe(true);
  });

  it("ignora los registros internos de lista al buscar la invitación", () => {
    const chat = [
      msg("BOT", "¿Te gustaría agendar una reunión?"),
      msg("BOT", "[Lista de días] jueves 8/10 · viernes 9/10"),
      msg("CUSTOMER", "ok"),
    ];
    expect(clientAnsweredMeetingInvitation(chat)).toBe(true);
  });

  it("no cuenta una invitación que el cliente aún no contestó", () => {
    const chat = [msg("CUSTOMER", "hola"), msg("BOT", "¿Querés agendar una reunión?")];
    expect(clientAnsweredMeetingInvitation(chat)).toBe(false);
  });
});

describe("countBotMessagesInSession", () => {
  it("cuenta todos los mensajes del bot dentro de una misma sesión", () => {
    const chat = [msg("CUSTOMER", "a"), msg("BOT", "b"), msg("CUSTOMER", "c"), msg("BOT", "d")];
    expect(countBotMessagesInSession(chat)).toBe(2);
  });

  it("no arrastra mensajes de días anteriores (caso JGO)", () => {
    const chat = [
      msg("BOT", "viejo 1"),
      msg("BOT", "viejo 2"),
      msg("BOT", "viejo 3"),
      msg("CUSTOMER", "Hola de nuevo", 60 * 24 * 8), // 8 días después
      msg("BOT", "respuesta nueva"),
      msg("CUSTOMER", "¿Sabes a qué me dedico?"),
    ];
    expect(countBotMessagesInSession(chat)).toBe(1);
  });

  it("sin mensajes devuelve 0", () => {
    expect(countBotMessagesInSession([])).toBe(0);
  });
});

describe("describeBookingWindow", () => {
  const base = { bookingStartHour: 9, bookingEndHour: 18, bookingDurationMinutes: 30, timezone: "America/La_Paz" };
  it("lunes a viernes", () => {
    expect(describeBookingWindow({ ...base, bookingDays: [1, 2, 3, 4, 5] })).toBe(
      "Reuniones de lunes a viernes, de 09:00 a 18:00 (hora America/La_Paz), de 30 minutos.",
    );
  });
  it("días sueltos y semana con domingo al final", () => {
    expect(describeBookingWindow({ ...base, bookingDays: [1, 3] })).toContain("lunes y miércoles");
    expect(describeBookingWindow({ ...base, bookingDays: [0, 1, 2] })).toContain("lunes, martes y domingo");
  });
  it("sin días habilitados", () => {
    expect(describeBookingWindow({ ...base, bookingDays: [] })).toContain("No hay días");
  });
});
