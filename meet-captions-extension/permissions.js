// Única página que pide el micrófono. Es una pestaña normal de la extensión (chrome-extension://<id>/permissions.html): a
// diferencia del panel lateral o del popup, no se cierra ni pierde el foco, así que el aviso de Chrome no se descarta solo.
// Se pide UNA vez; el permiso vale para todas las reuniones y quien graba lo detecta y suma tu voz sin reiniciar nada.
const btn = document.getElementById("grantBtn");
const status = document.getElementById("status");

function show(text, color) {
  status.textContent = text;
  status.style.color = color || "";
}

function done() {
  btn.style.display = "none";
  show("Listo: micrófono activado. Ya puedes volver a Meet; esta pestaña se cierra sola.", "#059669");
  chrome.storage.local.set({ micGranted: true });
  setTimeout(async () => {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab && tab.id != null) await chrome.tabs.remove(tab.id);
    } catch {
      /* si no se puede cerrar sola, se cierra a mano */
    }
  }, 1800);
}

function blocked() {
  btn.style.display = "none";
  show(
    "Chrome tiene bloqueado el micrófono para esta extensión. Para desbloquearlo: abre chrome://settings/content/microphone, busca «ProShop» en «No tienen permiso» y cámbialo a «Permitir». Luego vuelve a abrir esta pestaña.",
    "#b45309",
  );
}

(async () => {
  try {
    const perm = await navigator.permissions.query({ name: "microphone" });
    if (perm.state === "granted") return done();
    if (perm.state === "denied") return blocked();
  } catch {
    /* sin API de permisos: se deja el botón */
  }
})();

btn.addEventListener("click", async () => {
  btn.disabled = true;
  show("Acepta el aviso que muestra Chrome (arriba a la izquierda)…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    done();
  } catch (error) {
    if (error && error.name === "NotAllowedError") {
      // «Permission dismissed» = cerró el aviso sin elegir (se puede reintentar); «denied» = lo bloqueó.
      if (/dismissed/i.test(error.message || "")) show("Cerraste el aviso sin elegir. Pulsa el botón otra vez y elige «Permitir».", "#dc2626");
      else blocked();
    } else if (error && error.name === "NotFoundError") {
      show("No se encontró ningún micrófono conectado. Conecta uno y vuelve a intentarlo.", "#dc2626");
    } else {
      show("No se pudo activar: " + (error && error.message ? error.message : error), "#dc2626");
    }
  } finally {
    btn.disabled = false;
  }
});
