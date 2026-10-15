import type { MeetingSummaryData } from "@/lib/meeting-summary";

export type ApplyKey = "need" | "budget" | "urgency" | "authority" | "nextAction" | "lastUpdate";

/** Valores actuales de la oportunidad que el resumen podría completar o reemplazar. */
export interface OpportunitySnapshot {
  needSummary: string | null;
  budgetRange: string | null;
  urgency: string | null;
  authorityLevel: string | null;
  nextAction: string | null;
  nextActionAt: Date | null;
  lastUpdate: string | null;
}

/** Cambios concretos en la base de datos si esta propuesta se aprueba. */
export interface ProposalChanges {
  needSummary?: string;
  needStatus?: "CONFIRMED";
  budgetRange?: string;
  budgetStatus?: "CONFIRMED";
  urgency?: string;
  authorityLevel?: string;
  nextAction?: string;
  nextActionAt?: Date;
  lastUpdate?: string;
}

export interface Proposal {
  key: ApplyKey;
  label: string;
  current: string;
  proposed: string;
  /** fill: el campo estaba vacío. replace: pisa un valor existente. append: se agrega al texto existente. */
  mode: "fill" | "replace" | "append";
  changes: ProposalChanges;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LAST_UPDATE = 5000;
const ENTRY_MAX = 600;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function shortDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Primera oración del resumen, para la línea que queda en "Última actualización". */
function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^.+?[.!?](\s|$)/);
  return (m ? m[0] : t).trim();
}

/** Fecha yyyy-mm-dd válida, no anterior a la reunión (con 1 día de margen) ni a más de 1 año. */
export function parseStepDate(iso: string | null | undefined, meetingDate: Date): Date | null {
  if (!iso || !ISO_DATE.test(iso)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const min = meetingDate.getTime() - 24 * 60 * 60 * 1000;
  const max = meetingDate.getTime() + 366 * 24 * 60 * 60 * 1000;
  return d.getTime() >= min && d.getTime() <= max ? d : null;
}

function textProposal(
  key: ApplyKey,
  label: string,
  currentValue: string | null,
  proposedValue: string,
  changes: ProposalChanges,
): Proposal | null {
  const proposed = proposedValue.trim();
  const current = clean(currentValue);
  if (!proposed || proposed === current) return null;
  return { key, label, current, proposed, mode: current ? "replace" : "fill", changes };
}

/**
 * Qué campos de la oportunidad propone completar el resumen de una reunión.
 * No escribe nada: la persona revisa y aprueba cada uno. Solo se usa lo que
 * efectivamente se dijo en la reunión.
 */
export function buildProposals(
  data: MeetingSummaryData,
  current: OpportunitySnapshot,
  meetingDate: Date,
): Proposal[] {
  const c = data.informacionComercial;
  const out: Proposal[] = [];

  const need = [clean(c.necesidad), clean(c.dolor) ? `Dolor: ${clean(c.dolor)}` : ""].filter(Boolean).join(" ");
  const p1 = textProposal("need", "Necesidad", current.needSummary, need, {
    needSummary: need,
    needStatus: "CONFIRMED",
  });
  if (p1) out.push(p1);

  const p2 = textProposal("budget", "Presupuesto", current.budgetRange, clean(c.presupuesto), {
    budgetRange: clean(c.presupuesto),
    budgetStatus: "CONFIRMED",
  });
  if (p2) out.push(p2);

  const p3 = textProposal("urgency", "Urgencia", current.urgency, clean(c.urgencia), { urgency: clean(c.urgencia) });
  if (p3) out.push(p3);

  const p4 = textProposal("authority", "Decisor", current.authorityLevel, clean(c.decisor), {
    authorityLevel: clean(c.decisor),
  });
  if (p4) out.push(p4);

  const step = data.proximosPasos.find((s) => clean(s.accion));
  if (step) {
    const action = clean(step.accion).slice(0, 300);
    const date = parseStepDate(step.fechaIso, meetingDate);
    const changes: ProposalChanges = { nextAction: action };
    if (date) changes.nextActionAt = date;
    const currentText = [clean(current.nextAction), current.nextActionAt ? shortDate(current.nextActionAt) : ""]
      .filter(Boolean)
      .join(" — ");
    const proposedText = [action, date ? shortDate(date) : step.fecha ? `(${clean(step.fecha)})` : ""]
      .filter(Boolean)
      .join(" — ");
    if (action && action !== clean(current.nextAction)) {
      out.push({
        key: "nextAction",
        label: "Próxima acción",
        current: currentText,
        proposed: proposedText,
        mode: currentText ? "replace" : "fill",
        changes,
      });
    }
  }

  const bits = [
    firstSentence(data.resumen),
    c.acuerdos.length ? `Acuerdos: ${c.acuerdos.map((a) => a.trim().replace(/\.$/, "")).join("; ")}.` : "",
    c.objeciones.length ? `Objeciones: ${c.objeciones.map((o) => o.trim().replace(/\.$/, "")).join("; ")}.` : "",
  ].filter(Boolean);
  if (bits.length) {
    const entry = `[${shortDate(meetingDate)} reunión] ${bits.join(" ")}`.slice(0, ENTRY_MAX);
    const existing = clean(current.lastUpdate);
    if (!existing.includes(entry)) {
      out.push({
        key: "lastUpdate",
        label: "Última actualización",
        current: existing,
        proposed: entry,
        mode: existing ? "append" : "fill",
        changes: { lastUpdate: (existing ? `${entry}\n${existing}` : entry).slice(0, MAX_LAST_UPDATE) },
      });
    }
  }

  return out;
}
