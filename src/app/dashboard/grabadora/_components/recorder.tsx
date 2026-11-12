"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Prototipo de grabadora en el navegador. Mezcla el audio de la pestaña compartida (getDisplayMedia) con el micrófono
 * (getUserMedia) en un solo archivo y lo sube por partes de 10 min a /api/extension/audio (el mismo que usa la extensión):
 * cada parte es un .webm completo que el servidor transcribe y suma a la reunión.
 */
const SEGMENT_MS = 10 * 60 * 1000;
const UPLOAD_ATTEMPTS = 3;

interface Org {
  id: string;
  name: string;
}
type Phase = "idle" | "recording" | "done";
interface Pending {
  part: number;
  blob: Blob;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function Recorder({ token, userName }: { token: string; userName: string | null }) {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState("");
  const [title, setTitle] = useState("");
  const [meetLink, setMeetLink] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [uploaded, setUploaded] = useState(0);
  const [failed, setFailed] = useState<Pending[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Todo lo que no debe provocar re-render vive en refs.
  const run = useRef<{
    recordingId: string;
    part: number;
    recorder: MediaRecorder | null;
    ctx: AudioContext | null;
    streams: MediaStream[];
    rotateTimer: ReturnType<typeof setTimeout> | null;
    tick: ReturnType<typeof setInterval> | null;
    stopping: boolean;
    pendingUploads: number;
    meetingUrl: string;
  } | null>(null);
  const form = useRef({ orgId: "", title: "" });
  useEffect(() => {
    form.current = { orgId, title };
  }, [orgId, title]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/extension/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const me = (await res.json()) as { organizations?: Org[]; activeOrganizationId?: string };
        setOrgs((me.organizations ?? []).map((o) => ({ id: o.id, name: o.name })));
        setOrgId(me.activeOrganizationId ?? me.organizations?.[0]?.id ?? "");
      } catch {
        setError("No se pudieron cargar tus organizaciones.");
      }
    })();
  }, [token]);

  // Aviso del navegador si se intenta cerrar la pestaña mientras graba.
  useEffect(() => {
    if (phase !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const upload = useCallback(
    async (item: Pending): Promise<boolean> => {
      const r = run.current;
      if (!r) return false;
      for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
        try {
          const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            "Content-Type": "audio/webm",
            "X-Meeting-Url": r.meetingUrl,
            "X-Recording-Id": r.recordingId,
            "X-Audio-Part": String(item.part),
          };
          if (form.current.orgId) headers["X-Organization-Id"] = form.current.orgId;
          if (form.current.title.trim()) headers["X-Meeting-Title"] = encodeURIComponent(form.current.title.trim());
          const res = await fetch("/api/extension/audio", { method: "POST", headers, body: item.blob });
          if (res.ok) {
            setUploaded((n) => n + 1);
            setFailed((list) => list.filter((f) => f.part !== item.part));
            return true;
          }
        } catch {
          /* se reintenta */
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
      setFailed((list) => (list.some((f) => f.part === item.part) ? list : [...list, item]));
      return false;
    },
    [token],
  );

  // Se guarda en una ref porque se llama a sí misma al rotar la parte.
  const startSegmentRef = useRef<(dest: MediaStreamAudioDestinationNode) => void>(() => {});
  useEffect(() => {
    startSegmentRef.current = (dest) => {
      const r = run.current;
      if (!r) return;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: 24000 });
      const chunks: Blob[] = [];
      const part = ++r.part;
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size > 0) {
          r.pendingUploads++;
          void upload({ part, blob }).finally(() => {
            r.pendingUploads--;
            if (r.stopping && r.pendingUploads === 0) setPhase("done");
          });
        } else if (r.stopping && r.pendingUploads === 0) {
          setPhase("done");
        }
      };
      recorder.start(1000);
      r.recorder = recorder;
      // Cada 10 min se cierra la parte (se sube) y arranca otra sin perder audio.
      r.rotateTimer = setTimeout(() => {
        if (r.stopping) return;
        recorder.stop();
        startSegmentRef.current(dest);
      }, SEGMENT_MS);
    };
  }, [upload]);

  const stop = useCallback(() => {
    const r = run.current;
    if (!r || r.stopping) return;
    r.stopping = true;
    if (r.rotateTimer) clearTimeout(r.rotateTimer);
    if (r.tick) clearInterval(r.tick);
    if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop();
    else if (r.pendingUploads === 0) setPhase("done");
    r.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    void r.ctx?.close().catch(() => {});
  }, []);

  const start = async () => {
    setError(null);
    setUploaded(0);
    setFailed([]);
    setElapsed(0);
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      setError("No se eligió ninguna pestaña para compartir.");
      return;
    }
    if (display.getAudioTracks().length === 0) {
      display.getTracks().forEach((t) => t.stop());
      setError("La pestaña se compartió sin audio: en el selector de Chrome elige la pestaña de la reunión y marca «Compartir audio de la pestaña».");
      return;
    }
    let mic: MediaStream | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      mic = null; // sin micrófono se graban solo las voces de la reunión
    }
    setMicOn(Boolean(mic));

    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
    if (mic) ctx.createMediaStreamSource(mic).connect(dest);

    const recordingId = crypto.randomUUID();
    run.current = {
      recordingId,
      part: 0,
      recorder: null,
      ctx,
      streams: mic ? [display, mic] : [display],
      rotateTimer: null,
      tick: null,
      stopping: false,
      pendingUploads: 0,
      meetingUrl: meetLink.trim() || `${window.location.origin}/dashboard/grabadora#${recordingId}`,
    };
    // Si se pulsa «Dejar de compartir» en la barra de Chrome, la grabación termina limpia.
    display.getVideoTracks()[0]?.addEventListener("ended", stop);
    display.getAudioTracks()[0]?.addEventListener("ended", stop);
    startSegmentRef.current(dest);
    const startedAt = Date.now();
    run.current.tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    setPhase("recording");
  };

  const retryFailed = async () => {
    for (const item of [...failed]) await upload(item);
  };

  const recording = phase === "recording";
  return (
    <div className="mt-5 space-y-4 rounded-md border border-border p-4">
      {userName && <p className="text-xs text-ink-faint">Conectado como {userName}</p>}

      <label className="block text-xs font-medium text-ink">
        Organización de esta reunión
        <select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          disabled={recording}
          className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
        >
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-medium text-ink">
        Nombre de la reunión (opcional)
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={recording}
          maxLength={160}
          placeholder="Ej.: Demo con Ana - Financiera"
          className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>

      <label className="block text-xs font-medium text-ink">
        Link de Meet (opcional, para unir esta grabación a esa reunión)
        <input
          value={meetLink}
          onChange={(e) => setMeetLink(e.target.value)}
          disabled={recording}
          placeholder="https://meet.google.com/abc-defg-hij"
          className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>

      {!recording ? (
        <button
          onClick={() => void start()}
          disabled={!orgId}
          className="w-full cursor-pointer rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
        >
          {phase === "done" ? "Grabar otra reunión" : "Grabar (elegir la pestaña de la reunión)"}
        </button>
      ) : (
        <button onClick={stop} className="w-full cursor-pointer rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
          Detener y enviar · {mmss(elapsed)}
        </button>
      )}

      {(recording || phase === "done") && (
        <p className="text-xs text-ink-muted">
          {recording ? "Grabando" : "Terminó"} · micrófono: {micOn ? "sí" : "no (solo las voces de la reunión)"} · partes enviadas: {uploaded}
          {phase === "done" && failed.length === 0 && " · ✓ todo enviado, la transcripción aparece en la reunión en unos minutos"}
        </p>
      )}

      {failed.length > 0 && (
        <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
          {failed.length} parte(s) no se pudieron subir (siguen guardadas en esta pestaña: no la cierres).{" "}
          <button onClick={() => void retryFailed()} className="cursor-pointer font-medium underline">
            Reintentar
          </button>
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <p className="text-[11px] leading-snug text-ink-faint">
        Avisa a los participantes de que vas a grabar. El audio se envía a tu organización en el CRM y se transcribe con IA (OpenAI). No cierres esta pestaña
        mientras grabas.
      </p>
    </div>
  );
}
