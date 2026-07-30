import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Política de privacidad — WhatsApp ProShop" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="mb-8 inline-block">
        <Logo />
      </Link>

      <div className="mb-8 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-ink">
        <strong>Borrador.</strong> Base razonable para un SaaS de este tipo, pero no reemplaza
        asesoría legal — revísalo con un abogado antes de publicarlo, especialmente si operas
        en jurisdicciones con leyes de protección de datos específicas (GDPR, LGPD, etc.).
      </div>

      <h1 className="mb-2 font-display text-3xl font-bold tracking-tight text-ink">
        Política de privacidad
      </h1>
      <p className="mb-10 text-sm text-ink-faint">
        Última actualización: {new Date().toLocaleDateString("es")}
      </p>

      <div className="space-y-8 text-sm leading-relaxed text-ink-muted">
        <Section title="1. Qué datos recopilamos">
          <p>
            Datos de tu cuenta (nombre, correo, contraseña cifrada), datos de tu organización y
            catálogo de productos, el contenido de las conversaciones de tus clientes con tu
            bot, y datos de uso/facturación asociados a tu suscripción.
          </p>
        </Section>

        <Section title="2. Con quién compartimos datos">
          <p>
            Para operar el servicio, compartimos datos con los siguientes proveedores externos:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink">Meta (WhatsApp Cloud API):</strong> los mensajes de
              tus clientes pasan por la infraestructura de WhatsApp Business para poder
              entregarse.
            </li>
            <li>
              <strong className="text-ink">Proveedor de inteligencia artificial:</strong> el
              contenido de las conversaciones se envía a un modelo de IA de terceros para
              generar las respuestas del bot.
            </li>
            <li>
              <strong className="text-ink">Stripe:</strong> procesa los pagos de tu suscripción;
              no almacenamos los datos de tu tarjeta directamente.
            </li>
          </ul>
        </Section>

        <Section title="3. Por qué usamos estos datos">
          <p>
            Para operar tu bot, cobrar tu suscripción, medir el uso contra los límites de tu
            plan, dar soporte, y mejorar el servicio. No vendemos tus datos a terceros.
          </p>
        </Section>

        <Section title="4. Cuánto tiempo los conservamos">
          <p>
            Mientras tu cuenta esté activa. Si cancelas tu cuenta, conservamos los datos el
            tiempo razonable necesario por temas contables/legales y luego los eliminamos, salvo
            que la ley exija algo distinto.
          </p>
        </Section>

        <Section title="5. Seguridad">
          <p>
            Las contraseñas se guardan cifradas (nunca en texto plano) y los tokens de acceso a
            WhatsApp se cifran en reposo. Ningún sistema es 100% seguro, pero tomamos medidas
            razonables para proteger tu información.
          </p>
        </Section>

        <Section title="6. Tus derechos">
          <p>
            Puedes pedir acceso, corrección o eliminación de tus datos personales contactándonos.
            Si operas bajo una ley de protección de datos específica (GDPR, LGPD u otra), esos
            derechos aplican en la medida que correspondan.
          </p>
        </Section>

        <Section title="7. Cambios a esta política">
          <p>
            Podemos actualizar esta política; los cambios significativos se avisan por correo o
            dentro del panel.
          </p>
        </Section>

        <Section title="8. Contacto">
          <p>Preguntas sobre privacidad: contáctanos por los canales indicados en el sitio.</p>
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
