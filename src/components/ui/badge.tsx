import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "warning" | "danger";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-muted border-border-strong",
  accent: "bg-accent/10 text-accent border-accent-dim/50",
  warning: "bg-warning/10 text-warning border-warning/40",
  danger: "bg-danger/10 text-danger border-danger/40",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}

export function StatusDot({ tone = "neutral" }: { tone?: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-ink-faint",
    accent: "bg-accent animate-pulse-dot",
    warning: "bg-warning",
    danger: "bg-danger",
  };
  return <span className={cn("h-1.5 w-1.5 rounded-full", colors[tone])} />;
}
