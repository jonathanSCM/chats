import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 pt-16 pb-20">
      <div className="mx-auto max-w-2xl text-center animate-fade-up">
        <p className="mb-4 font-mono text-xs uppercase tracking-widest text-accent">
          Bots de venta · WhatsApp Business
        </p>
        <h1 className="mb-6 font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
          Tu catálogo, vendiendo solo en WhatsApp.
        </h1>
        <p className="mx-auto mb-8 max-w-lg text-ink-muted">
          Zócalo conecta tu catálogo con un bot que responde, cotiza y cierra ventas 24/7 — sin
          que escribas un mensaje.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/signup">
            <Button>
              Empieza gratis <ArrowRight size={16} />
            </Button>
          </Link>
          <a href="#precios">
            <Button variant="secondary">Ver planes</Button>
          </a>
        </div>
      </div>

      <div className="corner-brackets mx-auto mt-16 max-w-2xl overflow-hidden rounded-lg border border-border bg-surface">
        <Image
          src="/images/hero-catalog.png"
          alt="Catálogo de productos abierto en WhatsApp desde un teléfono"
          width={1200}
          height={896}
          priority
          className="w-full h-auto"
        />
      </div>
    </section>
  );
}
