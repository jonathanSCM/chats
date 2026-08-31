// Franjas fijas para que el bot ofrezca reunión sin integración de
// calendario: los próximos días hábiles, en horarios configurables. El
// vendedor confirma el horario real y manda el link de Meet a mano (mismo
// flujo 100% manual que ya existe para reuniones cargadas desde el panel).
const DAY_LABEL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export interface MeetingSlot {
  label: string; // "lunes 2/09, 10:00"
  date: Date;
}

function parseHours(): number[] {
  const raw = process.env.MEETING_SLOT_HOURS ?? "10,15";
  const hours = raw
    .split(",")
    .map((h) => Number(h.trim()))
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return hours.length ? hours : [10, 15];
}

/** Los próximos `count` días hábiles (lunes a viernes), empezando mañana. */
export function getMeetingSlots(count = 3): MeetingSlot[] {
  const hours = parseHours();
  const slots: MeetingSlot[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1);

  while (slots.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      const hour = hours[slots.length % hours.length];
      const date = new Date(cursor);
      date.setHours(hour, 0, 0, 0);
      const label = `${DAY_LABEL[day]} ${date.getDate()}/${String(date.getMonth() + 1).padStart(2, "0")}, ${String(hour).padStart(2, "0")}:00`;
      slots.push({ label, date });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}
