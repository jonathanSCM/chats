import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captionsByClass, createMeet, type Block, type Meet } from "./extension-harness";

/**
 * Manejo por personas que no saben de la extensión: pulsar Grabar y Detener varias veces, o grabar dos veces la misma reunión.
 * Corre el content.js REAL sobre una página de Meet de mentira.
 */
const A: Block = { name: "Ana", text: "Hola, gracias por conectarte a la llamada de hoy" };
const B: Block = { name: "Luis", text: "Buenas, vamos a revisar la propuesta comercial" };
const C: Block = { name: "Ana", text: "Perfecto, empecemos con los precios del plan" };

let meet: Meet;
beforeEach(() => {
  vi.useFakeTimers();
  meet = createMeet();
});
afterEach(() => {
  meet.close();
  vi.useRealTimers();
});

const feed = (...blocks: Block[]) => meet.setCaptions(captionsByClass(blocks));
const states = () => meet.messages.filter((m) => m.type === "LIVE_STATE").map((m) => (m as unknown as { state: { recording: boolean; stopped: boolean; recordingId: string; lines: number } }).state);

describe("grabar, detener y volver a grabar", () => {
  it("«Grabar» contesta al instante, sin esperar a que se activen los subtítulos", async () => {
    let answered = false;
    void meet.message({ type: "START_RECORDING", organizationId: null, title: null, recordingId: "r1" }).then(() => (answered = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBe(true);
  });

  it("pulsar «Grabar» dos veces no empieza dos grabaciones", async () => {
    await meet.message({ type: "START_RECORDING", organizationId: null, title: null, recordingId: "r1" });
    const again = await meet.message({ type: "START_RECORDING", organizationId: null, title: null, recordingId: "r2" });
    expect(again).toEqual({ ok: true, already: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(states().at(-1)?.recordingId).toBe("r1");
  });

  it("detener y grabar otra vez: la segunda grabación empieza de cero, con su id, y manda solo lo suyo", async () => {
    await meet.message({ type: "START_RECORDING", organizationId: null, title: "Cliente", recordingId: "r1" });
    await vi.advanceTimersByTimeAsync(3000);
    feed(A, B, C);
    await vi.advanceTimersByTimeAsync(6000);
    await meet.message({ type: "STOP_AND_SEND" });
    expect(states().at(-1)).toMatchObject({ recording: false, stopped: true, recordingId: "r1" });
    expect(meet.posts().at(-1)).toMatchObject({ recordingId: "r1", final: true });

    // Segunda grabación en la misma sala, con otros subtítulos.
    feed();
    await meet.message({ type: "START_RECORDING", organizationId: null, title: "Equipo", recordingId: "r2" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(states().at(-1)).toMatchObject({ recording: true, stopped: false, recordingId: "r2", lines: 0 });
    const D: Block = { name: "Luis", text: "Segunda reunión: revisemos los pendientes del equipo" };
    const E: Block = { name: "Ana", text: "De acuerdo, empiezo con el tema de la integración" };
    feed(D, E);
    await vi.advanceTimersByTimeAsync(6000);
    await meet.message({ type: "STOP_AND_SEND" });
    const last = meet.posts().at(-1)!;
    expect(last).toMatchObject({ recordingId: "r2", final: true });
    expect(last.transcript).toContain("Segunda reunión");
    expect(last.transcript).not.toContain("propuesta comercial"); // nada de la primera
  });

  it("«Detener» dos veces seguidas manda una sola vez", async () => {
    await meet.message({ type: "START_RECORDING", organizationId: null, title: null, recordingId: "r1" });
    await vi.advanceTimersByTimeAsync(3000);
    feed(A, B, C);
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all([meet.message({ type: "STOP_AND_SEND" }), meet.message({ type: "STOP_AND_SEND" })]);
    expect(meet.posts().filter((p) => p.final)).toHaveLength(1);
  });

  it("con una reunión del CRM elegida, cada envío lleva su id y el primero marca el inicio de la grabación", async () => {
    await meet.message({ type: "START_RECORDING", organizationId: null, title: null, recordingId: "r1", meetingId: "m-crm-1", meetingLabel: "Demo con Ana" });
    await vi.advanceTimersByTimeAsync(3000);
    feed(A, B, C);
    await vi.advanceTimersByTimeAsync(31_000);
    await meet.message({ type: "STOP_AND_SEND" });
    const posts = meet.posts() as unknown as { meetingId?: string; start?: boolean; final: boolean }[];
    expect(posts.every((p) => p.meetingId === "m-crm-1")).toBe(true);
    expect(posts[0].start).toBe(true); // primer envío: el servidor abre la sección con fecha y hora
    expect(posts.slice(1).every((p) => !p.start)).toBe(true);
    expect(states().at(-1)).toMatchObject({ meetingId: "m-crm-1", meetingLabel: "Demo con Ana" });
  });
});
