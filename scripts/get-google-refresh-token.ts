import "dotenv/config";
import http from "node:http";
import { google } from "googleapis";

// Trámite de una sola vez: autoriza a la cuenta de Google del bot y
// devuelve el refresh_token que va a GOOGLE_BOT_REFRESH_TOKEN. No hace
// falta correrlo de nuevo salvo que alguien revoque el acceso desde
// https://myaccount.google.com/permissions.
//
// Uso:
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npx tsx scripts/get-google-refresh-token.ts
// (o cargar esas dos variables en .env antes de correrlo)

const PORT = 53_682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Faltan GOOGLE_CLIENT_ID y/o GOOGLE_CLIENT_SECRET (como variables de entorno o en .env).");
  console.error("Se sacan de Google Cloud Console → APIs y servicios → Credenciales.");
  process.exit(1);
}

// El tipo de credencial "Aplicación de escritorio" acepta este redirect_uri
// de loopback sin tener que registrarlo antes en la consola de Google.
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline", // imprescindible: sin esto Google no manda refresh_token
  prompt: "consent", // fuerza a que lo mande incluso si esta cuenta ya autorizó antes
  scope: ["https://www.googleapis.com/auth/calendar.events"],
});

console.log("\nAbrí este link con la cuenta de Google que va a usar el bot, y aceptá los permisos:\n");
console.log(authUrl);
console.log("\nEsperando a que completes el login en el navegador...\n");

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404).end();
    return;
  }

  const code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<p>No llegó el código de autorización. Cerrá esta pestaña y volvé a intentar.</p>");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<p>Listo, ya podés cerrar esta pestaña y volver a la terminal.</p>");

    console.log("Refresh token (guardalo como GOOGLE_BOT_REFRESH_TOKEN):\n");
    console.log(tokens.refresh_token ?? "(no vino refresh_token — revocá el acceso en https://myaccount.google.com/permissions y corré esto de nuevo)");
    console.log();
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<p>Falló el intercambio del código por el token. Revisá la terminal.</p>");
    console.error("Error al pedir el token:", error);
  } finally {
    server.close();
  }
});

server.listen(PORT);
