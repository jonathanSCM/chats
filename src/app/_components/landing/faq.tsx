import { Plus } from "lucide-react";

const faqs = [
  {
    question: "¿Necesito saber programar para configurarlo?",
    answer: "No. Conectas tu WhatsApp, subes tu catálogo y el bot queda listo — sin código.",
  },
  {
    question: "¿Qué pasa si el bot no puede resolver algo?",
    answer:
      "Puedes revisar el historial completo de cada conversación en tu panel. El traspaso automático a un agente humano está en camino.",
  },
  {
    question: "¿Puedo cambiar de plan después?",
    answer: "Sí, en cualquier momento desde tu panel — el cambio aplica de inmediato.",
  },
  {
    question: "¿Funciona con WhatsApp Business normal?",
    answer:
      "Se conecta mediante WhatsApp Cloud API, la plataforma oficial de Meta para negocios — no la app gratuita de WhatsApp Business.",
  },
  {
    question: "¿Hay periodo de prueba?",
    answer: "Sí, 14 días sin necesidad de tarjeta.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">
        Preguntas frecuentes
      </p>
      <h2 className="mb-10 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Lo que preguntan antes de empezar.
      </h2>

      <div className="divide-y divide-border border-t border-border">
        {faqs.map((faq, i) => (
          <details key={faq.question} className="group py-5" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold text-ink">
              {faq.question}
              <Plus
                size={16}
                className="shrink-0 text-accent transition-transform group-open:rotate-45"
              />
            </summary>
            <p className="mt-3 text-sm text-ink-muted">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
