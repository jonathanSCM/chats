import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ExternalLink, FileText, Link2, Users, Video } from "lucide-react";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { Card } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BOT_STATUS_CONFIG } from "@/lib/meeting-bot-status";
import { vendorColor } from "@/lib/vendor-color";
import {
  groupMeetings,
  meetingDisplayTitle,
  meetingsWhere,
  parseMeetingFilters,
  type ListMeeting,
} from "@/lib/meetings-list";
import { getOrgMemberUserIds } from "@/server/services/organization-membership";
import { ReunionesTabs } from "../_components/reuniones-tabs";
import { LinkToTracking } from "./_components/link-to-tracking";

const LIMIT = 300;

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  DONE: "Realizada",
  CANCELED: "Cancelada",
  NO_SHOW: "No se presentó",
};

interface Row extends ListMeeting {
  title: string;
  durationMinutes: number;
  status: string;
  botStatus: string | null;
  meetingUrl: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  assignedTo: { id: string; name: string; color: string | null } | null;
  context: string | null;
}

export default async function TodasLasReunionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user.organizationId) redirect("/dashboard");
  const organizationId = session.user.organizationId;

  const filters = parseMeetingFilters(await searchParams);
  const now = new Date();

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const timeZone = org?.timezone || "America/La_Paz";

  const [meetings, memberIds] = await Promise.all([
    prisma.meeting.findMany({
      where: meetingsWhere(filters, organizationId, now, timeZone),
      orderBy: { scheduledAt: "desc" },
      take: LIMIT + 1,
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
        botStatus: true,
        meetingUrl: true,
        context: true,
        opportunityId: true,
        opportunity: {
          select: {
            title: true,
            contact: { select: { id: true, fullName: true, phone: true } },
            assignedTo: { select: { id: true, name: true, email: true, color: true } },
          },
        },
      },
    }),
    getOrgMemberUserIds(organizationId),
  ]);
  const members = await prisma.user.findMany({
    where: { id: { in: memberIds }, role: { notIn: ["SYSTEM", "SUPERADMIN"] } },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const truncated = meetings.length > LIMIT;
  const rows: Row[] = meetings.slice(0, LIMIT).map((m) => {
    const contact = m.opportunity?.contact ?? null;
    const clientName = contact ? contact.fullName || contact.phone : null;
    return {
      id: m.id,
      title: meetingDisplayTitle({ title: m.title, clientName }),
      scheduledAt: m.scheduledAt.toISOString(),
      durationMinutes: m.durationMinutes,
      status: m.status,
      botStatus: m.botStatus,
      meetingUrl: m.meetingUrl,
      opportunityId: m.opportunityId,
      opportunityTitle: m.opportunity?.title ?? null,
      context: m.context,
      clientKey: contact?.id ?? null,
      clientName,
      assignedTo: m.opportunity?.assignedTo
        ? {
            id: m.opportunity.assignedTo.id,
            name: m.opportunity.assignedTo.name || m.opportunity.assignedTo.email,
            color: m.opportunity.assignedTo.color,
          }
        : null,
    };
  });

  const groups = groupMeetings(rows, filters.vista, now, timeZone);
  const hasFilters = Boolean(
    filters.q || filters.estado || filters.asociacion || filters.resp || filters.desde || filters.hasta || filters.cuando !== "recientes",
  );
  const timeFmt = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit", timeZone });
  const dateFmt = new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", timeZone });

  return (
    <div className="max-w-4xl animate-fade-up">
      <h1 className="mb-1 text-2xl font-bold">Reuniones</h1>
      <p className="mb-4 text-sm text-ink-muted">
        Todas las reuniones en un solo lugar: las de Seguimiento y las internas. Busca, filtra y, si una reunión interna
        es de un cliente, asóciala a su seguimiento.
      </p>
      <ReunionesTabs active="todas" />

      <form method="get" className="mb-5 space-y-3 rounded-lg border border-border bg-surface p-3">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="q">Buscar</Label>
            <Input id="q" name="q" defaultValue={filters.q} placeholder="Título, cliente o teléfono" className="py-1.5 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cuando">Cuándo</Label>
            <Select id="cuando" name="cuando" defaultValue={filters.cuando} className="py-1.5 text-sm">
              <option value="recientes">Próximas y últimos 7 días</option>
              <option value="proximas">Solo próximas</option>
              <option value="pasadas">Solo pasadas</option>
              <option value="todas">Todas</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vista">Agrupar por</Label>
            <Select id="vista" name="vista" defaultValue={filters.vista} className="py-1.5 text-sm">
              <option value="dia">Día</option>
              <option value="cliente">Cliente</option>
            </Select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="estado">Estado</Label>
            <Select id="estado" name="estado" defaultValue={filters.estado} className="py-1.5 text-sm">
              <option value="">Todos</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="asociacion">Seguimiento</Label>
            <Select id="asociacion" name="asociacion" defaultValue={filters.asociacion} className="py-1.5 text-sm">
              <option value="">Con o sin</option>
              <option value="con">Con seguimiento</option>
              <option value="sin">Internas (sin seguimiento)</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="resp">Responsable</Label>
            <Select id="resp" name="resp" defaultValue={filters.resp} className="py-1.5 text-sm">
              <option value="">Todos</option>
              {members.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="desde">Desde</Label>
            <Input id="desde" name="desde" type="date" defaultValue={filters.desde} className="py-1.5 text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hasta">Hasta</Label>
            <Input id="hasta" name="hasta" type="date" defaultValue={filters.hasta} className="py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          {hasFilters && (
            <Link href="/dashboard/reuniones/todas" className="text-sm text-ink-muted hover:text-ink hover:underline">
              Limpiar filtros
            </Link>
          )}
          <span className="ml-auto text-xs text-ink-faint">
            {rows.length} reunión{rows.length === 1 ? "" : "es"}
            {truncated ? ` (se muestran las primeras ${LIMIT}; afina los filtros)` : ""}
          </span>
        </div>
      </form>

      {rows.length === 0 ? (
        <Card className="text-sm text-ink-muted">
          {hasFilters ? "No hay reuniones con esos filtros." : "Todavía no hay reuniones próximas ni de la última semana."}
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                {filters.vista === "dia" ? <CalendarDays size={14} className="text-ink-faint" /> : <Users size={14} className="text-ink-faint" />}
                {g.label}
                <span className="text-xs font-normal text-ink-faint">{g.rows.length}</span>
              </h2>
              <ul className="space-y-2">
                {(g.rows as Row[]).map((m) => {
                  const bot = m.botStatus ? BOT_STATUS_CONFIG[m.botStatus] : null;
                  const BotIcon = bot?.icon;
                  return (
                    <li key={m.id} className="rounded-lg border border-border bg-surface p-3">
                      <div className="flex items-start gap-3">
                        <div className="w-16 shrink-0 text-xs text-ink-muted">
                          {filters.vista === "cliente" && <p className="font-medium text-ink">{dateFmt.format(new Date(m.scheduledAt))}</p>}
                          <p className={filters.vista === "cliente" ? "" : "text-sm font-medium text-ink"}>{timeFmt.format(new Date(m.scheduledAt))}</p>
                          <p>{m.durationMinutes} min</p>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{m.title}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                            {m.opportunityId ? (
                              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">Seguimiento</span>
                            ) : (
                              <span className="rounded-full bg-surface-2 px-2 py-0.5">Interna</span>
                            )}
                            <span className="rounded-full bg-surface-2 px-2 py-0.5">{STATUS_LABEL[m.status] ?? m.status}</span>
                            {bot && BotIcon && (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${bot.className}`}>
                                <BotIcon size={11} />
                                {bot.label}
                              </span>
                            )}
                            {m.assignedTo && (
                              <span
                                className="rounded-full px-2 py-0.5 text-white"
                                style={{ backgroundColor: vendorColor(m.assignedTo.id, m.assignedTo.color) }}
                              >
                                {m.assignedTo.name}
                              </span>
                            )}
                          </p>
                          {m.context && (
                            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs italic text-ink-faint" title="Contexto interno: no lo ve el cliente">
                              {m.context}
                            </p>
                          )}
                          {filters.vista === "dia" && m.clientName && m.opportunityTitle && (
                            <p className="mt-1 truncate text-xs text-ink-faint">
                              {m.clientName} · {m.opportunityTitle}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1.5 text-xs">
                          {m.opportunityId ? (
                            <>
                              <Link
                                href={`/dashboard/seguimiento?open=${m.opportunityId}&reunion=${m.id}`}
                                className="inline-flex items-center gap-1 text-accent hover:underline"
                                title="Abre la ficha de la reunión (transcripción, resumen, contexto y notas)"
                              >
                                <FileText size={12} /> Abrir ficha
                              </Link>
                              <Link
                                href={`/dashboard/seguimiento?open=${m.opportunityId}`}
                                className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                                title="Abre al cliente en Seguimiento"
                              >
                                <ExternalLink size={12} /> Ver en seguimiento
                              </Link>
                            </>
                          ) : (
                            <Link
                              href={`/dashboard/reuniones?open=${m.id}`}
                              className="inline-flex items-center gap-1 text-accent hover:underline"
                              title="Abre la ficha de la reunión interna"
                            >
                              <FileText size={12} /> Abrir ficha
                            </Link>
                          )}
                          {m.meetingUrl && (
                            <a
                              href={m.meetingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                            >
                              <Video size={12} /> Unirse
                            </a>
                          )}
                        </div>
                      </div>

                      {!m.opportunityId && (
                        <details className="mt-2">
                          <summary className="inline-flex cursor-pointer items-center gap-1 text-xs text-ink-muted hover:text-ink">
                            <Link2 size={12} /> Asociar a un seguimiento
                          </summary>
                          <LinkToTracking meetingId={m.id} />
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
