import { Zap, Infinity as InfinityIcon, RefreshCw, UserRound, BarChart3, Wrench } from "lucide-react";

const features = [
  {
    icon: Zap,
    label: "Respuesta",
    title: "Responde en segundos",
    description: "Tus clientes no esperan minutos por una cotización.",
  },
  {
    icon: InfinityIcon,
    label: "Disponibilidad",
    title: "Nunca duerme",
    description: "Vende de madrugada, fin de semana o feriado igual.",
  },
  {
    icon: RefreshCw,
    label: "Catálogo",
    title: "Siempre actualizado",
    description: "Cambia precios o stock y el bot lo refleja al instante.",
  },
  {
    icon: UserRound,
    label: "Humano",
    title: "Escala a un humano",
    description: "Si el bot no puede resolver algo, pasa la conversación a tu equipo.",
  },
  {
    icon: BarChart3,
    label: "Métricas",
    title: "Datos claros",
    description: "Ventas, chats y tasa de cierre en un panel, sin hojas de cálculo.",
  },
  {
    icon: Wrench,
    label: "Setup",
    title: "Sin desarrolladores",
    description: "Lo configura cualquier persona del negocio en minutos.",
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">Por qué Zócalo</p>
      <h2 className="mb-12 max-w-lg font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Hecho para vender rápido, no para impresionar.
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.label} className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-border">
              <feature.icon size={18} className="text-accent" />
            </div>
            <p className="mb-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-faint">
              {feature.label}
            </p>
            <h3 className="mb-1.5 font-display text-base font-semibold text-ink">
              {feature.title}
            </h3>
            <p className="text-sm text-ink-muted">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
