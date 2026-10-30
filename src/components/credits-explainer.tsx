import {
  CREDITS_PER_USER,
  CREDIT_PACKS,
  CREDIT_USD,
  EMERGENCY_RESERVE,
  FEATURE_CREDITS,
  PACK_VALID_DAYS,
  creditEquivalents,
  formatCredits,
  suggestedMonthlyCredits,
} from "@/lib/ai-credits";

/** "8.000 créditos = US$ 8,00 de presupuesto de IA ≈ …": para entender cuánto es una cantidad de créditos. */
export function CreditsEquivalence({ credits }: { credits: number }) {
  if (!Number.isFinite(credits) || credits <= 0) return null;
  const e = creditEquivalents(credits);
  return (
    <p className="text-xs text-ink-faint">
      {formatCredits(credits)} créditos = US$ {e.usd.toFixed(2).replace(".", ",")} de presupuesto de IA. Eso alcanza para, por ejemplo,{" "}
      {formatCredits(e.botReplies)} respuestas del bot, o {formatCredits(e.analyses)} análisis de seguimiento, o{" "}
      {formatCredits(e.meetingSummaries)} resúmenes de reunión con IA (o una mezcla de todo).
    </p>
  );
}

/**
 * Explicación, para el superadmin, de cómo se calculan los créditos de IA por mes: qué es un crédito, cuánto cuesta cada
 * función, cómo se gasta la bolsa y qué pasa al acabarse. Los números salen de las mismas constantes que usa el sistema.
 */
export function CreditsExplainer({ monthly }: { monthly?: number | null }) {
  const features = Object.values(FEATURE_CREDITS);
  const example = monthly && monthly > 0 ? monthly : suggestedMonthlyCredits(5);
  return (
    <details className="group rounded-lg border border-border bg-surface-2/40 p-4 text-sm">
      <summary className="cursor-pointer select-none font-medium text-ink marker:text-ink-faint">
        ¿Cómo se calculan los créditos de IA por mes?
      </summary>
      <div className="mt-4 space-y-5 text-ink-muted">
        <section className="space-y-1.5">
          <h4 className="font-medium text-ink">1. Qué es un crédito</h4>
          <p>
            Un crédito es una unidad comercial: <b className="text-ink">1 crédito = hasta US$ {String(CREDIT_USD).replace(".", ",")}</b> de
            presupuesto de IA. No es el costo exacto de cada llamada a OpenAI (el costo real casi siempre es menor); el crédito también cubre
            tu infraestructura y tu margen. El cliente ve créditos, no tokens ni dólares.
          </p>
        </section>

        <section className="space-y-1.5">
          <h4 className="font-medium text-ink">2. Cuánto es la bolsa del mes</h4>
          <p>
            Los créditos por mes son <b className="text-ink">una sola bolsa para toda la organización</b>, no por usuario. Como referencia para
            dimensionar un plan se usa <b className="text-ink">usuarios × {formatCredits(CREDITS_PER_USER)}</b> (por ejemplo, 5 usuarios ={" "}
            {formatCredits(suggestedMonthlyCredits(5))}), pero es solo una guía: tú pones el número que quieras en el plan.
          </p>
          <div className="rounded-md border border-border bg-surface p-3">
            <CreditsEquivalence credits={example} />
          </div>
        </section>

        <section className="space-y-1.5">
          <h4 className="font-medium text-ink">3. Cuánto gasta cada función</h4>
          <p>Cada vez que se usa una función de IA se descuenta una cantidad fija de créditos:</p>
          <ul className="space-y-1">
            {features.map((f) => (
              <li key={f.label} className="flex justify-between gap-3 border-b border-border/60 pb-1 last:border-0">
                <span>{f.label}</span>
                <span className="font-medium text-ink">{f.credits === 0 ? "gratis" : f.credits}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint">
            La transcripción de reuniones no gasta créditos (corre en tu servidor); los minutos igual quedan registrados. Lo que sí gasta es el
            resumen con IA de la reunión. Cualquier función de IA nueva sin precio definido cuesta 1 crédito.
          </p>
        </section>

        <section className="space-y-1.5">
          <h4 className="font-medium text-ink">4. Cómo se va gastando</h4>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Primero se gasta la <b className="text-ink">bolsa mensual</b> y después los <b className="text-ink">paquetes comprados</b> (el que vence
              antes primero). Los paquetes duran {PACK_VALID_DAYS} días y se pueden cargar a mano en cada organización:{" "}
              {CREDIT_PACKS.map((p) => `${formatCredits(p.credits)} por S/ ${p.priceSoles}`).join(", ")}.
            </li>
            <li>La bolsa mensual se renueva cada mes (calendario UTC) y lo que sobra <b className="text-ink">no se acumula</b>.</li>
            <li>
              Solo gastan créditos las llamadas de IA que usan la <b className="text-ink">clave de la plataforma</b>. Con clave propia o
              personalizada de la organización no se cobran créditos.
            </li>
            <li>Una suborganización gasta de la bolsa de su organización principal.</li>
          </ul>
        </section>

        <section className="space-y-1.5">
          <h4 className="font-medium text-ink">5. Qué pasa cuando se acaban</h4>
          <ul className="list-disc space-y-1 pl-5">
            <li>Al 80% y al 95% el dueño ve un aviso en su panel; al llegar a 0 el aviso es rojo.</li>
            <li>
              El CRM sigue funcionando (contactos, pipeline, notas, tareas) y el asistente sigue grabando y transcribiendo. Se detienen las funciones
              de IA (análisis, editor de conocimiento y resúmenes de reunión).
            </li>
            <li>
              El bot de WhatsApp tiene una reserva de emergencia de <b className="text-ink">{EMERGENCY_RESERVE} créditos</b> para no dejar a un cliente sin
              respuesta de golpe. Cuando también se acaba, la conversación pasa a una persona del equipo con un aviso.
            </li>
          </ul>
        </section>

        <p className="text-xs text-ink-faint">
          En cada organización (pestaña Plan y créditos) ves cuánto gastó de verdad en la API frente a los créditos que consumió, para ajustar los
          planes con datos reales.
        </p>
      </div>
    </details>
  );
}
