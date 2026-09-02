import { Clock, Loader2, Video, CheckCircle2, AlertTriangle, type LucideIcon } from "lucide-react";

// Estado del bot de grabación (independiente del estado comercial de la
// reunión) — null significa que no se pidió que el bot se una. Se puede
// pedir que se retire (botón "Detener bot") mientras está en cualquiera de
// los tres primeros estados — una vez que llegó a TRANSCRIBING ya se fue
// solo, no hay nada que cortar.
export const BOT_STATUS_CONFIG: Record<
  string,
  { label: string; icon: LucideIcon; className: string; canStop: boolean }
> = {
  PENDING: { label: "Se va a unir", icon: Clock, className: "bg-surface-2 text-ink-muted", canStop: true },
  JOINING: { label: "Entrando…", icon: Loader2, className: "bg-accent-dim/20 text-accent", canStop: true },
  RECORDING: { label: "Grabando", icon: Video, className: "bg-danger/15 text-danger", canStop: true },
  TRANSCRIBING: {
    label: "Transcribiendo…",
    icon: Loader2,
    className: "bg-accent-dim/20 text-accent",
    canStop: false,
  },
  DONE: { label: "Transcripción lista", icon: CheckCircle2, className: "bg-accent-dim/20 text-accent", canStop: false },
  FAILED: { label: "Falló — revisar a mano", icon: AlertTriangle, className: "bg-danger/15 text-danger", canStop: false },
};
