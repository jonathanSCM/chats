const tokenInput = document.getElementById("token");
const status = document.getElementById("status");
const meetingText = document.getElementById("meetingText");
const meetingStatus = document.getElementById("meetingStatus");
const recordBtn = document.getElementById("recordBtn");
const micBtn = document.getElementById("micBtn");
const micStatus = document.getElementById("micStatus");

// El offscreen document (donde se graba de verdad) no puede mostrar el
// diálogo de permiso de micrófono -- es una página invisible. Por eso hay
// que concederlo una vez desde acá (el popup sí es una página visible de la
// extensión): una vez otorgado, Chrome lo recuerda para todo el origen
// chrome-extension://<id>, así que el offscreen document (mismo origen) ya
// puede pedirlo en silencio de ahí en más.
chrome.storage.local.get(["micGranted"], ({ micGranted }) => {
  if (micGranted) {
    micStatus.textContent = "Micrófono ya activado.";
    micStatus.style.color = "#059669";
  }
});

micBtn.addEventListener("click", async () => {
  micBtn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // no hace falta el stream en sí, solo el permiso
    chrome.storage.local.set({ micGranted: true });
    micStatus.textContent = "Listo — micrófono activado.";
    micStatus.style.color = "#059669";
  } catch (error) {
    micStatus.textContent = "No se pudo activar: " + error.message;
    micStatus.style.color = "#dc2626";
  } finally {
    micBtn.disabled = false;
  }
});

const MEETING_URL_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;

chrome.storage.local.get(["token"], ({ token }) => {
  if (token) tokenInput.value = token;
});

document.getElementById("save").addEventListener("click", () => {
  const token = tokenInput.value.trim();
  if (!token) {
    status.textContent = "Pegá el token primero.";
    status.style.color = "#dc2626";
    return;
  }
  chrome.storage.local.set({ token, apiBase: "https://chats.proshop.lat" }, () => {
    status.textContent = "Guardado.";
    status.style.color = "#059669";
  });
});

// Consulta la pestaña activa: si es una reunión de Meet, muestra el botón
// para activar la grabación de subtítulos ahí -- nada corre solo, hay que
// tocar este botón para cada reunión.
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.url || !MEETING_URL_RE.test(tab.url)) {
    meetingText.textContent = "Esta pestaña no es una reunión de Meet.";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" }, (response) => {
    if (chrome.runtime.lastError || !response) {
      meetingText.textContent = "No se pudo conectar con la reunión — recargá la pestaña de Meet e intentá de nuevo.";
      return;
    }
    if (response.recording) {
      meetingText.innerHTML = '<span class="dot"></span>Grabando esta reunión (' + response.lines + " líneas).";
      recordBtn.style.display = "none";
    } else {
      meetingText.textContent = "Reunión detectada, sin grabar todavía.";
      recordBtn.style.display = "block";
      recordBtn.addEventListener("click", () => {
        recordBtn.disabled = true;
        const meetingUrl = tab.url.match(MEETING_URL_RE)[0];

        chrome.tabs.sendMessage(tab.id, { type: "START_RECORDING" }, () => {
          meetingText.innerHTML = '<span class="dot"></span>Grabando esta reunión.';
          recordBtn.style.display = "none";
          meetingStatus.textContent = "Subtítulos activados.";
          meetingStatus.style.color = "#059669";
        });

        // Audio real para whisper.cpp, además de los subtítulos -- best
        // effort: si tabCapture falla por lo que sea, los subtítulos de
        // arriba siguen andando igual, no se cae toda la grabación por esto.
        chrome.runtime.sendMessage({ type: "START_AUDIO_CAPTURE", tabId: tab.id, meetingUrl }, (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            meetingStatus.textContent += " Audio: no se pudo activar (sigue grabando solo subtítulos).";
            return;
          }
          meetingStatus.textContent += " Audio activado.";
        });
      });
    }
  });
});
