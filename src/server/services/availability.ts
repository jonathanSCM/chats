import { prisma } from "@/server/db/client";
import { getZonedParts, zonedTimeToUtc } from "@/lib/timezone";

const DAY_LABEL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export interface MeetingSlot {
  label: string; // "lunes 2/09, 10:00"
  date: Date;
}

/**
 * Franjas realmente libres para ofrecerle una reunión a un lead: dentro del
 * horario que la organización habilitó (Organization.booking*), descartando
 * lo que ya choca con una reunión existente. Reemplaza a getMeetingSlots()
 * de lib/meeting-slots.ts, que ofrecía horarios fijos (lunes/miércoles/
 * viernes a las 10 y 15h) sin mirar nada real.
 *
 * Busca hasta `maxDaysAhead` días hacia adelante -- si la agenda está
 * completamente llena en la franja habilitada, sigue buscando más lejos en
 * vez de devolver una lista vacía y dejar al bot sin nada que ofrecer.
 */
export async function getAvailableSlots(
  organizationId: string,
  count = 3,
  maxDaysAhead = 30,
): Promise<MeetingSlot[]> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      timezone: true,
      bookingDays: true,
      bookingStartHour: true,
      bookingEndHour: true,
      bookingDurationMinutes: true,
      bookingLeadHours: true,
    },
  });

  const timeZone = org.timezone;
  const days = org.bookingDays.length ? org.bookingDays : [1, 2, 3, 4, 5];
  const duration = org.bookingDurationMinutes;
  const now = new Date();
  const earliestStart = new Date(now.getTime() + org.bookingLeadHours * 60 * 60 * 1000);
  const searchLimit = new Date(now.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000);

  // Trae de una sola vez todo lo que ya está agendado en la ventana de
  // búsqueda -- se descarta en memoria, más simple que una query por franja.
  const busyMeetings = await prisma.meeting.findMany({
    where: {
      organizationId,
      status: { not: "CANCELED" },
      scheduledAt: { gte: now, lte: searchLimit },
    },
    select: { scheduledAt: true, durationMinutes: true },
  });

  function overlapsExisting(start: Date, durationMinutes: number): boolean {
    const end = start.getTime() + durationMinutes * 60_000;
    return busyMeetings.some((m) => {
      const busyStart = m.scheduledAt.getTime();
      const busyEnd = busyStart + m.durationMinutes * 60_000;
      return start.getTime() < busyEnd && end > busyStart;
    });
  }

  const todayParts = getZonedParts(now, timeZone);
  // Ancla al mediodía local de hoy y avanza de a 24h reales -- alcanza para
  // recorrer días de calendario sin volver a llamar a Intl por cada uno.
  let dayAnchor = zonedTimeToUtc(todayParts.year, todayParts.month, todayParts.day, 12, 0, timeZone);

  const slots: MeetingSlot[] = [];
  for (let dayOffset = 0; dayOffset < maxDaysAhead && slots.length < count; dayOffset++) {
    const dayParts = getZonedParts(dayAnchor, timeZone);
    if (days.includes(dayParts.weekday)) {
      for (
        let minuteOfDay = org.bookingStartHour * 60;
        minuteOfDay < org.bookingEndHour * 60 && slots.length < count;
        minuteOfDay += duration
      ) {
        const hour = Math.floor(minuteOfDay / 60);
        const minute = minuteOfDay % 60;
        const slotDate = zonedTimeToUtc(dayParts.year, dayParts.month, dayParts.day, hour, minute, timeZone);
        if (slotDate < earliestStart) continue;
        if (overlapsExisting(slotDate, duration)) continue;
        const label = `${DAY_LABEL[dayParts.weekday]} ${dayParts.day}/${String(dayParts.month).padStart(2, "0")}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        slots.push({ label, date: slotDate });
      }
    }
    dayAnchor = new Date(dayAnchor.getTime() + 24 * 60 * 60 * 1000);
  }

  return slots;
}

/**
 * Si `date` ya choca con otra reunión de la organización -- para
 * re-chequear justo antes de confirmar, no solo cuando se ofrecieron las
 * franjas. Entre que el bot le mostró un horario a un lead y el lead
 * eligió, otro lead (u otro vendedor) puede haber tomado ese mismo
 * horario; sin este chequeo, maybeScheduleMeeting() de qualification-bot.ts
 * solo evitaba duplicar la reunión de la MISMA oportunidad, no un choque
 * con una oportunidad distinta.
 */
export async function hasSchedulingConflict(
  organizationId: string,
  date: Date,
  durationMinutes: number,
  excludeMeetingId?: string,
): Promise<boolean> {
  const end = date.getTime() + durationMinutes * 60_000;
  // Ventana generosa alrededor de `date` -- cualquier reunión que pueda
  // solaparse tiene que empezar en algún punto de acá adentro, sin asumir
  // una duración máxima razonable para lo que ya hubiera agendado.
  const nearby = await prisma.meeting.findMany({
    where: {
      organizationId,
      status: { not: "CANCELED" },
      id: excludeMeetingId ? { not: excludeMeetingId } : undefined,
      scheduledAt: { gte: new Date(date.getTime() - 24 * 60 * 60 * 1000), lt: new Date(end) },
    },
    select: { scheduledAt: true, durationMinutes: true },
  });
  return nearby.some((m) => {
    const busyStart = m.scheduledAt.getTime();
    const busyEnd = busyStart + m.durationMinutes * 60_000;
    return date.getTime() < busyEnd && end > busyStart;
  });
}
