import { chromium } from "playwright";

const PROFILE_DIR = process.env.CHROME_PROFILE_DIR || "/data/chrome-profile";

/**
 * Trámite de una sola vez: abre Chrome con el perfil persistente (vacío la
 * primera vez) para loguearse a mano con la cuenta de Google del bot. Una
 * vez logueada, la sesión queda guardada en PROFILE_DIR — de ahí en más
 * `join-meeting.ts` la reusa sin volver a pedir contraseña (salvo que
 * alguien la revoque desde la cuenta de Google).
 *
 * Correr con pantalla real (`npm run login` en una máquina con monitor, o
 * por VNC al contenedor) — game over si se corre headless, no se puede
 * tipear la contraseña/2FA.
 */
async function main() {
  console.log(`Perfil: ${PROFILE_DIR}`);
  console.log("Se abre Chrome — logueate con la cuenta de Google del bot y dejala en accounts.google.com.");
  console.log("Cuando termines, cerrá la ventana de Chrome para terminar.");

  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false });
  const page = await context.newPage();
  await page.goto("https://accounts.google.com");

  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
  });

  console.log("Listo — la sesión quedó guardada en el perfil persistente.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
