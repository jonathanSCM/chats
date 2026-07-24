import Link from "next/link";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section id="cta" className="mx-auto max-w-5xl px-6 pb-20">
      <div className="corner-brackets rounded-lg border border-border bg-surface px-6 py-16 text-center">
        <h2 className="mx-auto mb-4 max-w-lg font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Empieza a vender por WhatsApp esta semana.
        </h2>
        <p className="mb-8 text-ink-muted">
          Sin tarjeta de crédito. Configura tu bot en menos de 15 minutos.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/signup">
            <Button>Empieza gratis</Button>
          </Link>
          <a href="#precios">
            <Button variant="secondary">Ver planes</Button>
          </a>
        </div>
      </div>
    </section>
  );
}
