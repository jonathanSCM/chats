import type { Page } from "playwright";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const CAPTIONS_POLL_MS = 2_000;
const DEBUG_DIR = path.join(process.env.RECORDINGS_DIR || "/tmp/recordings", "debug");

/**
 * Activa los subtítulos en vivo de Meet — es la única forma práctica de
 * conseguir "quién dijo qué" (Whisper por sí solo no distingue hablantes,
 * y armar diarización de audio es mucho más complejo). Selector tolerante
 * a fallo, como el resto de los botones de Meet en este bot: si no lo
 * encuentra, se sigue igual sin subtítulos — la app cae al fallback de
 * transcribir el audio con Whisper (sin nombres) cuando alguien lo pida.
 */
export async function enableCaptions(page: Page): Promise<boolean> {
  try {
    const button = page.getByRole("button", { name: /subtítulos|activar los subtítulos|captions|turn on captions/i });
    await button.click({ timeout: 10_000 });
    console.log("[meeting-bot] Subtítulos activados.");

    // Causa real encontrada con un volcado de accesibilidad: al activar los
    // subtítulos, Meet abre un selector de "Idioma de la reunión" que por
    // defecto queda en Inglés — con la reunión en español, Meet intentaba
    // transcribir audio en español como si fuera inglés, y por eso nunca
    // salía texto real. Hay que elegir español a mano.
    await selectSpanishCaptionLanguage(page);

    // El selector de idioma queda abierto como un panel — hay que cerrarlo
    // para que la barra de subtítulos real quede visible y generando texto.
    await page.keyboard.press("Escape").catch(() => {});

    return true;
  } catch (error) {
    console.warn("[meeting-bot] No se pudo activar los subtítulos (se sigue sin nombres de quién habló):", error);
    return false;
  }
}

async function selectSpanishCaptionLanguage(page: Page): Promise<void> {
  try {
    const languageCombobox = page.getByRole("combobox", { name: /idioma de la reunión|meeting language/i });
    await languageCombobox.click({ timeout: 5_000 });

    const spanishOption = page
      .getByRole("option", { name: /español \(méxico\)/i })
      .or(page.getByRole("option", { name: /español/i }));
    await spanishOption.first().click({ timeout: 5_000 });
    console.log("[meeting-bot] Idioma de subtítulos puesto en español.");
  } catch (error) {
    console.warn(
      "[meeting-bot] No se pudo poner los subtítulos en español (puede haber quedado en otro idioma):",
      error,
    );
  }
}

export interface CaptionsCapture {
  /** Corta el polling y devuelve el texto acumulado, "Nombre: lo que dijo" por línea. */
  stop: () => string;
}

/**
 * Lee el panel de subtítulos de Meet cada pocos segundos y arma líneas de
 * texto. Es, con diferencia, la parte más frágil de todo el bot — el
 * selector del contenedor de subtítulos es una suposición razonable sobre
 * la estructura actual de Meet, no algo confirmado contra capturas reales
 * todavía; puede necesitar ajuste apenas se pruebe contra una reunión de
 * verdad (mismo criterio que ya se usó para el botón de unirse y el chat:
 * mejor esfuerzo, con logs claros para poder corregir el selector viendo
 * capturas de debug, sin bloquear el resto del flujo si falla).
 *
 * Estrategia: Meet va actualizando la ÚLTIMA línea mientras la persona
 * sigue hablando (no agrega una línea nueva por cada palabra) — así que
 * recién se guarda una línea como "terminada" cuando el texto visible
 * cambia a algo distinto (cambió de hablante, o pasó a una línea nueva).
 */
export function startCapturingCaptions(page: Page, meetingId: string): CaptionsCapture {
  const lines: string[] = [];
  let lastRaw = "";
  let stopped = false;
  let ticks = 0;

  async function tick(): Promise<void> {
    if (stopped) return;
    ticks += 1;
    try {
      const debug = await page.evaluate(() => {
        // Meet tiene VARIAS regiones `[aria-live]` en la misma página — al
        // menos una es el panel real de subtítulos, y otra es un anunciador
        // genérico de accesibilidad ("Se activaron los subtítulos", "Se
        // agregó el video de Fulano a la pantalla principal"...), que suele
        // tener frases MÁS largas que una línea de subtítulo real y por eso
        // "gana" si solo se compara por longitud. Se prioriza el aria-label
        // específico de subtítulos; solo si no aparece ninguno se cae al
        // barrido genérico, filtrando primero las frases de anuncios
        // conocidas de Meet (no son diálogo real).
        const ANNOUNCEMENT_PATTERNS =
          /se activaron|se desactivaron|se agregó|se quitó|está en la pantalla principal|solicitó unirse|se unió a la|abandonó la llamada|comenzó a compartir|dejó de compartir|silenciad[oa]|volverá a la pantalla principal|quedan \d+ segundos/i;

        const labeled = Array.from(
          document.querySelectorAll<HTMLElement>('[aria-label*="Subtítulos" i], [aria-label*="captions" i]'),
        );
        for (const el of labeled) {
          const text = el.innerText?.trim() ?? "";
          if (text && !ANNOUNCEMENT_PATTERNS.test(text)) {
            return { count: labeled.length, best: text, source: "aria-label" };
          }
        }

        const regions = Array.from(document.querySelectorAll<HTMLElement>("[aria-live]"));
        let best = "";
        for (const region of regions) {
          const text = region.innerText?.trim() ?? "";
          if (text && !ANNOUNCEMENT_PATTERNS.test(text) && text.length > best.length) best = text;
        }
        return { count: regions.length, best, source: "aria-live" };
      });

      // Log cada ~20s (no en cada tick de 2s, sería demasiado) — para saber
      // qué está encontrando el selector, aunque el texto sea muy corto
      // para aceptarlo.
      if (ticks % 10 === 0) {
        console.log(
          `[meeting-bot] Subtítulos — ${debug.count} región(es) (${debug.source}), mejor texto: "${debug.best.slice(0, 80)}"`,
        );
      }

      // Volcado completo de accesibilidad cada ~40s — a diferencia del que
      // se saca una sola vez al activar los subtítulos (cuando todavía no
      // habló nadie y el panel real está vacío), este se repite mientras
      // dura la reunión, así hay chances reales de agarrar uno con diálogo
      // de verdad adentro del panel de subtítulos para poder identificarlo.
      if (ticks % 20 === 0) void dumpAccessibilityTree(page, meetingId, ticks);

      // Filtro de sanidad: un match de subtítulos real tiene una frase
      // completa, no una o dos palabras sueltas ni una fecha de calendario
      // (elementos de UI equivocados que ya se colaron con umbrales más
      // bajos — "settings", "septiembre 2026").
      if (debug.best && debug.best.length >= 25 && debug.best !== lastRaw) {
        if (lastRaw) lines.push(lastRaw);
        lastRaw = debug.best;
      }
    } catch {
      // La página puede no estar lista, o haberse cerrado — se ignora, reintenta en el próximo tick.
    }

    if (!stopped) setTimeout(() => void tick(), CAPTIONS_POLL_MS);
  }

  void tick();

  return {
    stop(): string {
      stopped = true;
      if (lastRaw && lines[lines.length - 1] !== lastRaw) lines.push(lastRaw);
      return lines.join("\n");
    },
  };
}

async function dumpAccessibilityTree(page: Page, meetingId: string, ticks: number): Promise<void> {
  try {
    await mkdir(DEBUG_DIR, { recursive: true });
    const nodes = await page.evaluate(() => {
      const elements = Array.from(
        document.querySelectorAll("[role], [aria-label], [aria-live], [jsname]"),
      ) as HTMLElement[];
      return elements.slice(0, 400).map((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        ariaLive: el.getAttribute("aria-live"),
        jsname: el.getAttribute("jsname"),
        text: (el.innerText || "").trim().slice(0, 200),
      }));
    });
    const file = path.join(DEBUG_DIR, `${meetingId}-subtitulos-tick${ticks}-a11y.json`);
    await writeFile(file, JSON.stringify(nodes, null, 2));
    console.log(`[meeting-bot] Volcado de accesibilidad en vivo (${nodes.length} elementos): ${file}`);
  } catch (error) {
    console.warn("[meeting-bot] No se pudo volcar el árbol de accesibilidad en vivo:", error);
  }
}
