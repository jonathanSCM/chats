// Corre SOLO en /dashboard/extension-authorize (ver manifest.json) -- lee el
// token que esa página generó reusando la sesión ya iniciada del CRM, y lo
// guarda en chrome.storage.local. Reemplaza el flujo viejo de "generá un
// token en Organización, copialo, pegalo en la extensión".
(function () {
  "use strict";

  const el = document.getElementById("mext-token-bridge");
  if (!el) return;

  const token = el.dataset.token;
  const userName = el.dataset.name || null;
  if (!token) return;

  chrome.storage.local.set({ token, userName, apiBase: "https://chats.proshop.lat" });
})();
