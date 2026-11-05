import Link from "next/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Política de privacidad — CRM ProShop" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link href="/" className="mb-8 inline-block">
        <Logo brandName="CRM ProShop" />
      </Link>

      <h1 className="mb-2 text-2xl font-bold text-ink">
        Política de privacidad
      </h1>
      <p className="mb-4 text-sm text-ink-faint">
        Última actualización: {new Date().toLocaleDateString("es")}
      </p>
      <div className="mb-10 flex items-center gap-3 rounded-md border border-border bg-surface-2/60 px-4 py-3 text-sm text-ink-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/grafi-logo.webp" alt="Grafi" width={28} height={28} className="shrink-0 rounded-md" />
        <p>
          CRM ProShop es una solución tecnológica operada por <strong className="text-ink">Grafi</strong>.
        </p>
      </div>

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

        <Section title="Datos de tu cuenta de Google (Google Calendar)">
          <p>
            Solo si conectas tu Google Calendar desde tu perfil, CRM ProShop accede a tu cuenta de Google con tu
            autorización para lo siguiente:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink">Qué datos usamos:</strong> tu dirección de correo de Google (para identificar
              la cuenta conectada) y los eventos de tu calendario relacionados con las reuniones agendadas desde el CRM
              (título, fecha, hora, invitados y enlace de Google Meet).
            </li>
            <li>
              <strong className="text-ink">Para qué:</strong> crear, modificar y cancelar esas reuniones en tu calendario
              y reflejar en el CRM los cambios que hagas en ellas desde Google Calendar. No usamos tus datos de Google
              para publicidad ni para ningún otro fin.
            </li>
            <li>
              <strong className="text-ink">Dónde se guardan:</strong> las credenciales de acceso se almacenan cifradas en
              nuestros servidores; los datos de las reuniones se guardan en tu organización dentro del CRM.
            </li>
            <li>
              <strong className="text-ink">Con quién se comparten:</strong> no los vendemos ni los compartimos con
              terceros, salvo con las personas que invitas a cada reunión y con los proveedores indicados arriba, y solo
              cuando es necesario para operar el servicio o lo exige la ley.
            </li>
            <li>
              <strong className="text-ink">Cómo desconectarte:</strong> desde tu perfil en el CRM, o revocando el acceso
              en{" "}
              <a
                href="https://myaccount.google.com/permissions"
                className="underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                myaccount.google.com/permissions
              </a>
              . Al desconectar, dejamos de acceder a tu calendario.
            </li>
          </ul>
          <p className="mt-2">
            El uso y la transferencia a cualquier otra aplicación de la información que recibimos de las API de Google se
            ajustarán a la{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              Política de datos de usuario de los servicios de las API de Google
            </a>
            , incluidos los requisitos de uso limitado.
          </p>
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
          <p>
            Preguntas sobre privacidad:{" "}
            <a href="mailto:proshop.soporte@gmail.com" className="underline">
              proshop.soporte@gmail.com
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
