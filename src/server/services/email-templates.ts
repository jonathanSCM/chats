// Plantillas HTML para los correos transaccionales (Resend). HTML de correo
// clásico con estilos inline y tablas — los clientes de correo no soportan
// CSS moderno ni flexbox/grid de forma confiable.

const BRAND_NAME = "CRM PROSHOP";
const ACCENT = "#7c5cff";
const INK = "#18181b";
const INK_MUTED = "#71717a";
const BORDER = "#e4e4e7";
const SURFACE = "#f4f4f5";

function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "";
}

function layout({
  preheader,
  heading,
  bodyHtml,
  ctaLabel,
  ctaUrl,
}: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}): string {
  const logoUrl = `${baseUrl()}/logo-mark.png`;

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${BRAND_NAME}</title>
  </head>
  <body style="margin:0; padding:0; background:${SURFACE}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE}; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border:1px solid ${BORDER}; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <img src="${logoUrl}" width="36" height="36" alt="${BRAND_NAME}" style="display:block; border-radius:8px;" />
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <h1 style="margin:0 0 12px 0; font-size:20px; line-height:28px; color:${INK}; font-weight:600;">${heading}</h1>
                <div style="font-size:14px; line-height:22px; color:${INK_MUTED};">${bodyHtml}</div>
              </td>
            </tr>
            ${
              ctaLabel && ctaUrl
                ? `<tr>
              <td style="padding:24px 32px 8px 32px;">
                <a href="${ctaUrl}" style="display:inline-block; background:${ACCENT}; color:#ffffff; text-decoration:none; font-size:14px; font-weight:600; padding:10px 20px; border-radius:8px;">${ctaLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 32px 28px 32px;">
                <p style="margin:0; font-size:12px; line-height:18px; color:${INK_MUTED};">
                  Si el botón no funciona, copia y pega este enlace en tu navegador:<br />
                  <a href="${ctaUrl}" style="color:${ACCENT}; word-break:break-all;">${ctaUrl}</a>
                </p>
              </td>
            </tr>`
                : `<tr><td style="padding-bottom:28px;"></td></tr>`
            }
            <tr>
              <td style="padding:16px 32px; background:${SURFACE}; border-top:1px solid ${BORDER};">
                <p style="margin:0; font-size:12px; line-height:18px; color:${INK_MUTED};">
                  ${BRAND_NAME} es una solución tecnológica operada por Grafi.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function passwordResetEmail({ resetUrl }: { resetUrl: string }) {
  return {
    subject: `Restablece tu contraseña de ${BRAND_NAME}`,
    text: `Entra a este enlace para elegir una nueva contraseña (vence en 1 hora):\n\n${resetUrl}\n\nSi no pediste esto, ignora el mensaje.`,
    html: layout({
      preheader: "Restablece tu contraseña — el enlace vence en 1 hora.",
      heading: "Restablece tu contraseña",
      bodyHtml: `<p style="margin:0 0 8px 0;">Recibimos una solicitud para restablecer tu contraseña. El enlace de abajo vence en <strong>1 hora</strong>.</p><p style="margin:0;">Si no pediste esto, puedes ignorar este correo — tu contraseña actual sigue funcionando.</p>`,
      ctaLabel: "Elegir nueva contraseña",
      ctaUrl: resetUrl,
    }),
  };
}

export function inviteEmail({
  orgName,
  inviteUrl,
}: {
  orgName: string;
  inviteUrl: string;
}) {
  return {
    subject: `Te invitaron a unirte a ${orgName} en ${BRAND_NAME}`,
    text: `Te invitaron a unirte a ${orgName} en ${BRAND_NAME}. Entra a este enlace para crear tu cuenta (vence en 7 días):\n\n${inviteUrl}`,
    html: layout({
      preheader: `Te invitaron a unirte a ${orgName} en ${BRAND_NAME}.`,
      heading: `Te invitaron a unirte a ${orgName}`,
      bodyHtml: `<p style="margin:0;">Alguien de <strong>${orgName}</strong> te invitó a unirte a su equipo en ${BRAND_NAME}. El enlace vence en <strong>7 días</strong>.</p>`,
      ctaLabel: "Crear mi cuenta",
      ctaUrl: inviteUrl,
    }),
  };
}
