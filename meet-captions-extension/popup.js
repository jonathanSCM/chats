const status = document.getElementById("status");
const loggedOutBox = document.getElementById("loggedOutBox");
const accountBox = document.getElementById("accountBox");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const accountName = document.getElementById("accountName");
const accountInitial = document.getElementById("accountInitial");
const meetingText = document.getElementById("meetingText");
const meetingStatus = document.getElementById("meetingStatus");
const recordBtn = document.getElementById("recordBtn");
const joinAssistantBtn = document.getElementById("joinAssistantBtn");
const titleBox = document.getElementById("titleBox");
const titleInput = document.getElementById("titleInput");
const orgBox = document.getElementById("orgBox");
const orgSelect = document.getElementById("orgSelect");
const orgOnly = document.getElementById("orgOnly");
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

// Pedir el permiso directo desde el popup no funciona de forma confiable:
// el popup se cierra apenas pierde el foco, y eso a veces descarta el
// diálogo de Chrome antes de que dé tiempo a aceptarlo ("Permission
// dismissed", confirmado en la práctica). Una pestaña de verdad no tiene
// ese problema, así que se abre ahí en vez de pedirlo acá.
micBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html") });
});

// Meet usa tanto /abc-defg-hij como /meet/abc-defg-hij.
const MEETING_URL_RE = /^https:\/\/meet\.google\.com\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
const CRM_BASE = "https://chats.proshop.lat";

// Ya no se pega ningún token a mano: se abre el CRM (reusa la sesión ya
// iniciada ahí, si la hay) y un content script aparte
// (authorize-bridge.js, ver manifest.json) guarda el token personal solo,
// apenas esa página lo genera. Acá el popup solo refleja lo que ya haya en
// storage.
function renderAccount({ token, userName }) {
  if (token) {
    loggedOutBox.style.display = "none";
    accountBox.style.display = "flex";
    accountName.textContent = userName || "Conectado";
    accountInitial.textContent = (userName || "?").trim().charAt(0).toUpperCase();
  } else {
    loggedOutBox.style.display = "block";
    accountBox.style.display = "none";
  }
}

// Organización de esta reunión: si la cuenta tiene varias, se elige ANTES de grabar o de llamar al asistente (con una
// reunión sin agendar no hay otra forma de saber a cuál va). La elegida se recuerda; sin elegir, la activa del CRM.
async function loadOrganizations(token) {
  orgBox.style.display = "none";
  if (!token) return;
  try {
    const res = await fetch(`${CRM_BASE}/api/extension/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const { organizations, activeOrganizationId } = await res.json();
    if (!organizations || organizations.length === 0) return;
    const { orgId } = await chrome.storage.local.get(["orgId"]);
    const selected = organizations.some((o) => o.id === orgId) ? orgId : activeOrganizationId;
    orgSelect.replaceChildren(
      ...organizations.map((o) => {
        const option = document.createElement("option");
        option.value = o.id;
        option.textContent = o.name;
        return option;
      }),
    );
    orgSelect.value = selected;
    chrome.storage.local.set({ orgId: selected });
    if (organizations.length === 1) {
      orgSelect.style.display = "none";
      orgOnly.style.display = "block";
      orgOnly.textContent = `Organización: ${organizations[0].name}`;
    } else {
      orgSelect.style.display = "block";
      orgOnly.style.display = "none";
    }
    orgBox.style.display = "block";
  } catch (e) {
    /* sin conexión: se usa la organización recordada / la activa */
  }
}
orgSelect.addEventListener("change", () => chrome.storage.local.set({ orgId: orgSelect.value }));

chrome.storage.local.get(["token", "userName"], (stored) => {
  renderAccount(stored);
  void loadOrganizations(stored.token);
});

loginBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: `${CRM_BASE}/dashboard/extension-authorize` });
});

logoutBtn.addEventListener("click", () => {
  chrome.storage.local.remove(["token", "userName"], () => {
    renderAccount({ token: null, userName: null });
    status.textContent = "Sesión cerrada.";
    status.style.color = "#6b7280";
  });
});

// Si otra pestaña (la del CRM, recién logueada) guarda el token mientras
// este popup está abierto, se refleja al toque sin tener que cerrarlo y
// abrirlo de nuevo.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.token || changes.userName) {
    chrome.storage.local.get(["token", "userName"], (stored) => {
      renderAccount(stored);
      void loadOrganizations(stored.token);
    });
  }
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
    const meetingUrl = `https://meet.google.com/${tab.url.match(MEETING_URL_RE)[1].toLowerCase()}`;

    // Nombre de la reunión: se guarda lo escrito por reunión, porque el popup se cierra solo al perder el foco.
    const draftKey = `titleDraft:${meetingUrl}`;
    titleBox.style.display = "block";
    chrome.storage.local.get([draftKey], (stored) => {
      if (stored[draftKey]) titleInput.value = stored[draftKey];
    });
    titleInput.addEventListener("input", () => chrome.storage.local.set({ [draftKey]: titleInput.value }));
    const meetingTitle = () => titleInput.value.replace(/\s+/g, " ").trim() || null;

    if (response.recording) {
      meetingText.innerHTML = '<span class="dot"></span>Grabando esta reunión (' + response.lines + " líneas).";
      recordBtn.style.display = "none";
    } else {
      meetingText.textContent = "Reunión detectada, sin grabar todavía.";
      recordBtn.style.display = "block";
      recordBtn.addEventListener("click", () => {
        recordBtn.disabled = true;

        const organizationId = orgBox.style.display === "none" ? null : orgSelect.value;
        const title = meetingTitle();
        chrome.tabs.sendMessage(tab.id, { type: "START_RECORDING", organizationId, title }, () => {
          meetingText.innerHTML = '<span class="dot"></span>Grabando esta reunión.';
          recordBtn.style.display = "none";
          meetingStatus.textContent = "Subtítulos activados.";
          meetingStatus.style.color = "#059669";
        });

        // Audio real para whisper.cpp, además de los subtítulos -- best
        // effort: si tabCapture falla por lo que sea, los subtítulos de
        // arriba siguen andando igual, no se cae toda la grabación por esto.
        chrome.runtime.sendMessage({ type: "START_AUDIO_CAPTURE", tabId: tab.id, meetingUrl, organizationId, title }, (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            meetingStatus.textContent += " Audio: no se pudo activar (sigue grabando solo subtítulos).";
            return;
          }
          meetingStatus.textContent += " Audio activado.";
        });
      });
    }

    // Segunda opción, independiente de "Grabar esta reunión": en vez de
    // grabar acá mismo, le pide al asistente (el bot que ya usa
    // Seguimiento/Reuniones) que entre a esta reunión ya mismo -- así no
    // hace falta ir a la web, pegar el link y tocar "Unir el bot ya mismo"
    // a mano. Requiere haber iniciado sesión (necesita el token personal).
    chrome.storage.local.get(["token", "apiBase"], ({ token, apiBase }) => {
      if (!token) return; // sin sesión iniciada, ni mostrar el botón -- evita un error confuso
      joinAssistantBtn.style.display = "block";

      joinAssistantBtn.addEventListener("click", () => {
        joinAssistantBtn.disabled = true;
        const base = (apiBase || "https://chats.proshop.lat").replace(/\/$/, "");

        fetch(`${base}/api/extension/join-bot`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ meetingUrl, organizationId: orgBox.style.display === "none" ? undefined : orgSelect.value, title: meetingTitle() ?? undefined }),
        })
          .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
          .then(({ ok, data }) => {
            if (!ok) {
              status.textContent = data?.error || "No se pudo avisar al asistente.";
              status.style.color = "#dc2626";
              joinAssistantBtn.disabled = false;
              return;
            }
            joinAssistantBtn.textContent = "Asistente avisado — va a pedir unirse en un momento";
          })
          .catch(() => {
            status.textContent = "No se pudo conectar con el CRM.";
            status.style.color = "#dc2626";
            joinAssistantBtn.disabled = false;
          });
      });
    });
  });
});
