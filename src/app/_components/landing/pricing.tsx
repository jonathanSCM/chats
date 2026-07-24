import Link from "next/link";
import { Check } from "lucide-react";
import { prisma } from "@/server/db/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const currency = new Intl.NumberFormat("es", { style: "currency", currency: "USD" });

export async function Pricing() {
  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { priceCents: "asc" },
  });

  return (
    <section id="precios" className="mx-auto max-w-5xl px-6 py-20">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">Precios</p>
      <h2 className="mb-12 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Planes simples, sin sorpresas.
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {plans.map((plan, i) => {
          const featured = i === 1;
          return (
            <div
              key={plan.id}
              className={cn(
                "rounded-lg border p-6",
                featured ? "border-accent bg-accent" : "border-border bg-surface",
              )}
            >
              <p
                className={cn(
                  "mb-2 font-mono text-[11px] uppercase tracking-wide",
                  featured ? "text-accent-ink/70" : "text-ink-faint",
                )}
              >
                {plan.name}
              </p>
              <p
                className={cn(
                  "mb-5 font-display text-4xl font-bold",
                  featured ? "text-accent-ink" : "text-ink",
                )}
              >
                {currency.format(plan.priceCents / 100)}
                <span
                  className={cn(
                    "text-base font-normal",
                    featured ? "text-accent-ink/70" : "text-ink-faint",
                  )}
                >
                  /mes
                </span>
              </p>

              <ul
                className={cn(
                  "mb-6 space-y-2 text-sm",
                  featured ? "text-accent-ink/80" : "text-ink-muted",
                )}
              >
                <li className="flex items-center gap-2">
                  <Check size={14} className="shrink-0" />
                  {plan.conversationLimit.toLocaleString("es")} conversaciones/mes
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="shrink-0" />
                  Modelo {plan.aiModel}
                </li>
                <li className="flex items-center gap-2">
                  <Check size={14} className="shrink-0" />
                  Bots ilimitados
                </li>
              </ul>

              <Link href={`/signup?plan=${plan.id}`}>
                <Button
                  variant="secondary"
                  className={cn(
                    "w-full",
                    featured && "border-transparent bg-accent-ink text-ink hover:brightness-125",
                  )}
                >
                  Empieza gratis
                </Button>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
