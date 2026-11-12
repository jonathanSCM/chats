// Ventana del ícono: fuera de una reunión permite crear una (meet.new), unirse con un enlace/código o abrir Meet; dentro de una
// reunión abre el panel lateral (subtítulos en vivo y «Grabar») o la ventana separada.
const $ = (id) => document.getElementById(id);
const MEETING_URL_RE = /^https:\/\/meet\.google\.com\/(?:meet\/)?[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
const open = (url) => {
  chrome.tabs.create({ url });
  window.close();
};

// Acepta «abc-defg-hij», «abcdefghij» o un enlace de meet.google.com. Devuelve la URL o null.
function toMeetUrl(input) {
  const v = (input || "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : "https://" + v);
    if (u.hostname === "meet.google.com" && u.pathname.length > 1) return u.origin + u.pathname + u.search;
  } catch {
    /* no era un enlace */
  }
  const m = v.toLowerCase().match(/^([a-z]{3})-?([a-z]{4})-?([a-z]{3})$/);
  return m ? `https://meet.google.com/${m[1]}-${m[2]}-${m[3]}` : null;
}

function showMenu() {
  $("vMenu").hidden = false;
  $("bNew").onclick = () => open("https://meet.new");
  $("bOpen").onclick = () => open("https://meet.google.com/");
  const join = () => {
    const url = toMeetUrl($("code").value);
    $("err").hidden = Boolean(url);
    if (!url) {
      $("err").textContent = "Escribe un código (abc-defg-hij) o un enlace de meet.google.com.";
      return;
    }
    open(url);
  };
  $("bJoin").onclick = join;
  $("code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });
  $("code").addEventListener("input", () => ($("err").hidden = true));
  $("code").focus();
}

function showRoom(tabId) {
  $("vRoom").hidden = false;
  $("sub").textContent = "En una reunión";
  // sidePanel.open pide un clic de la persona: va directo, sin await antes.
  $("bPanel").onclick = () => {
    chrome.sidePanel
      .open({ tabId })
      .then(() => window.close())
      .catch(() => {
        chrome.runtime.sendMessage({ type: "OPEN_DETACHED", tabId });
        window.close();
      });
  };
  $("bWin").onclick = () => {
    chrome.runtime.sendMessage({ type: "OPEN_DETACHED", tabId });
    window.close();
  };
}

(async () => {
  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    /* sin pestañas */
  }
  if (tab && tab.id != null && tab.url && MEETING_URL_RE.test(tab.url)) showRoom(tab.id);
  else showMenu();
})();
