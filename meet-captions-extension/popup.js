const tokenInput = document.getElementById("token");
const status = document.getElementById("status");

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
    status.textContent = "Guardado — ya podés unirte a una reunión.";
    status.style.color = "#059669";
  });
});
