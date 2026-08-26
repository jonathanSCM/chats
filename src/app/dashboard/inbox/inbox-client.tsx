"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Send,
  Paperclip,
  FileText,
  X,
  Smartphone,
  Check,
  CheckCheck,
  Mic,
  Square,
  Trash2,
  ArrowLeft,
  Bell,
  Loader2,
  AlertTriangle,
  PanelRight,
} from "lucide-react";
import { sendInboxMessageAction, sendInboxAttachmentAction } from "@/server/actions/inbox";
import { deleteMessageAction } from "@/server/actions/conversation-panel";
import { vendorColor } from "@/lib/vendor-color";
import { usePushNotifications } from "@/lib/use-push-notifications";
import { Button } from "@/components/ui/button";
import { ConversationPanel } from "./_components/conversation-panel";
import { TemplatePickerModal } from "./_components/template-picker-modal";

interface Vendor {
  id: string;
  name: string;
  color: string | null;
}

interface BotAccount {
  id: string;
  name: string;
}

interface ConversationSummary {
  id: string;
  customerPhone: string;
  customerName: string | null;
  lastMessageAt: string;
  bot: BotAccount;
  assignedTo: Vendor | null;
  unreadCount: number;
  lastMessage: {
    content: string;
    role: string;
    mediaType: MediaType | null;
    createdAt: string;
  } | null;
}

type MediaType = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";

interface Message {
  id: string;
  role: "CUSTOMER" | "BOT" | "STAFF" | "SYSTEM";
  content: string;
  createdAt: string;
  mediaUrl: string | null;
  mediaType: MediaType | null;
  mediaStatus: "PENDING" | "READY" | "FAILED" | null;
  mimeType: string | null;
  fileName: string | null;
  viaPhoneApp: boolean;
  isHistorical: boolean;
  sentBy: Vendor | null;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
}

function StatusTicks({ status }: { status: Message["status"] }) {
  if (status === "FAILED") return <span className="text-danger">⚠️</span>;
  if (status === "READ") return <CheckCheck size={13} className="text-sky-400" />;
  if (status === "DELIVERED") return <CheckCheck size={13} />;
  return <Check size={13} />;
}

const roleLabel: Record<Message["role"], string> = {
  CUSTOMER: "Cliente",
  BOT: "Bot",
  STAFF: "Tú",
  SYSTEM: "Sistema",
};

const mediaPreviewLabel: Record<MediaType, string> = {
  IMAGE: "📷 Foto",
  VIDEO: "🎥 Video",
  AUDIO: "🎵 Audio",
  DOCUMENT: "📄 Documento",
};

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function linkify(text: string, mine: boolean) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) =>
    URL_REGEX.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className={`underline underline-offset-2 ${mine ? "hover:opacity-80" : "text-accent hover:opacity-80"}`}
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function timeFmt(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

// "Hoy" / "Ayer" / fecha corta — la fecha lleva año solo si no es el actual,
// como en WhatsApp.
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) return "Hoy";
  if (isSameDay(date, yesterday)) return "Ayer";
  return date.toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

// En la lista de chats: hora si es de hoy, si no la fecha — igual que
// WhatsApp, para no confundir "3:45" de hace tres días con la de hace rato.
function listTimeFmt(iso: string): string {
  return isSameDay(new Date(iso), new Date()) ? timeFmt(iso) : dayLabel(iso);
}

function durationFmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Sonido de aviso generado con Web Audio (sin archivo de audio que
// mantener): suena mientras la pestaña esté abierta, sin depender de que
// el push del navegador llegue a tiempo — que es justo lo que puede fallar
// (ver notas sobre hibernación de pestañas en Windows/Chrome).
let notificationAudioCtx: AudioContext | null = null;

function playNotificationSound() {
  try {
    const AudioCtxClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return;

    notificationAudioCtx ??= new AudioCtxClass();
    const ctx = notificationAudioCtx;
    if (ctx.state === "suspended") ctx.resume();

    const now = ctx.currentTime;
    // Dos tonos cortos ("ding-dong"), no un pitido plano.
    [
      { freq: 880, start: 0, duration: 0.16 },
      { freq: 1175, start: 0.11, duration: 0.2 },
    ].forEach(({ freq, start, duration }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    });
  } catch {
    // Web Audio bloqueado (autoplay) o no disponible: se pierde el sonido,
    // no es razón para romper el polling de conversaciones.
  }
}

function MessageMedia({ message }: { message: Message }) {
  if (!message.mediaType) return null;

  // El archivo se descarga en un job aparte, así que el mensaje puede
  // aparecer antes de que esté disponible.
  if (message.mediaStatus === "PENDING") {
    return (
      <div className="mb-1.5 flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-2 text-xs">
        <Loader2 size={14} className="shrink-0 animate-spin" />
        <span>Descargando {mediaPreviewLabel[message.mediaType].toLowerCase()}…</span>
      </div>
    );
  }

  if (message.mediaStatus === "FAILED" || !message.mediaUrl) {
    return (
      <div className="mb-1.5 flex items-center gap-2 rounded-md border border-danger/30 bg-danger-dim px-3 py-2 text-xs text-danger">
        <AlertTriangle size={14} className="shrink-0" />
        <span>No se pudo descargar el archivo.</span>
      </div>
    );
  }

  switch (message.mediaType) {
    case "IMAGE":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={message.mediaUrl}
          alt={message.fileName ?? "imagen"}
          className="mb-1.5 max-h-72 w-full rounded-md object-cover"
        />
      );
    case "VIDEO":
      return (
        <video src={message.mediaUrl} controls className="mb-1.5 max-h-72 w-full rounded-md" />
      );
    case "AUDIO":
      return (
        <audio src={message.mediaUrl} controls className="mb-1.5 w-56 max-w-full sm:w-64" />
      );
    case "DOCUMENT":
      return (
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          download={message.fileName ?? undefined}
          className="mb-1.5 flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-2 text-sm hover:bg-black/10"
        >
          <FileText size={18} className="shrink-0" />
          <span className="truncate">{message.fileName ?? "Archivo"}</span>
        </a>
      );
    default:
      return null;
  }
}

// Tipos aceptados en el selector de archivos: imágenes, video, audio,
// documentos de oficina, PDFs y APKs. WhatsApp acepta prácticamente
// cualquier archivo como "documento" (se muestra con ícono genérico).
const ACCEPTED_FILE_TYPES =
  "image/*,video/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip,.rar,.apk,.json";

// El navegador elige el primero que soporte. Safari da audio/mp4 (que
// WhatsApp acepta tal cual); Chrome da webm y el servidor lo convierte.
const RECORDER_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
];

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

function initialsFor(nameOrPhone: string): string {
  const trimmed = nameOrPhone.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Círculo de color determinístico + iniciales, como el avatar por defecto
// de un contacto sin foto en WhatsApp.
function Avatar({ id, label, size = 40 }: { id: string; label: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: vendorColor(id), fontSize: size * 0.36 }}
    >
      {initialsFor(label)}
    </span>
  );
}

export function InboxClient({
  currentUserId,
  isAdmin,
  bots,
}: {
  currentUserId: string;
  isAdmin: boolean;
  /** Cuentas de WhatsApp que este usuario puede ver — para el selector del lateral. */
  bots: BotAccount[];
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<Vendor | null>(null);
  // Pasadas las 24h desde el último mensaje del cliente, WhatsApp ya no
  // deja mandar texto libre — solo una plantilla aprobada por Meta.
  const [outsideWindow, setOutsideWindow] = useState(false);
  const [conversationBotId, setConversationBotId] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmDeleteMessageId, setConfirmDeleteMessageId] = useState<string | null>(null);
  const confirmDeleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Si el usuario se desplazó hacia arriba a leer mensajes viejos, el
  // refresco cada 2s no debe arrancarlo de ahí — solo se sigue bajando
  // sola si ya estaba cerca del final.
  const isNearBottomRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const prevUnreadRef = useRef<Map<string, number>>(new Map());
  const isFirstFetchRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRecordRef = useRef(false);

  const { status: pushStatus, subscribe: subscribePush } = usePushNotifications();

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Esc cierra el chat abierto y vuelve a la lista.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedIdRef.current) setSelectedId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Tocar una notificación del sistema abre esa conversación.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function onMessage(event: MessageEvent) {
      if (event.data?.type === "OPEN_CONVERSATION" && event.data.conversationId) {
        setSelectedId(event.data.conversationId);
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Alto calculado en JS (no vh-fijo): se adapta a lo que haya arriba
  // (barra móvil, banners) y a la barra de direcciones de los navegadores
  // móviles, que cambia de alto al hacer scroll.
  useEffect(() => {
    function recalc() {
      if (!rootRef.current) return;
      const top = rootRef.current.getBoundingClientRect().top;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      setHeight(viewport - top);
    }
    recalc();
    window.addEventListener("resize", recalc);
    window.visualViewport?.addEventListener("resize", recalc);
    const timeout = setTimeout(recalc, 200);
    return () => {
      window.removeEventListener("resize", recalc);
      window.visualViewport?.removeEventListener("resize", recalc);
      clearTimeout(timeout);
    };
  }, []);

  const fetchConversations = useCallback(async () => {
    const res = await fetch(
      selectedBotId
        ? `/api/inbox/conversations?botId=${selectedBotId}`
        : "/api/inbox/conversations",
    );
    if (!res.ok) return;
    const list: ConversationSummary[] = await res.json();

    // El primer fetch (al montar) no debe sonar ni notificar: todo lo que
    // ya estaba sin leer parecería "nuevo" al no haber un `prevUnread` con
    // qué compararlo.
    const isFirstFetch = isFirstFetchRef.current;
    isFirstFetchRef.current = false;

    // Sonido: suena para cualquier mensaje nuevo mientras la pestaña esté
    // abierta, sin depender de permisos ni de que el push llegue a tiempo.
    // Notificación del sistema: solo si además el chat no es el que está
    // abierto (si no, sería redundante con lo que ya se ve en pantalla) y
    // hay permiso concedido — con la app cerrada, el service worker recibe
    // el push del servidor en su lugar.
    let hasNewMessage = false;
    for (const c of list) {
      const prevUnread = prevUnreadRef.current.get(c.id) ?? 0;
      if (isFirstFetch || c.unreadCount <= prevUnread) continue;

      // El chat que ya tienes abierto no debe sonar ni notificar: lo estás
      // viendo llegar en tiempo real, y encima su unreadCount todavía puede
      // aparecer "subido" un instante mientras el servidor procesa la marca
      // de leído — sonaría al simple hecho de cambiar de chat.
      if (c.id === selectedIdRef.current) continue;

      hasNewMessage = true;

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState === "visible"
      ) {
        new Notification(c.customerName || c.customerPhone, {
          body: c.lastMessage?.content || "Nuevo mensaje",
          tag: c.id,
          icon: "/icon-192.png",
        });
      }
    }
    if (hasNewMessage) playNotificationSound();

    // Se actualiza sin reemplazar el mapa entero: un chat que quede
    // momentáneamente fuera de esta respuesta (filtro de cuenta, etc.) no
    // debe perder su último conteo conocido — si no, al reaparecer se
    // compararía contra 0 y sonaría como si fuera nuevo otra vez.
    for (const c of list) {
      prevUnreadRef.current.set(c.id, c.unreadCount);
    }

    const totalUnread = list.reduce((sum, c) => sum + c.unreadCount, 0);
    document.title = totalUnread > 0 ? `(${totalUnread}) WhatsApp ProShop` : "WhatsApp ProShop";

    setConversations(list);
  }, [selectedBotId]);

  const fetchMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/inbox/conversations/${id}/messages`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages);
    setCustomerPhone(data.conversation.customerPhone);
    setCustomerName(data.conversation.customerName ?? null);
    setAssignedTo(data.conversation.assignedTo ?? null);
    setOutsideWindow(Boolean(data.conversation.outsideWindow));
    setConversationBotId(data.conversation.botId ?? null);
  }, []);

  // Polling de la lista de conversaciones cada 3s — tiempo real sin websockets.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial + polling es intencional
    fetchConversations();
    const interval = setInterval(fetchConversations, 3000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // Polling de los mensajes del chat abierto cada 2s.
  useEffect(() => {
    if (!selectedId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial + polling es intencional
    fetchMessages(selectedId);
    const interval = setInterval(() => fetchMessages(selectedId), 2000);
    return () => clearInterval(interval);
  }, [selectedId, fetchMessages]);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Se resetea a "cerca del final" cada vez que se abre un chat distinto —
  // siempre debe arrancar mostrando lo último, sin importar dónde había
  // quedado el scroll del chat anterior.
  useEffect(() => {
    isNearBottomRef.current = true;
  }, [selectedId]);

  function handleMessagesScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 150;
  }

  const sendFile = useCallback(
    async (file: File, caption: string) => {
      const conversationId = selectedIdRef.current;
      if (!conversationId) return;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("caption", caption);
      const result = await sendInboxAttachmentAction(conversationId, formData);
      if (result.error) setError(result.error);
      await fetchMessages(conversationId);
      await fetchConversations();
    },
    [fetchMessages, fetchConversations],
  );

  async function startRecording() {
    if (recording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      cancelRecordRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        setRecording(false);
        setRecordSeconds(0);

        if (cancelRecordRef.current || chunks.length === 0) return;

        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        setSending(true);
        await sendFile(new File([blob], `nota-de-voz.${ext}`, { type }), "");
        setSending(false);
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setError("No se pudo acceder al micrófono. Revisa los permisos del navegador.");
    }
  }

  function stopRecording(cancel: boolean) {
    cancelRecordRef.current = cancel;
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  async function handleSend() {
    if (!selectedId || sending) return;
    if (!pendingFile && !draft.trim()) return;
    setSending(true);
    setError(null);

    if (pendingFile) {
      const file = pendingFile;
      const caption = draft;
      setPendingFile(null);
      setDraft("");
      await sendFile(file, caption);
    } else {
      const content = draft;
      setDraft("");
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        role: "STAFF",
        content,
        createdAt: new Date().toISOString(),
        mediaUrl: null,
        mediaType: null,
        mediaStatus: null,
        mimeType: null,
        fileName: null,
        viaPhoneApp: false,
        isHistorical: false,
        sentBy: null,
        status: "SENT",
      };
      setMessages((prev) => [...prev, optimistic]);

      const result = await sendInboxMessageAction(selectedId, content);
      if (result.error) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError(result.error);
      }
      await fetchMessages(selectedId);
      await fetchConversations();
    }

    setSending(false);
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    e.target.value = "";
  }

  // Doble toque para confirmar, mismo patrón que "Eliminar chat": el primer
  // toque arma el borrado por 3s, el segundo lo ejecuta.
  function handleDeleteMessage(messageId: string) {
    if (confirmDeleteMessageId !== messageId) {
      setConfirmDeleteMessageId(messageId);
      if (confirmDeleteTimeoutRef.current) clearTimeout(confirmDeleteTimeoutRef.current);
      confirmDeleteTimeoutRef.current = setTimeout(() => setConfirmDeleteMessageId(null), 3000);
      return;
    }
    setConfirmDeleteMessageId(null);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    deleteMessageAction(messageId).then((result) => {
      if (result.error) {
        setError(result.error);
        if (selectedIdRef.current) fetchMessages(selectedIdRef.current);
      }
    });
  }

  function handleConversationDeleted() {
    const deletedId = selectedIdRef.current;
    setPanelOpen(false);
    setSelectedId(null);
    setConversations((prev) => prev.filter((c) => c.id !== deletedId));
    fetchConversations();
  }

  return (
    <div
      ref={rootRef}
      className="relative -mx-4 -mb-5 flex overflow-hidden md:-mx-8 md:-mb-8"
      style={{ height: height ? `${height}px` : "calc(100vh - 8rem)" }}
    >
      {/* Lista de conversaciones — pantalla completa en móvil, columna fija en escritorio */}
      <aside
        className={`w-full shrink-0 flex-col overflow-y-auto border-r border-border bg-surface md:flex md:w-80 ${
          selectedId ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface-2 px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-display text-lg font-semibold text-ink">Chats</h1>
            {pushStatus === "prompt" && (
              <button
                type="button"
                onClick={subscribePush}
                className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-surface"
                title="Recibir notificaciones de mensajes nuevos"
              >
                <Bell size={12} /> Activar avisos
              </button>
            )}
          </div>
          {isAdmin && (
            <p className="text-xs text-ink-faint">
              Vista de administrador — todas las conversaciones
            </p>
          )}
        </div>

        {bots.length > 1 && (
          <div className="flex min-h-[42px] shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-surface px-3 py-2">
            <button
              type="button"
              onClick={() => setSelectedBotId(null)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                selectedBotId === null
                  ? "bg-accent text-accent-ink"
                  : "bg-surface-2 text-ink-muted hover:text-ink"
              }`}
            >
              Todas
            </button>
            {bots.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => setSelectedBotId(bot.id)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedBotId === bot.id
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-2 text-ink-muted hover:text-ink"
                }`}
              >
                {bot.name}
              </button>
            ))}
          </div>
        )}

        {conversations.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-faint">
            {!isAdmin && bots.length === 0
              ? "No tienes ninguna cuenta de WhatsApp asignada — pide al dueño de la organización que te dé acceso."
              : "No hay conversaciones todavía."}
          </p>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
              selectedId === c.id ? "bg-surface-2" : ""
            }`}
          >
            <Avatar id={c.id} label={c.customerName || c.customerPhone} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">
                  {c.customerName || c.customerPhone}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {c.unreadCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                      {c.unreadCount}
                    </span>
                  )}
                  {c.lastMessage && (
                    <span className="font-mono text-[11px] text-ink-faint">
                      {listTimeFmt(c.lastMessage.createdAt)}
                    </span>
                  )}
                </div>
              </div>
              {c.lastMessage && (
                <span className="block truncate text-xs text-ink-muted">
                  {c.lastMessage.role === "STAFF" ? "Tú: " : ""}
                  {c.lastMessage.mediaType
                    ? mediaPreviewLabel[c.lastMessage.mediaType]
                    : c.lastMessage.content}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: c.assignedTo
                      ? vendorColor(c.assignedTo.id, c.assignedTo.color)
                      : "var(--color-ink-faint)",
                  }}
                />
                <span className="text-ink-faint">
                  {c.assignedTo
                    ? c.assignedTo.id === currentUserId
                      ? "Tú"
                      : c.assignedTo.name
                    : "Sin asignar"}
                </span>
                {bots.length > 1 && !selectedBotId && (
                  <>
                    <span className="text-ink-faint">·</span>
                    <span className="truncate text-ink-faint">{c.bot.name}</span>
                  </>
                )}
              </span>
            </div>
          </button>
        ))}
      </aside>

      {/* Chat activo */}
      <section
        className={`min-w-0 flex-1 flex-col overflow-hidden ${selectedId ? "flex" : "hidden md:flex"}`}
      >
        {!selectedId ? (
          <div className="wa-wallpaper flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-faint">
            Selecciona una conversación para empezar.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2.5 md:px-5 md:py-3">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Volver a la lista"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface md:hidden"
              >
                <ArrowLeft size={18} />
              </button>
              <Avatar id={selectedId} label={customerName || customerPhone} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold text-ink">
                  {customerName || customerPhone}
                </p>
                {customerName && (
                  <p className="truncate font-mono text-xs text-ink-faint">{customerPhone}</p>
                )}
              </div>
              {assignedTo && (
                <span
                  className="max-w-[7rem] shrink-0 truncate rounded-full px-2.5 py-1 text-xs font-medium text-white"
                  style={{ backgroundColor: vendorColor(assignedTo.id, assignedTo.color) }}
                >
                  {assignedTo.id === currentUserId ? "Tú" : assignedTo.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-label="Ficha del contacto"
                title="Ficha del contacto"
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface ${
                  panelOpen ? "text-accent" : "text-ink-muted"
                }`}
              >
                <PanelRight size={18} />
              </button>
            </div>

            <div
              ref={scrollRef}
              onScroll={handleMessagesScroll}
              className="wa-wallpaper flex-1 space-y-2 overflow-y-auto px-3 py-4 md:px-5"
            >
              {messages.map((m, i) => {
                const mine = m.role === "STAFF" || m.role === "BOT";
                const confirming = confirmDeleteMessageId === m.id;
                const prev = messages[i - 1];
                const showDateDivider =
                  !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));
                return (
                  <div key={m.id}>
                    {showDateDivider && (
                      <div className="my-3 flex justify-center">
                        <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-ink-muted shadow-sm">
                          {dayLabel(m.createdAt)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`group flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}
                    >
                    {mine && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(m.id)}
                        title={confirming ? "¿Seguro? Toca de nuevo" : "Borrar mensaje"}
                        className={`shrink-0 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 active:opacity-100 ${
                          confirming ? "opacity-100 text-danger" : "text-ink-faint hover:text-danger"
                        }`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm md:max-w-[70%] ${
                        mine
                          ? "bg-[var(--wa-bubble-out)] text-ink"
                          : "bg-surface text-ink"
                      }`}
                    >
                      <MessageMedia message={m} />
                      {m.content && (
                        <p className="whitespace-pre-wrap break-words">
                          {linkify(m.content, mine)}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-70">
                        {m.viaPhoneApp && (
                          <>
                            <Smartphone size={11} />
                            <span>·</span>
                          </>
                        )}
                        <span>
                          {m.sentBy
                            ? m.sentBy.id === currentUserId
                              ? "Tú"
                              : m.sentBy.name
                            : roleLabel[m.role]}
                        </span>
                        <span>·</span>
                        <span>{timeFmt(m.createdAt)}</span>
                        {m.role === "STAFF" && !m.viaPhoneApp && <StatusTicks status={m.status} />}
                      </div>
                    </div>
                      {!mine && (
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(m.id)}
                          title={confirming ? "¿Seguro? Toca de nuevo" : "Borrar mensaje"}
                          className={`shrink-0 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100 active:opacity-100 ${
                            confirming ? "opacity-100 text-danger" : "text-ink-faint hover:text-danger"
                          }`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Compositor fijo abajo, estilo WhatsApp */}
            <div className="border-t border-border bg-surface-2 px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:px-4 md:py-3">
              {error && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-danger-dim px-3 py-1.5 text-xs text-danger">
                  <span className="min-w-0">{error}</span>
                  <button onClick={() => setError(null)} className="shrink-0">
                    <X size={14} />
                  </button>
                </div>
              )}
              {pendingFile && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 text-xs text-ink-muted">
                  <span className="truncate">📎 {pendingFile.name}</span>
                  <button onClick={() => setPendingFile(null)} className="shrink-0">
                    <X size={14} />
                  </button>
                </div>
              )}

              {outsideWindow ? (
                <div className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2.5 text-sm text-ink-muted">
                  <span>
                    Pasaron más de 24h desde el último mensaje del cliente — solo puedes escribirle
                    con una plantilla aprobada.
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => setTemplatePickerOpen(true)}
                  >
                    Enviar plantilla
                  </Button>
                </div>
              ) : recording ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => stopRecording(true)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-danger"
                    title="Cancelar"
                  >
                    <Trash2 size={18} />
                  </button>
                  <div className="flex flex-1 items-center gap-2 text-sm text-ink">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
                    <span className="font-mono">{durationFmt(recordSeconds)}</span>
                    <span className="text-ink-faint">Grabando…</span>
                  </div>
                  <button
                    onClick={() => stopRecording(false)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink"
                    title="Enviar nota de voz"
                  >
                    <Square size={16} fill="currentColor" />
                  </button>
                </div>
              ) : (
                <div className="flex items-end gap-1.5 md:gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={ACCEPTED_FILE_TYPES}
                    onChange={handleFilePick}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface"
                    title="Adjuntar archivo"
                  >
                    <Paperclip size={19} />
                  </button>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={pendingFile ? "Agrega un texto (opcional)…" : "Escribe un mensaje…"}
                    rows={1}
                    // text-base evita que iOS haga zoom automático al enfocar
                    className="max-h-32 min-w-0 flex-1 resize-none rounded-3xl border-none bg-surface px-4 py-2.5 text-base text-ink outline-none md:text-sm"
                  />
                  {draft.trim() || pendingFile ? (
                    <button
                      onClick={handleSend}
                      disabled={sending}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-40"
                      title="Enviar"
                    >
                      <Send size={18} />
                    </button>
                  ) : (
                    <button
                      onClick={startRecording}
                      disabled={sending}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-40"
                      title="Grabar nota de voz"
                    >
                      <Mic size={19} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Ficha del contacto. En pantallas chicas ocupa todo el ancho para
          no espachurrar el chat; en escritorio va como tercera columna. */}
      {selectedId && panelOpen && (
        <div className="absolute inset-0 z-20 flex lg:static lg:z-auto lg:w-80 lg:shrink-0">
          <ConversationPanel
            key={selectedId}
            conversationId={selectedId}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onClose={() => setPanelOpen(false)}
            onChanged={fetchConversations}
            onDeleted={handleConversationDeleted}
          />
        </div>
      )}

      {templatePickerOpen && selectedId && conversationBotId && (
        <TemplatePickerModal
          botId={conversationBotId}
          conversationId={selectedId}
          onClose={() => setTemplatePickerOpen(false)}
          onSent={() => {
            setTemplatePickerOpen(false);
            fetchMessages(selectedId);
            fetchConversations();
          }}
        />
      )}
    </div>
  );
}
