import type { Prisma } from "@/generated/prisma/client";

/**
 * Lista única de reuniones: las internas (sin cliente) y las de Seguimiento juntas. Esta parte es pura:
 * lee los filtros de la URL, arma la consulta y agrupa por día o por cliente.
 */

export const MEETING_STATUSES = ["SCHEDULED", "CONFIRMED", "DONE", "CANCELED", "NO_SHOW"] as const;
export type MeetingStatusValue = (typeof MEETING_STATUSES)[number];

export type MeetingWhen = "recientes" | "proximas" | "pasadas" | "todas";
export type MeetingView = "dia" | "cliente";

export interface MeetingFilters {
  q: string;
  estado: MeetingStatusValue | "";
  asociacion: "" | "con" | "sin";
  resp: string;
  desde: string;
  hasta: string;
  vista: MeetingView;
  cuando: MeetingWhen;
}

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Lee los filtros de la URL; lo que no se entiende vuelve al valor por defecto. */
export function parseMeetingFilters(params: Params): MeetingFilters {
  const estado = one(params, "estado");
  const asociacion = one(params, "asociacion");
  const vista = one(params, "vista");
  const cuando = one(params, "cuando");
  const desde = one(params, "desde");
  const hasta = one(params, "hasta");
  return {
    q: one(params, "q").slice(0, 80),
    estado: (MEETING_STATUSES as readonly string[]).includes(estado) ? (estado as MeetingStatusValue) : "",
    asociacion: asociacion === "con" || asociacion === "sin" ? asociacion : "",
    resp: one(params, "resp").slice(0, 40),
    desde: DATE.test(desde) ? desde : "",
    hasta: DATE.test(hasta) ? hasta : "",
    vista: vista === "cliente" ? "cliente" : "dia",
    cuando: cuando === "proximas" || cuando === "pasadas" || cuando === "todas" ? cuando : "recientes",
  };
}

const RECENT_DAYS = 7;

/** Inicio (00:00) del día `YYYY-MM-DD` en la zona horaria dada, como instante UTC. */
export function startOfDayInZone(dateKey: string, timeZone: string): Date {
  // Se prueba con el mediodía UTC para sacar el desfase de esa zona ese día.
  const [y, m, d] = dateKey.split("-").map(Number);
  const noonUtc = Date.UTC(y, m - 1, d, 12);
  const asZone = new Date(new Date(noonUtc).toLocaleString("en-US", { timeZone }));
  const offsetMs = asZone.getTime() - new Date(new Date(noonUtc).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(Date.UTC(y, m - 1, d) - offsetMs);
}

export function meetingsWhere(
  f: MeetingFilters,
  organizationId: string,
  now: Date,
  timeZone: string,
): Prisma.MeetingWhereInput {
  const and: Prisma.MeetingWhereInput[] = [];

  // Las reuniones de un seguimiento archivado no se muestran (igual que en el Calendario).
  and.push({ OR: [{ opportunityId: null }, { opportunity: { archivedAt: null } }] });

  const scheduled: Prisma.DateTimeFilter = {};
  if (f.cuando === "recientes") scheduled.gte = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  if (f.cuando === "proximas") scheduled.gte = now;
  if (f.cuando === "pasadas") scheduled.lt = now;
  if (f.desde) {
    const from = startOfDayInZone(f.desde, timeZone);
    if (!scheduled.gte || from > (scheduled.gte as Date)) scheduled.gte = from;
  }
  if (f.hasta) {
    const to = new Date(startOfDayInZone(f.hasta, timeZone).getTime() + 86_400_000);
    if (!scheduled.lt || to < (scheduled.lt as Date)) scheduled.lt = to;
  }
  if (scheduled.gte || scheduled.lt) and.push({ scheduledAt: scheduled });

  if (f.estado) and.push({ status: f.estado });
  if (f.asociacion === "con") and.push({ opportunityId: { not: null } });
  if (f.asociacion === "sin") and.push({ opportunityId: null });
  if (f.resp) and.push({ opportunity: { assignedToId: f.resp } });

  if (f.q) {
    and.push({
      OR: [
        { title: { contains: f.q, mode: "insensitive" } },
        { opportunity: { title: { contains: f.q, mode: "insensitive" } } },
        { opportunity: { contact: { fullName: { contains: f.q, mode: "insensitive" } } } },
        { opportunity: { contact: { phone: { contains: f.q } } } },
      ],
    });
  }

  return { organizationId, AND: and };
}

// ── Agrupar ─────────────────────────────────────────────────────────────────

export interface ListMeeting {
  id: string;
  scheduledAt: string;
  clientKey: string | null;
  clientName: string | null;
}

export interface MeetingGroup<T extends ListMeeting> {
  key: string;
  label: string;
  rows: T[];
}

/** Día `YYYY-MM-DD` de un instante, en la zona horaria dada (no la del servidor). */
export function dayKeyInZone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone });
}

export function dayLabelInZone(dateKey: string, now: Date, timeZone: string): string {
  const today = dayKeyInZone(now.toISOString(), timeZone);
  const diff = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Mañana";
  if (diff === -1) return "Ayer";
  const text = new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const NO_CLIENT_KEY = "__sin_cliente__";

export function groupMeetings<T extends ListMeeting>(
  rows: T[],
  view: MeetingView,
  now: Date,
  timeZone: string,
): MeetingGroup<T>[] {
  const byNewest = (a: T, b: T) => b.scheduledAt.localeCompare(a.scheduledAt);

  if (view === "cliente") {
    const groups = new Map<string, MeetingGroup<T>>();
    for (const row of [...rows].sort(byNewest)) {
      const key = row.clientKey ?? NO_CLIENT_KEY;
      const group = groups.get(key) ?? { key, label: row.clientName ?? "Internas (sin cliente)", rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    // Los clientes con la reunión más reciente primero; "Internas" siempre al final.
    return [...groups.values()].sort((a, b) => {
      if (a.key === NO_CLIENT_KEY) return 1;
      if (b.key === NO_CLIENT_KEY) return -1;
      return b.rows[0].scheduledAt.localeCompare(a.rows[0].scheduledAt);
    });
  }

  const groups = new Map<string, MeetingGroup<T>>();
  // Las próximas primero y más cercanas arriba; después las pasadas, de la más reciente a la más vieja.
  const nowIso = now.toISOString();
  const upcoming = rows.filter((r) => r.scheduledAt >= nowIso).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const past = rows.filter((r) => r.scheduledAt < nowIso).sort(byNewest);
  for (const row of [...upcoming, ...past]) {
    const key = dayKeyInZone(row.scheduledAt, timeZone);
    const group = groups.get(key) ?? { key, label: dayLabelInZone(key, now, timeZone), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  // Dentro de cada día, por hora.
  for (const g of groups.values()) g.rows.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return [...groups.values()];
}

/** Título para mostrar: el escrito, o el de la oportunidad/cliente, o "Reunión interna". */
export function meetingDisplayTitle(m: { title: string | null; clientName: string | null }): string {
  return m.title?.trim() || (m.clientName ? `Reunión con ${m.clientName}` : "Reunión interna");
}
