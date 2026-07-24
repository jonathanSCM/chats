import Image from "next/image";

const steps = [
  {
    number: "01",
    title: "Conecta tu WhatsApp",
    description: "Vincula tu número de WhatsApp Business en un par de clics, sin instalar nada.",
  },
  {
    number: "02",
    title: "Sube tu catálogo",
    description: "Importa productos y precios — el bot los usa para responder y cotizar al instante.",
  },
  {
    number: "03",
    title: "Tu bot vende 24/7",
    description: "Responde dudas, cotiza y cierra pedidos mientras tú atiendes lo demás.",
  },
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="mx-auto max-w-5xl px-6 py-20">
      <div className="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">
            Cómo funciona
          </p>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Tres pasos y tu bot está vendiendo.
          </h2>
        </div>
        <p className="self-end text-ink-muted">
          Sin curva de aprendizaje: si sabes usar WhatsApp, sabes usar Zócalo. Conecta, sube tu
          catálogo y el bot empieza a responder de inmediato — desde tu teléfono, sin instalar
          software adicional.
        </p>
      </div>

      <div className="corner-brackets mb-12 overflow-hidden rounded-lg border border-border bg-surface">
        <Image
          src="/images/how-it-works-flow.png"
          alt="Flujo: el bot toma el catálogo y lo entrega dentro de la conversación de WhatsApp"
          width={1672}
          height={941}
          className="w-full h-auto"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {steps.map((step) => (
          <div key={step.number} className="rounded-lg border border-border bg-surface p-5">
            <p className="mb-3 font-mono text-sm text-accent">{step.number}</p>
            <h3 className="mb-1.5 font-display text-base font-semibold text-ink">{step.title}</h3>
            <p className="text-sm text-ink-muted">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
