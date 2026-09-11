// Corre en una pestaña normal de la extensión (chrome-extension://<id>/permissions.html),
// no en el popup -- el popup se cierra apenas pierde el foco y eso descartaba
// el diálogo de permiso de Chrome antes de poder aceptarlo ("Permission
// dismissed"). Una pestaña de verdad no tiene ese problema.
const btn = document.getElementById("grantBtn");
const status = document.getElementById("status");

chrome.storage.local.get(["micGranted"], ({ micGranted }) => {
  if (micGranted) {
    status.textContent = "Ya estaba activado. Podés cerrar esta pestaña.";
    status.style.color = "#059669";
  }
});

btn.addEventListener("click", async () => {
  btn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await chrome.storage.local.set({ micGranted: true });
    status.textContent = "Listo — micrófono activado. Ya podés cerrar esta pestaña.";
    status.style.color = "#059669";
  } catch (error) {
    status.textContent = "No se pudo activar: " + error.message;
    status.style.color = "#dc2626";
  } finally {
    btn.disabled = false;
  }
});
