import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Términos de servicio — WhatsApp ProShop" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="mb-8 inline-block">
        <Logo />
      </Link>

      <h1 className="mb-2 font-display text-3xl font-bold tracking-tight text-ink">
        Términos de servicio
      </h1>
      <p className="mb-4 text-sm text-ink-faint">Última actualización: {new Date().toLocaleDateString("es")}</p>
      <p className="mb-10 rounded-md border border-border bg-surface-2/60 px-4 py-3 text-sm text-ink-muted">
        CRM PROSHOP es una solución tecnológica operada por <strong className="text-ink">Grafi</strong>.
      </p>

      <div className="space-y-8 text-sm leading-relaxed text-ink-muted">
        <Section title="1. Qué es WhatsApp ProShop">
          <p>
            WhatsApp ProShop es una plataforma que te permite crear y operar bots de ventas para WhatsApp
            Business, conectados a tu catálogo de productos y a un modelo de inteligencia
            artificial de terceros para generar respuestas automáticas.
          </p>
        </Section>

        <Section title="2. Tu cuenta">
          <p>
            Eres responsable de la información que ingresas, de mantener segura tu contraseña, y
            de todo lo que ocurra bajo tu cuenta. Si invitas a otras personas a tu organización,
            eres responsable de gestionar su acceso.
          </p>
        </Section>

        <Section title="3. Planes, cobros y prueba gratuita">
          <p>
            Los planes pagos se facturan por mes de forma recurrente a través de Stripe. Las
            nuevas cuentas inician con un período de prueba sin necesidad de tarjeta; al
            terminar, deberás elegir un plan pago para seguir usando el servicio. Puedes cambiar
            de plan o comprar conversaciones adicionales en cualquier momento desde tu panel.
            Los cobros ya realizados no son reembolsables salvo que la ley aplicable indique lo
            contrario.
          </p>
        </Section>

        <Section title="4. Uso del servicio con WhatsApp y con IA">
          <p>
            Al conectar tu número de WhatsApp Business, autorizas a WhatsApp ProShop a enviar y recibir
            mensajes en tu nombre a través de la API oficial de Meta (WhatsApp Cloud API). El
            contenido de las conversaciones con tus clientes se procesa mediante un proveedor de
            inteligencia artificial externo para generar las respuestas automáticas. Eres
            responsable de que el uso que le das al bot cumpla con las políticas de WhatsApp
            Business y con la legislación de protección al consumidor que te aplique.
          </p>
        </Section>

        <Section title="5. Uso aceptable">
          <p>
            No puedes usar WhatsApp ProShop para enviar spam, contenido ilegal, engañoso, o que viole los
            términos de WhatsApp/Meta. Nos reservamos el derecho de suspender cuentas que
            incumplan esto, o que representen un riesgo de abuso para la plataforma.
          </p>
        </Section>

        <Section title="6. Suspensión y terminación">
          <p>
            Podemos suspender o cancelar tu cuenta por impago, uso indebido, o incumplimiento de
            estos términos. Puedes cancelar tu cuenta en cualquier momento; los datos asociados
            se conservan según lo descrito en la Política de Privacidad.
          </p>
        </Section>

        <Section title="7. Límite de responsabilidad">
          <p>
            El servicio se ofrece &ldquo;tal cual&rdquo;. En la medida permitida por la ley, WhatsApp ProShop no es
            responsable por daños indirectos derivados del uso del servicio, incluyendo ventas
            perdidas por respuestas incorrectas del bot o interrupciones del servicio de
            WhatsApp/Meta u otros terceros de los que dependemos.
          </p>
        </Section>

        <Section title="8. Cambios a estos términos">
          <p>
            Podemos actualizar estos términos; si el cambio es significativo, te avisaremos por
            correo o dentro del panel.
          </p>
        </Section>

        <Section title="9. Contacto">
          <p>Preguntas sobre estos términos: contáctanos por los canales indicados en el sitio.</p>
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
