const tokenInput = document.getElementById("token");
const status = document.getElementById("status");
const meetingText = document.getElementById("meetingText");
const meetingStatus = document.getElementById("meetingStatus");
const recordBtn = document.getElementById("recordBtn");

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
        chrome.tabs.sendMessage(tab.id, { type: "START_RECORDING" }, () => {
          meetingText.innerHTML = '<span class="dot"></span>Grabando esta reunión.';
          recordBtn.style.display = "none";
          meetingStatus.textContent = "Activado.";
          meetingStatus.style.color = "#059669";
        });
      });
    }
  });
});
