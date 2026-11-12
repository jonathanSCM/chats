import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captionsByClass, createMeet, type Block, type Meet } from "./extension-harness";

/**
 * Guardado por partes de los subtítulos, con el content.js REAL sobre una página de Meet de mentira: cada ~30 s se manda solo
 * lo nuevo, un fallo no pierde líneas, el cierre manda lo que falte y queda una copia local que se borra al enviarse bien (y
 * que el panel usa para recuperar una grabación que se cortó).
 */
const L1: Block = { name: "Ana", text: "Hola, gracias por conectarte a la llamada de hoy" };
const L2: Block = { name: "Luis", text: "Buenas, vamos a revisar la propuesta comercial" };
const L3: Block = { name: "Ana", text: "Perfecto, empecemos con los precios del plan" };
const L4: Block = { name: "Luis", text: "Me parece bien, lo comparto con mi equipo" };

let meet: Meet;
const feed = (...blocks: Block[]) => meet.setCaptions(captionsByClass(blocks));

beforeEach(() => {
  vi.useFakeTimers();
  meet = createMeet();
});
afterEach(() => {
  meet.close();
  vi.useRealTimers();
});

async function startRecording() {
  const started = meet.message({ type: "START_RECORDING", organizationId: null, title: "Demo", recordingId: "rec-1" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(await started).toEqual({ ok: true });
}

describe("guardado por partes de los subtítulos", () => {
  it("cada ~30 s manda solo las líneas nuevas (sin cierre) y deja una copia local", async () => {
    await startRecording();
    feed(L1, L2, L3); // L3 sigue «en curso»: aún no se guarda
    await vi.advanceTimersByTimeAsync(31_000);
    expect(meet.posts()).toHaveLength(1);
    expect(meet.posts()[0]).toMatchObject({ final: false, recordingId: "rec-1", transcript: `${L1.name}: ${L1.text}\n${L2.name}: ${L2.text}` });
    const local = meet.store["rec:rec-1"] as { lines: string[]; sentCount: number; closed: boolean };
    expect(local.sentCount).toBe(2);
    expect(local.closed).toBe(false);

    feed(L1, L2, L3, L4);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(meet.posts()).toHaveLength(2);
    expect(meet.posts()[1].transcript).toBe(`${L3.name}: ${L3.text}`); // solo lo nuevo, no se repite lo anterior
  });

  it("si un envío falla no se pierde nada: el siguiente lleva también lo que no llegó", async () => {
    await startRecording();
    meet.fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    feed(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(31_000);
    expect((meet.store["rec:rec-1"] as { sentCount: number }).sentCount).toBe(0);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(meet.posts()[1].transcript).toBe(`${L1.name}: ${L1.text}\n${L2.name}: ${L2.text}`);
    expect((meet.store["rec:rec-1"] as { sentCount: number }).sentCount).toBe(2);
  });

  it("al detener manda lo que falta con cierre (final) y borra la copia local", async () => {
    await startRecording();
    feed(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(31_000); // L1 y L2 ya enviadas
    await meet.message({ type: "STOP_AND_SEND" });
    const last = meet.posts().at(-1)!;
    expect(last.final).toBe(true);
    expect(last.transcript).toBe(`${L3.name}: ${L3.text}`); // lo último que se estaba diciendo
    expect(meet.store["rec:rec-1"]).toBeUndefined();
  });

  it("si el cierre falla (sin red) la copia local queda marcada como cerrada para recuperarla desde el panel", async () => {
    await startRecording();
    feed(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(5_000);
    meet.fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await meet.message({ type: "STOP_AND_SEND" });
    const local = meet.store["rec:rec-1"] as { closed: boolean; lines: string[]; sentCount: number };
    expect(local.closed).toBe(true);
    expect(local.lines).toHaveLength(3);
    expect(local.sentCount).toBe(0);
  });

  it("una prueba muy corta no crea nada en el CRM", async () => {
    await startRecording();
    feed({ name: "Ana", text: "hola" });
    await vi.advanceTimersByTimeAsync(31_000);
    await meet.message({ type: "STOP_AND_SEND" });
    expect(meet.fetchMock).not.toHaveBeenCalled();
  });

  it("con «Grabar audio» apagado, el estado lo indica (el panel no pide audio ni micrófono) y los subtítulos se guardan igual", async () => {
    const started = meet.message({ type: "START_RECORDING", organizationId: null, title: "Solo texto", recordingId: "rec-2", audioOff: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await started).toEqual({ ok: true });
    feed(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(31_000);
    const live = meet.messages.filter((m) => m.type === "LIVE_STATE").at(-1) as unknown as { state: { audioOff: boolean } };
    expect(live.state.audioOff).toBe(true);
    expect(meet.posts()[0].transcript).toBe(`${L1.name}: ${L1.text}\n${L2.name}: ${L2.text}`);
  });

  it("al cerrar la pestaña sin detener, el sendBeacon manda lo que falta con cierre", async () => {
    await startRecording();
    feed(L1, L2, L3);
    await vi.advanceTimersByTimeAsync(31_000);
    meet.pagehide();
    expect(meet.beacons).toHaveLength(1);
    const body = JSON.parse(await meet.beacons[0].blob.text());
    expect(body).toMatchObject({ final: true, token: "tok", recordingId: "rec-1", transcript: `${L3.name}: ${L3.text}` });
  });
});
