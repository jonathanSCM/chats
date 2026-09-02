import type { Page } from "playwright";

const CAPTIONS_POLL_MS = 2_000;

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
    return true;
  } catch (error) {
    console.warn("[meeting-bot] No se pudo activar los subtítulos (se sigue sin nombres de quién habló):", error);
    return false;
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
export function startCapturingCaptions(page: Page): CaptionsCapture {
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
          /se activaron|se desactivaron|se agregó|se quitó|está en la pantalla principal|solicitó unirse|se unió a la|abandonó la llamada|comenzó a compartir|dejó de compartir|silenciad[oa]/i;

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

      // Filtro de sanidad: un match de subtítulos real tiene una frase
      // completa, no una o dos palabras sueltas (que es lo que da un
      // elemento de UI equivocado, como pasó con "settings").
      if (debug.best && debug.best.length >= 15 && debug.best !== lastRaw) {
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
