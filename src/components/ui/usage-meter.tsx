import { cn } from "@/lib/utils";

export function UsageMeter({
  consumed,
  allowed,
  label,
}: {
  consumed: number;
  allowed: number;
  label: string;
}) {
  const pct = allowed > 0 ? Math.min(100, (consumed / allowed) * 100) : 0;
  const critical = pct >= 90;
  const warn = pct >= 70;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-ink-muted">{label}</span>
        <span className="font-mono text-sm text-ink">
          {consumed.toLocaleString("es")} <span className="text-ink-faint">/</span>{" "}
          {allowed.toLocaleString("es")}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            critical ? "bg-danger" : warn ? "bg-warning" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
