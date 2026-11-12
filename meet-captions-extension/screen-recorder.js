// Grabadora de pantalla. Todo queda en el computador: el video se escribe directo al archivo que la persona eligió (así una
// grabación larga no llena la memoria) o, si Chrome no permite elegir carpeta, se descarga al terminar. No se sube a ningún lado.
const $ = (id) => document.getElementById(id);

let fileHandle = null; // archivo elegido con «Elegir carpeta y nombre»
let writable = null; // FileSystemWritableFileStream abierto durante la grabación
let writeChain = Promise.resolve(); // las escrituras van una tras otra y en orden
const memoryChunks = []; // solo si no hay archivo elegido
let recorder = null;
let displayStream = null;
let micStream = null;
let audioContext = null;
let clockTimer = null;
let startedAt = 0;
let bytes = 0;
let finishing = false;
let activeName = "";

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}
const defaultName = () => `grabacion-pantalla_${stamp()}.webm`;
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${m}:${ss}` : `${m}:${ss}`;
};
const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB";

function showError(text) {
  $("err").textContent = text;
  $("err").hidden = !text;
}

function pickMime() {
  for (const m of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

// ───────── 2. Dónde guardar ─────────
$("pickBtn").addEventListener("click", async () => {
  showError("");
  if (typeof window.showSaveFilePicker !== "function") {
    showError("Este Chrome no permite elegir la carpeta: el video se descargará al terminar.");
    return;
  }
  try {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: defaultName(),
      types: [{ description: "Video WebM", accept: { "video/webm": [".webm"] } }],
    });
    $("where").textContent = "Se guardará como: " + fileHandle.name;
    $("pickBtn").textContent = "Cambiar carpeta o nombre";
  } catch (error) {
    if (error && error.name !== "AbortError") showError("No se pudo elegir el archivo: " + (error.message || error));
  }
});

// ───────── 3. Grabar ─────────
$("startBtn").addEventListener("click", async () => {
  showError("");
  $("startBtn").disabled = true;
  try {
    await start();
  } catch (error) {
    await cleanup();
    const name = error && error.name;
    if (name === "NotAllowedError" || name === "AbortError") showError("No se eligió ninguna pantalla. Pulsa de nuevo para intentarlo.");
    else showError("No se pudo empezar: " + (error && error.message ? error.message : error));
    $("startBtn").disabled = false;
  }
});

async function start() {
  const wantSys = $("optSys").checked;
  const wantMic = $("optMic").checked;
  displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 } },
    audio: wantSys,
  });

  // Audio: lo que suena en la pantalla/pestaña y, si se pidió, el micrófono, mezclados en una sola pista.
  const tracks = [...displayStream.getVideoTracks()];
  const sysTracks = displayStream.getAudioTracks();
  let micOk = true;
  if (wantMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      micOk = false;
      micStream = null;
    }
  }
  if (sysTracks.length > 0 && micStream) {
    audioContext = new AudioContext();
    const dest = audioContext.createMediaStreamDestination();
    audioContext.createMediaStreamSource(new MediaStream(sysTracks)).connect(dest);
    audioContext.createMediaStreamSource(micStream).connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  } else if (sysTracks.length > 0) {
    tracks.push(...sysTracks);
  } else if (micStream) {
    tracks.push(...micStream.getAudioTracks());
  }
  const noSys = wantSys && sysTracks.length === 0;

  // El archivo se abre ya, antes del primer pedazo.
  writeChain = Promise.resolve();
  memoryChunks.length = 0;
  bytes = 0;
  finishing = false;
  writable = null;
  if (fileHandle) {
    try {
      writable = await fileHandle.createWritable();
      activeName = fileHandle.name;
    } catch (error) {
      showError("No se pudo abrir el archivo elegido; se descargará al terminar. (" + (error.message || error) + ")");
      writable = null;
    }
  }
  if (!writable) activeName = defaultName();

  const mime = pickMime();
  recorder = new MediaRecorder(new MediaStream(tracks), {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 96_000,
  });
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    bytes += e.data.size;
    if (writable) {
      const w = writable;
      writeChain = writeChain.then(() => w.write(e.data)).catch((error) => showError("Error al escribir el archivo: " + (error.message || error)));
    } else {
      memoryChunks.push(e.data);
    }
  };
  recorder.onstop = () => void finish();
  // Si se pulsa «Dejar de compartir» en la barra de Chrome, se termina y se guarda.
  displayStream.getVideoTracks()[0].addEventListener("ended", () => stop());
  recorder.start(1000);

  startedAt = Date.now();
  $("setup").hidden = true;
  $("done").hidden = true;
  $("live").hidden = false;
  $("whereLive").textContent = writable ? "Guardando en: " + activeName : "Se descargará como " + activeName + " al terminar (queda en memoria mientras graba: para grabaciones largas elige una carpeta).";
  clockTimer = setInterval(() => {
    $("clock").textContent = clock(Date.now() - startedAt);
    $("size").textContent = mb(bytes) + (wantMic && !micOk ? " · micrófono no disponible" : noSys ? " · sin audio de la pantalla (marca «Compartir audio» en el selector)" : "");
  }, 500);
  $("stopBtn").disabled = false;
}

function stop() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}
$("stopBtn").addEventListener("click", () => {
  $("stopBtn").disabled = true;
  $("state").textContent = "Guardando…";
  stop();
});

async function finish() {
  if (finishing) return;
  finishing = true;
  clearInterval(clockTimer);
  const total = bytes;
  let savedTo = "";
  try {
    await writeChain;
    if (writable) {
      await writable.close();
      savedTo = "Guardado como: " + activeName;
    } else if (memoryChunks.length > 0) {
      const url = URL.createObjectURL(new Blob(memoryChunks, { type: "video/webm" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = activeName;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      savedTo = "Descargado como: " + activeName + " (carpeta de Descargas)";
    }
    $("doneText").textContent = `Grabación guardada · ${clock(Date.now() - startedAt)} · ${mb(total)}`;
    $("doneText").className = "ok";
  } catch (error) {
    $("doneText").textContent = "No se pudo guardar el archivo: " + (error && error.message ? error.message : error);
    $("doneText").className = "err";
  }
  $("doneWhere").textContent = savedTo;
  await cleanup();
  $("live").hidden = true;
  $("done").hidden = false;
}

async function cleanup() {
  clearInterval(clockTimer);
  for (const s of [displayStream, micStream]) if (s) s.getTracks().forEach((t) => t.stop());
  if (audioContext && audioContext.state !== "closed") await audioContext.close().catch(() => {});
  displayStream = micStream = audioContext = recorder = null;
  if (writable && !finishing) {
    try {
      await writable.abort();
    } catch {
      /* ya cerrado */
    }
  }
  writable = null;
}

$("againBtn").addEventListener("click", () => {
  fileHandle = null;
  $("where").textContent = "Sin elegir: al terminar se descargará en tu carpeta de Descargas.";
  $("pickBtn").textContent = "Elegir carpeta y nombre del archivo";
  $("startBtn").disabled = false;
  $("done").hidden = true;
  $("setup").hidden = false;
});

// Cerrar la ventana a mitad de una grabación la perdería: se avisa.
window.addEventListener("beforeunload", (e) => {
  if (recorder && recorder.state !== "inactive") {
    e.preventDefault();
    e.returnValue = "";
  }
});
