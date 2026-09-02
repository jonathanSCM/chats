import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const PROFILE_DIR = process.env.CHROME_PROFILE_DIR || "/data/chrome-profile";

const CANDIDATE_PATHS = [
  process.env.LOGIN_BROWSER_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((p): p is string => Boolean(p));

function findBrowser(): string {
  const found = CANDIDATE_PATHS.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "No encontré Edge ni Chrome instalados en las rutas usuales de Windows. " +
        "Definí LOGIN_BROWSER_PATH con la ruta completa al ejecutable y volvé a correr.",
    );
  }
  return found;
}

/**
 * A propósito NO usa Playwright para este paso: Google bloquea el login
 * ("el navegador o la aplicación no son seguros") apenas detecta el
 * protocolo de depuración remota que Playwright activa para poder controlar
 * la pestaña — aunque en el momento del login nada la esté manejando. Acá se
 * abre el navegador exactamente como lo abriría cualquier persona (un doble
 * click), apuntando al mismo perfil que después usa `join-meeting.ts` — ese
 * sí con Playwright, pero ya con la sesión guardada como cookie, sin volver
 * a pasar por la pantalla de login de Google.
 */
async function main() {
  console.log(`Perfil: ${PROFILE_DIR}`);
  const browserPath = findBrowser();
  console.log(`Abriendo: ${browserPath}`);

  const child = spawn(
    browserPath,
    [`--user-data-dir=${PROFILE_DIR}`, "--no-first-run", "https://accounts.google.com"],
    { detached: true, stdio: "ignore" },
  );
  child.unref();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(
    "\nLogueate con la cuenta del bot. Cuando termines, cerrá la ventana del navegador y " +
      "presioná Enter acá para terminar... ",
  );
  rl.close();

  console.log("Listo — la sesión debería haber quedado guardada en el perfil.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
