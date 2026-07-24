// Envío de correo transaccional (reset de password, verificación, invitaciones)
// vía Resend. La firma de `sendMail` es el único contrato que le importa al
// resto del código — cambiar de proveedor no debería tocar nada fuera de
// este archivo.

import { Resend } from "resend";

interface SendMailParams {
  to: string;
  subject: string;
  text: string;
}

const globalForResend = globalThis as unknown as { resendClient: Resend | undefined };

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!globalForResend.resendClient) {
    globalForResend.resendClient = new Resend(apiKey);
  }
  return globalForResend.resendClient;
}

export async function sendMail({ to, subject, text }: SendMailParams): Promise<void> {
  const client = getClient();

  if (!client) {
    // Sin RESEND_API_KEY configurada: fallback a loguear en consola, para
    // poder probar los flujos completos sin credenciales.
    console.log(
      [
        "",
        "── correo simulado (mailer sin proveedor real) ──",
        `Para:    ${to}`,
        `Asunto:  ${subject}`,
        "",
        text,
        "──────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return;
  }

  const from = process.env.MAIL_FROM ?? "onboarding@resend.dev";

  const { error } = await client.emails.send({
    from,
    to,
    subject,
    text,
  });

  if (error) {
    console.error("[mailer] Error enviando correo con Resend:", error);
    throw new Error(`No se pudo enviar el correo: ${error.message}`);
  }
}
