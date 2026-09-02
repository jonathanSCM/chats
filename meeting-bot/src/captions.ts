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

    // Al activar los subtítulos, Meet abre un selector de "Idioma de la
    // reunión" que por defecto queda en Inglés — con la reunión en español,
    // Meet intentaba transcribir audio en español como si fuera inglés, y
    // por eso nunca salía texto real. Hay que elegir español a mano.
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
    await languageCombobox.waitFor({ state: "visible", timeout: 5_000 });
    // La barra de subtítulos (siempre visible una vez activada) tapa
    // parcialmente este combobox según el chequeo de Playwright, aunque en
    // los hechos sigue siendo clickeable — se confirmó con un log real
    // ("<div class='iOzk7'>… subtree intercepts pointer events") que sin
    // `force` esto siempre tira timeout y los subtítulos quedan en inglés.
    await languageCombobox.click({ timeout: 5_000, force: true });

    // Confirmado con un volcado real: la lista completa de ~140 idiomas
    // (incluido "Español (México)") sí está en el DOM apenas se abre el
    // listbox, pero está lejos en la lista alfabética -- Playwright no la
    // considera "visible" hasta hacerle scroll dentro del propio listbox
    // (algo que el `force` del clic anterior se saltea). Por eso primero se
    // confirma que el listbox en sí abrió, y recién ahí se busca la opción
    // adentro y se le hace scroll a mano antes de clickearla.
    const listbox = page.getByRole("listbox", { name: /idioma de la reunión|meeting language/i });
    await listbox.waitFor({ state: "visible", timeout: 8_000 });

    const spanishOption = listbox
      .getByRole("option", { name: /español \(méxico\)/i })
      .or(listbox.getByRole("option", { name: /español/i }));
    const option = spanishOption.first();
    await option.scrollIntoViewIfNeeded({ timeout: 8_000 });
    await option.click({ timeout: 5_000, force: true });
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

interface CaptionBlock {
  name: string;
  text: string;
}

/**
 * Lee el panel de subtítulos de Meet cada pocos segundos y arma líneas
 * "Nombre: lo que dijo". Confirmado contra el HTML real de una reunión con
 * subtítulos andando (ya no es una suposición): el panel es
 * `[role="region"][aria-label="Subtítulos"]` (coincidencia EXACTA — con
 * `*=` de substring también entraban el botón de "Abrir configuración de
 * subtítulos" y el de activarlos, que tienen "subtítulos" en su propio
 * aria-label), y cada intervención es un bloque `.nMcdL` con el nombre en
 * `.NWpY1d` y el texto en `.ygicle`. Si Google cambia estas clases en un
 * rediseño, cae a un fallback más genérico (todo el texto del panel,
 * sin separar nombre de texto) antes que no capturar nada.
 *
 * Estrategia de acumulado: Meet mantiene varios bloques visibles a la vez,
 * y el ÚLTIMO se sigue actualizando mientras esa persona sigue hablando —
 * recién se guarda como "terminado" cuando aparece un bloque nuevo después
 * (cambió de hablante, o hizo una pausa larga).
 */
export function startCapturingCaptions(page: Page, meetingId: string): CaptionsCapture {
  const finalizedKeys = new Set<string>();
  const finalizedLines: string[] = [];
  let pending: CaptionBlock | null = null;
  let stopped = false;
  let ticks = 0;

  function recordIfNew(block: CaptionBlock): void {
    const key = `${block.name}:${block.text}`;
    if (block.text && !finalizedKeys.has(key)) {
      finalizedKeys.add(key);
      finalizedLines.push(`${block.name}: ${block.text}`);
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    ticks += 1;
    try {
      const result = await page.evaluate(() => {
        const region = document.querySelector('[role="region"][aria-label="Subtítulos"]');
        if (!region) return { blocks: [] as { name: string; text: string }[], fallback: "" };

        const blockEls = Array.from(region.querySelectorAll(".nMcdL"));
        if (blockEls.length > 0) {
          const blocks = blockEls.map((el) => ({
            name: el.querySelector(".NWpY1d")?.textContent?.trim() || "Alguien",
            text: el.querySelector(".ygicle")?.textContent?.trim() || "",
          }));
          return { blocks, fallback: "" };
        }

        // Fallback si Google cambió las clases internas: todo el texto del
        // panel, sin poder separar nombre de lo dicho.
        return { blocks: [], fallback: (region as HTMLElement).innerText?.trim() ?? "" };
      });

      if (result.blocks.length > 0) {
        // Todos menos el último ya están "terminados" — Meet agregó uno
        // nuevo después, así que ese ya no va a cambiar más.
        for (let i = 0; i < result.blocks.length - 1; i++) recordIfNew(result.blocks[i]);
        pending = result.blocks[result.blocks.length - 1] ?? null;
      } else if (result.fallback && result.fallback.length >= 25) {
        recordIfNew({ name: "", text: result.fallback });
      }

      if (ticks % 10 === 0) {
        console.log(
          `[meeting-bot] Subtítulos — ${finalizedLines.length} línea(s) guardadas, pendiente: "${(pending?.text ?? "").slice(0, 60)}"`,
        );
      }

      if (ticks % 20 === 0) void dumpAccessibilityTree(page, meetingId, ticks);
    } catch {
      // La página puede no estar lista, o haberse cerrado — se ignora, reintenta en el próximo tick.
    }

    if (!stopped) setTimeout(() => void tick(), CAPTIONS_POLL_MS);
  }

  void tick();

  return {
    stop(): string {
      stopped = true;
      if (pending) recordIfNew(pending);
      return finalizedLines.join("\n");
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
