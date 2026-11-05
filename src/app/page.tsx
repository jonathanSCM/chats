import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { Logo } from "@/components/logo";

const PRODUCT_NAME = "CRM ProShop";
const SUPPORT_EMAIL = "proshop.soporte@gmail.com";

export const metadata = {
  title: `${PRODUCT_NAME} — CRM con WhatsApp e inteligencia artificial para equipos de ventas`,
  description: `${PRODUCT_NAME} es un CRM para equipos comerciales: bandeja compartida de WhatsApp Business, seguimiento de oportunidades, reuniones con Google Calendar y Meet, y un asistente de IA.`,
};

// Página pública (sin inicio de sesión): Google la revisa para verificar la app y la ven los clientes.
// Quien ya tiene sesión entra directo al panel.
export default async function RootPage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-14 flex items-center justify-between gap-4">
        <Logo brandName="CRM ProShop" />
        <Link
          href="/login"
          className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink shadow-sm hover:brightness-110"
        >
          Iniciar sesión
        </Link>
      </header>

      <h1 className="mb-4 text-3xl font-bold text-ink">{PRODUCT_NAME}</h1>
      <p className="mb-10 text-base leading-relaxed text-ink-muted">
        {PRODUCT_NAME} es un CRM para equipos comerciales. Reúne en un solo lugar las conversaciones de WhatsApp
        Business de tus clientes, el seguimiento de cada oportunidad de venta, las reuniones y un asistente de
        inteligencia artificial que recomienda el siguiente paso. Quien conversa y decide siempre es el vendedor.
      </p>

      <div className="space-y-8 text-sm leading-relaxed text-ink-muted">
        <section>
          <h2 className="mb-2 font-display text-lg font-semibold text-ink">Qué hace</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Bandeja compartida de WhatsApp Business: varias personas atienden el mismo número en tiempo real.</li>
            <li>Seguimiento de clientes y oportunidades, con próximas acciones, alertas y reportes.</li>
            <li>Agenda de reuniones con enlace de Google Meet, grabación y resumen con IA.</li>
            <li>Un asistente de IA que califica a quienes escriben y sugiere cómo avanzar cada venta.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 font-display text-lg font-semibold text-ink">Cómo usamos Google Calendar</h2>
          <p>
            Si decides conectar tu cuenta de Google desde tu perfil, {PRODUCT_NAME} usa tu Google Calendar únicamente
            para crear, modificar y cancelar las reuniones que agendas con tus clientes desde el CRM (con su enlace de
            Google Meet) y para reflejar en el CRM los cambios que hagas en esas reuniones desde Google Calendar. No
            usamos el resto de tu agenda para ningún otro fin, no vendemos esos datos y puedes desconectar tu cuenta
            cuando quieras desde tu perfil o revocar el acceso en{" "}
            <a
              href="https://myaccount.google.com/permissions"
              className="text-accent underline"
              rel="noopener noreferrer"
              target="_blank"
            >
              tu cuenta de Google
            </a>
            . Más detalle en la{" "}
            <Link href="/privacy" className="text-accent underline">
              política de privacidad
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-display text-lg font-semibold text-ink">Contacto</h2>
          <p>
            Escríbenos a{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>

      <footer className="mt-14 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm text-ink-faint">
        <Link href="/privacy" className="hover:text-ink">
          Política de privacidad
        </Link>
        <Link href="/terms" className="hover:text-ink">
          Términos de servicio
        </Link>
        <Link href="/login" className="hover:text-ink">
          Iniciar sesión
        </Link>
      </footer>
    </main>
  );
}
