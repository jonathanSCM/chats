import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Eliminación de datos — CRM PROSHOP" };

export default function DataDeletionPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="mb-8 inline-block">
        <Logo />
      </Link>

      <h1 className="mb-2 font-display text-3xl font-bold tracking-tight text-ink">
        Instrucciones para eliminar tus datos
      </h1>
      <p className="mb-4 text-sm text-ink-faint">
        Última actualización: {new Date().toLocaleDateString("es")}
      </p>
      <div className="mb-10 flex items-center gap-3 rounded-md border border-border bg-surface-2/60 px-4 py-3 text-sm text-ink-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/grafi-logo.webp" alt="Grafi" width={28} height={28} className="shrink-0 rounded-md" />
        <p>
          CRM PROSHOP es una solución tecnológica operada por <strong className="text-ink">Grafi</strong>.
        </p>
      </div>

      <div className="space-y-8 text-sm leading-relaxed text-ink-muted">
        <Section title="Qué datos puedes pedir que eliminemos">
          <p>
            Los datos de tu cuenta y organización (usuarios, contactos, conversaciones de WhatsApp,
            mensajes, notas y oportunidades guardadas en el CRM), y cualquier dato personal que
            hayamos recibido a través de la integración con WhatsApp Business/Meta para operar tu
            bot.
          </p>
        </Section>

        <Section title="Cómo solicitar la eliminación">
          <p>
            Envía un correo a{" "}
            <a href="mailto:soporte@proshop.lat" className="text-accent underline">
              soporte@proshop.lat
            </a>{" "}
            con el asunto <strong className="text-ink">&ldquo;Solicitud de eliminación de datos&rdquo;</strong>,
            indicando el correo o el nombre de la organización asociada a la cuenta que quieres
            eliminar.
          </p>
          <p className="mt-2">
            Si eres el dueño de la organización, también puedes exportar y eliminar tus datos
            directamente desde el panel, en{" "}
            <span className="font-mono text-ink">Organización → Zona de peligro</span>.
          </p>
        </Section>

        <Section title="Tiempo de procesamiento">
          <p>
            Verificamos la solicitud y eliminamos los datos aplicables en un plazo razonable,
            salvo que la ley exija conservarlos por más tiempo (temas contables, de seguridad o
            cumplimiento legal).
          </p>
        </Section>

        <Section title="Contacto">
          <p>
            Preguntas sobre esta página:{" "}
            <a href="mailto:soporte@proshop.lat" className="text-accent underline">
              soporte@proshop.lat
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
