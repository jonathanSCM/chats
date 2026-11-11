import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captionsByClass, captionsRenamed, createMeet, type Block, type Meet } from "./extension-harness";

/**
 * Cómo se comporta la extensión con DISTINTAS versiones del HTML de Meet, con varias personas y en reuniones largas. Las páginas
 * de prueba están reconstruidas a partir de la estructura conocida de Meet (no son capturas reales: ver el «diagnóstico» del
 * panel, que ahora guarda la estructura real sin el contenido para poder sumar una copia fiel cuando Meet cambie).
 */
const TRIO: Block[] = [
  { name: "Ana Pérez", text: "Buenos días a todos, gracias por conectarse hoy" },
  { name: "Luis Gómez", text: "Buenos días, ¿empezamos con el tema de los precios?" },
  { name: "Marta Ríos", text: "Sí, yo tengo preparada la propuesta del plan anual" },
  { name: "Ana Pérez", text: "Perfecto, la compartimos en pantalla ahora mismo" },
];

let meet: Meet | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  meet?.close();
  meet = null;
  vi.useRealTimers();
});

async function record(m: Meet) {
  const started = m.message({ type: "START_RECORDING", organizationId: null, title: null, recordingId: "rec-x" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(await started).toEqual({ ok: true });
}
/** Graba con los subtítulos dados, detiene y devuelve lo que se mandó al CRM (todas las partes, en orden). */
async function transcriptOf(m: Meet, captionsHtml: string): Promise<string[]> {
  await record(m);
  m.setCaptions(captionsHtml);
  await vi.advanceTimersByTimeAsync(6000);
  await m.message({ type: "STOP_AND_SEND" });
  return m
    .posts()
    .map((p) => p.transcript)
    .filter(Boolean)
    .join("\n")
    .split("\n");
}
const expected = TRIO.map((b) => `${b.name}: ${b.text}`);

describe("lectura de subtítulos con distintas versiones de Meet", () => {
  it("Meet de hoy: región «Subtítulos» con las clases conocidas", async () => {
    meet = createMeet();
    expect(await transcriptOf(meet, captionsByClass(TRIO))).toEqual(expected);
  });

  it("Meet en inglés: región «Captions»", async () => {
    meet = createMeet();
    expect(await transcriptOf(meet, captionsByClass(TRIO, "Captions"))).toEqual(expected);
  });

  it("Meet en otros idiomas (portugués, francés, alemán): se reconoce la región por su nombre", async () => {
    for (const label of ["Legendas", "Sous-titres", "Untertitel"]) {
      meet = createMeet();
      expect(await transcriptOf(meet, captionsByClass(TRIO, label))).toEqual(expected);
      meet.close();
      meet = null;
    }
  });

  it("si Meet RENOMBRA las clases, se lee igual por la estructura (avatar, nombre, texto)", async () => {
    meet = createMeet();
    expect(await transcriptOf(meet, captionsRenamed(TRIO))).toEqual(expected);
  });

  it("si además cambia el nombre de la región, se encuentra por ser la región enfocable con avatares", async () => {
    meet = createMeet();
    expect(await transcriptOf(meet, captionsRenamed(TRIO, "Zxq nuevo nombre"))).toEqual(expected);
  });

  it("el diagnóstico guarda la ESTRUCTURA de los subtítulos sin el contenido (sin nombres ni frases)", async () => {
    meet = createMeet();
    await record(meet);
    meet.setCaptions(captionsByClass(TRIO));
    await vi.advanceTimersByTimeAsync(16_000);
    const dump = meet.messages.filter((m) => m.type === "DEBUG" && String(m.text).includes("estructura de subtítulos")).map((m) => String(m.text))[0];
    expect(dump).toContain('role="region"');
    expect(dump).toContain("nMcdL");
    expect(dump).not.toContain("Ana");
    expect(dump).not.toContain("precios");
    expect(dump).not.toContain("googleusercontent");
  });
});

describe("micrófono silenciado, sin depender del idioma", () => {
  const micMessages = (m: Meet) => m.messages.filter((x) => x.type === "SET_MIC_ENABLED").map((x) => x.enabled);

  it("con el atributo data-is-muted (lo normal)", async () => {
    meet = createMeet({ body: '<button data-is-muted="true" aria-label="Activar micrófono"><i class="google-symbols">mic_off</i></button>' });
    await record(meet);
    expect(micMessages(meet).at(-1)).toBe(false);
  });

  it("sin atributo ni texto en español/inglés: por el ícono (Meet en alemán)", async () => {
    meet = createMeet({ body: '<button aria-label="Mikrofon aktivieren"><i class="google-symbols">mic_off</i></button>' });
    await record(meet);
    expect(micMessages(meet).at(-1)).toBe(false);
  });

  it("micrófono activo: se graba tu voz", async () => {
    meet = createMeet({ body: '<button aria-label="Mikrofon deaktivieren"><i class="google-symbols">mic</i></button>' });
    await record(meet);
    expect(micMessages(meet).at(-1)).toBe(true);
  });

  it("si no se encuentra el botón no se corta el micrófono por las dudas", async () => {
    meet = createMeet();
    await record(meet);
    expect(micMessages(meet).at(-1)).toBe(true);
  });

  it("se actualiza al instante cuando cambia el botón", async () => {
    meet = createMeet({ body: '<button id="mic" data-is-muted="false" aria-label="Desactivar micrófono"><i class="google-symbols">mic</i></button>' });
    await record(meet);
    expect(micMessages(meet).at(-1)).toBe(true);
    meet.document.getElementById("mic")!.setAttribute("data-is-muted", "true");
    await vi.advanceTimersByTimeAsync(400);
    expect(micMessages(meet).at(-1)).toBe(false);
  });
});

describe("reuniones largas y con varias personas", () => {
  it("1 hora con 3 personas: cada línea llega al CRM UNA sola vez y en orden, con envíos pequeños", async () => {
    meet = createMeet();
    await record(meet);
    const all: string[] = [];
    const speakers = ["Ana Pérez", "Luis Gómez", "Marta Ríos"];
    for (let i = 0; i < 120; i++) {
      const b = { name: speakers[i % 3], text: `Intervención número ${i + 1} con suficiente texto para contar` };
      all.push(`${b.name}: ${b.text}`);
      const visible = all.slice(-5).map((l) => ({ name: l.split(": ")[0], text: l.split(": ").slice(1).join(": ") })); // Meet solo muestra las últimas
      meet.setCaptions(captionsByClass(visible));
      await vi.advanceTimersByTimeAsync(30_000);
    }
    await meet.message({ type: "STOP_AND_SEND" });
    const posts = meet.posts();
    const sent = posts
      .map((p) => p.transcript)
      .filter(Boolean)
      .join("\n")
      .split("\n");
    expect(sent).toEqual(all); // ni faltan, ni repetidas, ni desordenadas
    expect(posts.at(-1)!.final).toBe(true);
    expect(posts.filter((p) => p.final)).toHaveLength(1);
    expect(Math.max(...posts.map((p) => p.transcript.length))).toBeLessThan(2000);
    expect(posts.length).toBeLessThan(135);
    expect(meet.store["rec:rec-x"]).toBeUndefined();
  }, 180_000);

  it("una persona habla sin parar (la última intervención crece): solo se guarda al terminar, sin versiones a medias repetidas", async () => {
    meet = createMeet();
    await record(meet);
    let text = "Empiezo a explicar el plan";
    for (let i = 0; i < 6; i++) {
      meet.setCaptions(captionsByClass([{ name: "Ana Pérez", text }]));
      await vi.advanceTimersByTimeAsync(5000);
      text += " y agrego un poco más de detalle";
    }
    await meet.message({ type: "STOP_AND_SEND" });
    const lines = meet.posts().map((p) => p.transcript).filter(Boolean).join("\n").split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("y agrego un poco más de detalle");
  });
});

describe("cámaras al esconder los subtítulos de Meet", () => {
  /** Escenario: panel de subtítulos de Meet + barra de controles; el bloque de cámaras mide 965x543 en un escenario de 1509x759. */
  function stage(tiles: number) {
    const tileHtml = Array.from({ length: tiles }, (_, i) => `<div class="tile" id="t${i}" style="left: ${i * 300}px; top: 0px; width: 965px; height: 543px;"><div style="width: 965px; height: 543px;"></div></div>`).join("");
    const m = createMeet({
      realCaptions: true,
      body:
        `<div data-side="3" data-priority="999" id="capPanel"><div class="a4cQT"></div></div>` +
        `<div data-side="3" data-priority="1100" id="bar"><button aria-label="Salir de la llamada"></button></div>`,
    });
    const main = m.document.querySelector("main")!;
    main.innerHTML = tileHtml;
    const size = (el: Element, w: number, h: number, rect?: Partial<DOMRect>) => {
      Object.defineProperty(el, "offsetWidth", { value: w, configurable: true });
      Object.defineProperty(el, "offsetHeight", { value: h, configurable: true });
      Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
      Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
      if (rect) el.getBoundingClientRect = () => ({ top: 0, left: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON() {}, ...rect }) as DOMRect;
    };
    size(main, 1509, 759, { top: 64, bottom: 600 }); // el escenario termina antes de la barra: hay hueco
    size(m.document.getElementById("bar")!, 600, 80, { top: 831, bottom: 911, height: 80 });
    size(m.document.getElementById("capPanel")!, 600, 0, { top: 831, bottom: 831, height: 0 });
    for (const t of m.document.querySelectorAll(".tile")) {
      size(t, 965, 543);
      for (const c of t.children) size(c, 965, 543);
    }
    return m;
  }
  const hide = async (m: Meet) => {
    (m.win as unknown as { ProShopCaptions: { setHidden(v: boolean): void } }).ProShopCaptions.setHidden(true);
    await vi.advanceTimersByTimeAsync(1500);
  };

  it("con una sola cámara se agranda para llenar el espacio (1509/965 vs 759/543 → ~1,40)", async () => {
    meet = stage(1);
    await hide(meet);
    const tile = meet.document.getElementById("t0")!;
    expect(tile.dataset.psHide).toBe("tile");
    const scale = parseFloat(meet.document.documentElement.style.getPropertyValue("--ps-scale"));
    expect(scale).toBeGreaterThan(1.39);
    expect(scale).toBeLessThan(1.41);
  });

  it("con varias cámaras NO se agranda una sola (quedaría cortada)", async () => {
    meet = stage(3);
    await hide(meet);
    expect(meet.document.querySelectorAll('[data-ps-hide="tile"]')).toHaveLength(0);
    expect(meet.document.documentElement.style.getPropertyValue("--ps-scale")).toBe("");
  });

  it("al mostrar de nuevo los subtítulos todo vuelve a como estaba", async () => {
    meet = stage(1);
    await hide(meet);
    (meet.win as unknown as { ProShopCaptions: { setHidden(v: boolean): void } }).ProShopCaptions.setHidden(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(meet.document.querySelectorAll("[data-ps-hide]")).toHaveLength(0);
    expect(meet.document.documentElement.style.getPropertyValue("--ps-scale")).toBe("");
    expect(meet.document.getElementById("t0")!.getAttribute("style")).toContain("width: 965px"); // el tamaño que puso Meet no se tocó
  });
});
