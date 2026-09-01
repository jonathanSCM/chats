import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { CalendarMonth } from "./_components/calendar-month";

// Lunes como primer día — igual que el calendario de la mayoría acá.
function startOfWeekMonday(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // 0 = lunes
  const out = new Date(d);
  out.setDate(d.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

// "YYYY-MM-DD" en horario LOCAL — a propósito, no .toISOString() (que es
// UTC): si el navegador está en un huso distinto al del servidor,
// serializar como timestamp UTC y releer con getters locales del otro
// lado corre el día entero para atrás o para adelante. Un string de
// fecha sin hora no tiene ese problema — ambos lados lo interpretan
// igual sin importar el huso de cada uno.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");

  const { mes } = await searchParams;
  const now = new Date();
  const [y, m] = mes && /^\d{4}-\d{2}$/.test(mes) ? mes.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0); // último día del mes

  // La grilla necesita semanas completas — se rellena con los días vecinos
  // de los meses anterior/siguiente que caen en la misma semana.
  const gridStart = startOfWeekMonday(monthStart);
  const gridEnd = startOfWeekMonday(new Date(monthEnd.getTime() + 7 * 86_400_000));
  // gridEnd es el lunes de la semana siguiente al fin de mes — el rango
  // real de días a mostrar termina el domingo anterior a eso.
  const gridEndInclusive = new Date(gridEnd.getTime() - 86_400_000);

  const organizationId = session.user.organizationId;

  const meetings = await prisma.meeting.findMany({
    where: {
      organizationId,
      opportunity: { archivedAt: null },
      scheduledAt: { gte: gridStart, lte: new Date(gridEndInclusive.getTime() + 86_399_999) },
    },
    include: {
      opportunity: {
        select: {
          id: true,
          title: true,
          serviceInterest: true,
          stage: true,
          contact: { select: { fullName: true, phone: true } },
          assignedTo: { select: { id: true, name: true, email: true, color: true } },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  const rows = meetings.map((mtg) => ({
    id: mtg.id,
    scheduledAt: mtg.scheduledAt.toISOString(),
    durationMinutes: mtg.durationMinutes,
    meetingUrl: mtg.meetingUrl,
    status: mtg.status,
    opportunityId: mtg.opportunity?.id ?? null,
    client: mtg.opportunity?.contact.fullName || mtg.opportunity?.contact.phone || "—",
    service: mtg.opportunity?.serviceInterest ?? "",
    need: mtg.opportunity?.title ?? "",
    assignedTo: mtg.opportunity?.assignedTo
      ? {
          id: mtg.opportunity.assignedTo.id,
          name: mtg.opportunity.assignedTo.name || mtg.opportunity.assignedTo.email,
          color: mtg.opportunity.assignedTo.color,
        }
      : null,
  }));

  const prevMonth = new Date(y, m - 2, 1);
  const nextMonth = new Date(y, m, 1);
  const monthLabel = monthStart.toLocaleDateString("es", { month: "long", year: "numeric" });

  return (
    <div className="animate-fade-up">
      <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Calendario</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Las reuniones agendadas en Seguimiento, todas juntas en un solo lugar.
      </p>

      <CalendarMonth
        rows={rows}
        gridStart={ymd(gridStart)}
        gridEndInclusive={ymd(gridEndInclusive)}
        monthStart={ymd(monthStart)}
        monthEnd={ymd(monthEnd)}
        monthLabel={monthLabel}
        prevHref={`/dashboard/calendario?mes=${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`}
        nextHref={`/dashboard/calendario?mes=${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`}
        todayHref="/dashboard/calendario"
      />
    </div>
  );
}
