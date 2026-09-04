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
  Archive,
  ArchiveRestore,
  Ban,
  ShieldCheck,
  Bot as BotIcon,
  Search,
  Smile,
} from "lucide-react";
import { sendInboxMessageAction, sendInboxAttachmentAction } from "@/server/actions/inbox";
import {
  deleteMessageAction,
  setConversationStatusAction,
  setConversationBlockedAction,
  markConversationFromAdAction,
  pauseBotAction,
  resumeBotAction,
} from "@/server/actions/conversation-panel";
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
  status: "OPEN" | "ON_HOLD" | "CLOSED";
  blocked: boolean;
  bot: BotAccount;
  assignedTo: Vendor | null;
  botActive: boolean;
  needsAttention: boolean;
  unreadCount: number;
  lastMessage: {
    content: string;
    role: string;
    mediaType: MediaType | null;
    createdAt: string;
  } | null;
}

type MediaType = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";

interface AdReferralInfo {
  sourceId: string | null;
  sourceType: string | null;
  headline: string | null;
  body: string | null;
  mediaUrl: string | null;
  ctwaClid: string | null;
  adName?: string | null;
  campaignName?: string | null;
  adsetName?: string | null;
}

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
  errorDetail: string | null;
}

function StatusTicks({ status }: { status: Message["status"] }) {
  if (status === "FAILED") return <span className="text-danger">⚠️</span>;
  if (status === "READ") return <CheckCheck size={13} className="text-sky-400" />;
  if (status === "DELIVERED") return <CheckCheck size={13} />;
  return <Check size={13} />;
}

// Combina dos tandas de mensajes por id (sin duplicar) y las deja ordenadas
// por fecha — se usa tanto para el poll cada 2s (que solo trae lo último,
// sin pisar mensajes viejos ya cargados) como para "cargar más antiguos".
function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
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

const EMOJI_LIST = [
  "😀", "😁", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😍",
  "🥰", "😘", "😋", "😎", "🤩", "🥳", "😢", "😭", "😡", "🤬",
  "😱", "😴", "🤔", "🤗", "🙄", "😬", "🤐", "😷", "🤒", "🥺",
  "😅", "😆", "😳", "🥲", "😏", "😒", "🙁", "😞", "😔", "😩",
  "👍", "👎", "👌", "🙌", "👏", "🙏", "💪", "🤝", "✌️", "🤞",
  "👋", "🤙", "💯", "🔥", "✨", "🎉", "🎊", "❤️", "🧡", "💛",
  "💚", "💙", "💜", "🖤", "💔", "❤️‍🔥", "✅", "❌", "⚠️", "❓",
  "📌", "📎", "📅", "⏰", "💰", "💳", "📦", "🚚", "🛒", "🏢",
];

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

// Nombre por substring (sin distinguir mayúsculas) y teléfono comparando
// solo dígitos — así "591 700-123 45" encuentra igual buscando "70012345"
// o pegando el número tal cual viene con espacios/guiones.
function matchesSearch(c: ConversationSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((c.customerName || "").toLowerCase().includes(q)) return true;
  const digitsQuery = q.replace(/\D/g, "");
  return digitsQuery.length > 0 && c.customerPhone.replace(/\D/g, "").includes(digitsQuery);
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
  const [view, setView] = useState<"active" | "archived" | "blocked">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // "Ir al chat" desde Seguimiento llega como /dashboard/inbox?phone=... —
  // se lee una sola vez al montar (lazy initializer, no un efecto) para no
  // disparar un render extra.
  const [searchQuery, setSearchQuery] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("phone") ?? "",
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const hasMoreHistoryRef = useRef(false);
  const loadingOlderRef = useRef(false);
  function updateHasMoreHistory(value: boolean) {
    hasMoreHistoryRef.current = value;
    setHasMoreHistory(value);
  }
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<Vendor | null>(null);
  // Pasadas las 24h desde el último mensaje del cliente, WhatsApp ya no
  // deja mandar texto libre — solo una plantilla aprobada por Meta.
  const [outsideWindow, setOutsideWindow] = useState(false);
  const [conversationStatus, setConversationStatus] = useState<"OPEN" | "ON_HOLD" | "CLOSED">("OPEN");
  const [conversationBlocked, setConversationBlocked] = useState(false);
  const [conversationFromAd, setConversationFromAd] = useState(false);
  const [adReferralData, setAdReferralData] = useState<AdReferralInfo | null>(null);
  const [conversationBotPaused, setConversationBotPaused] = useState(false);
  const [conversationAiEnabled, setConversationAiEnabled] = useState(false);
  const [conversationBotId, setConversationBotId] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const prevUnreadRef = useRef<Map<string, number>>(new Map());
  const isFirstFetchRef = useRef(true);
  // En cuanto la lista traiga una conversación con este teléfono, se abre
  // sola (puede no venir en el primer fetch si cae en otra vista/cuenta).
  const pendingPhoneLinkRef = useRef<string | null>(
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("phone"),
  );
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
    const params = new URLSearchParams();
    if (selectedBotId) params.set("botId", selectedBotId);
    if (view !== "active") params.set("view", view);
    const qs = params.toString();
    const res = await fetch(`/api/inbox/conversations${qs ? `?${qs}` : ""}`);
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

    if (pendingPhoneLinkRef.current) {
      const match = list.find((c) => c.customerPhone === pendingPhoneLinkRef.current);
      if (match) {
        setSelectedId(match.id);
        pendingPhoneLinkRef.current = null;
      }
    }
  }, [selectedBotId, view]);

  const fetchMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/inbox/conversations/${id}/messages`);
    if (!res.ok) return;
    const data = await res.json();
    // Si mientras esperábamos la respuesta el usuario ya abrió otro chat,
    // esta respuesta es de un chat que ya no está seleccionado — aplicarla
    // igual pisaría los mensajes del chat nuevo con los del viejo.
    if (selectedIdRef.current !== id) return;
    // El poll cada 2s solo trae los últimos 100 — si ya se cargaron mensajes
    // más viejos (scroll hacia arriba), no hay que perderlos: se combinan
    // por id en vez de reemplazar todo el arreglo.
    setMessages((prev) => mergeMessages(prev, data.messages));
    updateHasMoreHistory(Boolean(data.hasMoreHistory));
    setMessagesLoading(false);
    setCustomerPhone(data.conversation.customerPhone);
    setCustomerName(data.conversation.customerName ?? null);
    setAssignedTo(data.conversation.assignedTo ?? null);
    setAdReferralData(data.conversation.adReferralData ?? null);
    setOutsideWindow(Boolean(data.conversation.outsideWindow));
    setConversationBotId(data.conversation.botId ?? null);
    setConversationStatus(data.conversation.status ?? "OPEN");
    setConversationBlocked(Boolean(data.conversation.blocked));
    setConversationFromAd(Boolean(data.conversation.adReferral));
    setConversationBotPaused(Boolean(data.conversation.botPaused));
    setConversationAiEnabled(Boolean(data.conversation.aiQualificationEnabled));
  }, []);

  const loadOlderMessages = useCallback(async () => {
    const id = selectedIdRef.current;
    const oldest = messages[0]?.createdAt;
    if (!id || !oldest || loadingOlderRef.current || !hasMoreHistoryRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);

    const container = scrollRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    try {
      const res = await fetch(
        `/api/inbox/conversations/${id}/messages?before=${encodeURIComponent(oldest)}`,
      );
      if (!res.ok || selectedIdRef.current !== id) return;
      const data = await res.json();
      setMessages((prev) => mergeMessages(prev, data.messages));
      updateHasMoreHistory(Boolean(data.hasMoreHistory));

      // Mantener la posición visual: sin esto, agregar contenido arriba
      // empuja todo hacia abajo y el usuario pierde de vista dónde estaba.
      requestAnimationFrame(() => {
        if (!container) return;
        container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
      });
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [messages]);

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
    // Se limpia lo del chat anterior antes de pedir lo nuevo: si no, mientras
    // llega la respuesta se ve la conversación de otra persona un instante,
    // que es justo lo que se sentía "lento"/confuso al cambiar de chat.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial + polling es intencional
    setMessages([]);
    setMessagesLoading(true);
    updateHasMoreHistory(false);
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

    if (el.scrollTop < 200 && hasMoreHistory) loadOlderMessages();
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
        errorDetail: null,
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

  // Cierra el selector de emojis al tocar afuera — mismo patrón que
  // cualquier popover, no hay overlay de fondo cubriendo toda la pantalla.
  useEffect(() => {
    if (!emojiPickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [emojiPickerOpen]);

  // Inserta en la posición del cursor (no siempre al final) y deja el foco
  // ahí mismo, para poder seguir escribiendo o agregar otro emoji seguido.
  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
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

  // Archivar/bloquear puede sacar la conversación de la vista actual (si
  // estabas en "Chats" y archivas, o viceversa) — se cierra el chat abierto
  // y se refresca la lista para no dejarla mostrando algo que ya no calza.
  // Solo se pide confirmación para el sentido destructivo (archivar,
  // bloquear); deshacerlo (desarchivar, desbloquear) es de un solo toque.
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  // Si se arma la confirmación de archivar/bloquear y se cambia de chat
  // antes de tocar de nuevo, no debe quedar "armada" para el chat nuevo.
  const [confirmSelectedId, setConfirmSelectedId] = useState(selectedId);
  if (confirmSelectedId !== selectedId) {
    setConfirmSelectedId(selectedId);
    if (confirmArchive) setConfirmArchive(false);
    if (confirmBlock) setConfirmBlock(false);
  }

  function toggleArchive() {
    const id = selectedIdRef.current;
    if (!id) return;
    if (conversationStatus !== "CLOSED" && !confirmArchive) {
      setConfirmArchive(true);
      setTimeout(() => setConfirmArchive(false), 3000);
      return;
    }
    setConfirmArchive(false);
    const nextStatus = conversationStatus === "CLOSED" ? "OPEN" : "CLOSED";
    setConversationStatus(nextStatus);
    setConversationStatusAction(id, nextStatus).then(() => {
      setSelectedId(null);
      fetchConversations();
    });
  }

  function toggleBlock() {
    const id = selectedIdRef.current;
    if (!id) return;
    if (!conversationBlocked && !confirmBlock) {
      setConfirmBlock(true);
      setTimeout(() => setConfirmBlock(false), 3000);
      return;
    }
    setConfirmBlock(false);
    const next = !conversationBlocked;
    setConversationBlocked(next);
    setConversationBlockedAction(id, next).then(() => {
      setSelectedId(null);
      fetchConversations();
    });
  }

  function toggleBot() {
    const id = selectedIdRef.current;
    if (!id) return;
    const next = !conversationBotPaused;
    setConversationBotPaused(next);
    const action = next ? pauseBotAction(id) : resumeBotAction(id);
    action.then(() => fetchConversations());
  }

  function markFromAd() {
    const id = selectedIdRef.current;
    if (!id) return;
    setConversationFromAd(true);
    markConversationFromAdAction(id).then((result) => {
      if (result.error) {
        setConversationFromAd(false);
        setError(result.error);
      }
    });
  }

  const filteredConversations = conversations.filter((c) => matchesSearch(c, searchQuery));

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

        <div className="flex min-h-[36px] shrink-0 items-center gap-1 border-b border-border bg-surface px-3 py-1.5">
          {(
            [
              ["active", "Chats"],
              ["archived", "Archivados"],
              ["blocked", "Bloqueados"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setView(v);
                setSelectedId(null);
              }}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                view === v ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre o teléfono…"
              className="w-full rounded-full border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-xs text-ink outline-none focus:border-accent-dim"
            />
          </div>
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
              : view === "archived"
                ? "No hay conversaciones archivadas."
                : view === "blocked"
                  ? "No hay conversaciones bloqueadas."
                  : "Los mensajes que te escriban por WhatsApp van a aparecer acá."}
          </p>
        )}
        {conversations.length > 0 && filteredConversations.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-faint">
            Ninguna conversación coincide con &quot;{searchQuery}&quot;.
          </p>
        )}
        {filteredConversations.map((c) => (
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
                  {c.lastMessage.role === "BOT" ? "Bot: " : ""}
                  {c.lastMessage.role === "SYSTEM" ? "⚠ " : ""}
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
                {c.needsAttention && (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-danger-dim px-1.5 py-0.5 font-medium text-danger">
                    <AlertTriangle size={10} /> Necesita atención
                  </span>
                )}
                {!c.needsAttention && c.botActive && (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 font-medium text-accent">
                    <BotIcon size={10} /> Bot
                  </span>
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
                <p className="flex items-center gap-1.5 truncate font-display text-sm font-semibold text-ink">
                  {customerName || customerPhone}
                  {conversationFromAd ? (
                    <span
                      title={
                        adReferralData?.headline
                          ? `Vino del anuncio "${adReferralData.headline}"${adReferralData.campaignName ? ` — campaña "${adReferralData.campaignName}"` : ""}${adReferralData.body ? ` — ${adReferralData.body}` : ""}`
                          : "Este lead llegó por un anuncio de Meta (Click to WhatsApp) — tiene 72h de gracia sin necesitar plantilla."
                      }
                      className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent"
                    >
                      Anuncio
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={markFromAd}
                      title="Marcar a mano que este chat vino de un anuncio. Ojo: esto solo cambia lo que ve el panel — si Meta no tiene realmente activa la ventana extendida, el mensaje igual puede rebotar."
                      className="shrink-0 cursor-pointer rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-faint hover:border-accent-dim hover:text-accent"
                    >
                      Marcar anuncio
                    </button>
                  )}
                </p>
                {customerName && (
                  <p className="truncate font-mono text-xs text-ink-faint">{customerPhone}</p>
                )}
                {conversationFromAd && adReferralData?.headline && (
                  <p className="truncate text-xs text-accent">
                    📢 {adReferralData.headline}
                    {adReferralData.campaignName && ` · ${adReferralData.campaignName}`}
                  </p>
                )}
              </div>
              {conversationAiEnabled && conversationBotPaused && (
                <button
                  type="button"
                  onClick={toggleBot}
                  title="Reactivar el bot en esta conversación"
                  className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    messages.at(-1)?.role === "SYSTEM"
                      ? "bg-danger-dim text-danger hover:opacity-80"
                      : "bg-surface-2 text-ink-muted hover:text-ink"
                  }`}
                >
                  {messages.at(-1)?.role === "SYSTEM" && <AlertTriangle size={12} />}
                  {messages.at(-1)?.role === "SYSTEM" ? "Necesita atención" : "Bot pausado"} · Reactivar
                </button>
              )}
              {conversationAiEnabled && !conversationBotPaused && (
                <button
                  type="button"
                  onClick={toggleBot}
                  title="Tomar control: pausa el bot en esta conversación sin mandar ningún mensaje"
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:opacity-80"
                >
                  <BotIcon size={12} /> Bot activo · Tomar control
                </button>
              )}
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
                onClick={toggleBlock}
                aria-label={conversationBlocked ? "Desbloquear" : confirmBlock ? "¿Seguro? Toca de nuevo" : "Bloquear"}
                title={conversationBlocked ? "Desbloquear" : confirmBlock ? "¿Seguro? Toca de nuevo" : "Bloquear"}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface ${
                  conversationBlocked || confirmBlock ? "text-danger" : "text-ink-muted"
                } ${confirmBlock ? "ring-2 ring-danger" : ""}`}
              >
                {conversationBlocked ? <ShieldCheck size={18} /> : <Ban size={18} />}
              </button>
              <button
                type="button"
                onClick={toggleArchive}
                aria-label={
                  conversationStatus === "CLOSED" ? "Desarchivar" : confirmArchive ? "¿Seguro? Toca de nuevo" : "Archivar"
                }
                title={
                  conversationStatus === "CLOSED" ? "Desarchivar" : confirmArchive ? "¿Seguro? Toca de nuevo" : "Archivar"
                }
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface ${
                  conversationStatus === "CLOSED" ? "text-accent" : confirmArchive ? "text-danger" : "text-ink-muted"
                } ${confirmArchive ? "ring-2 ring-danger" : ""}`}
              >
                {conversationStatus === "CLOSED" ? <ArchiveRestore size={18} /> : <Archive size={18} />}
              </button>
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

            {conversationBlocked && (
              <div className="flex items-center gap-2 border-b border-danger/30 bg-danger-dim px-4 py-2 text-xs text-danger">
                <Ban size={13} />
                Esta conversación está bloqueada — no se pueden mandar mensajes hasta desbloquearla.
              </div>
            )}

            <div
              ref={scrollRef}
              onScroll={handleMessagesScroll}
              className="wa-wallpaper flex-1 space-y-2 overflow-y-auto px-3 py-4 md:px-5"
            >
              {messagesLoading && messages.length === 0 && (
                <div className="flex h-full items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-ink-faint" />
                </div>
              )}
              {loadingOlder && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 size={16} className="animate-spin text-ink-faint" />
                </div>
              )}
              {messages.map((m, i) => {
                const mine = m.role === "STAFF" || m.role === "BOT";
                const confirming = confirmDeleteMessageId === m.id;
                const prev = messages[i - 1];
                const showDateDivider =
                  !prev || !isSameDay(new Date(prev.createdAt), new Date(m.createdAt));

                // Los avisos del sistema (ej. "Bot escaló a un humano") no
                // son de nadie en particular — no tienen sentido como
                // burbuja de chat de un lado o del otro, van centrados como
                // un aviso, igual que el separador de fecha.
                if (m.role === "SYSTEM") {
                  return (
                    <div key={m.id}>
                      {showDateDivider && (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-ink-muted shadow-sm">
                            {dayLabel(m.createdAt)}
                          </span>
                        </div>
                      )}
                      <div className="my-1.5 flex justify-center">
                        <span className="flex max-w-[85%] items-center gap-1.5 rounded-full bg-danger-dim px-3 py-1.5 text-center text-[11px] font-medium text-danger shadow-sm">
                          <AlertTriangle size={12} className="shrink-0" />
                          {m.content}
                        </span>
                      </div>
                    </div>
                  );
                }

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
                        m.role === "BOT"
                          ? "bg-accent/15 text-ink"
                          : mine
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
                        {m.role === "BOT" && <BotIcon size={11} />}
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
                      {m.status === "FAILED" && m.errorDetail && (
                        <p className="mt-1 text-[11px] leading-snug text-danger opacity-90">
                          ⚠️ No se entregó: {m.errorDetail}
                        </p>
                      )}
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

              {conversationBlocked ? (
                <div className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2.5 text-sm text-ink-muted">
                  <span>Esta conversación está bloqueada.</span>
                  <Button type="button" variant="secondary" className="shrink-0" onClick={toggleBlock}>
                    Desbloquear
                  </Button>
                </div>
              ) : outsideWindow ? (
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
                <div className="relative flex items-end gap-1.5 md:gap-2">
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
                  <button
                    onClick={() => setEmojiPickerOpen((v) => !v)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface ${
                      emojiPickerOpen ? "text-accent" : "text-ink-muted"
                    }`}
                    title="Emojis"
                  >
                    <Smile size={19} />
                  </button>
                  {emojiPickerOpen && (
                    <div
                      ref={emojiPickerRef}
                      className="absolute bottom-full left-0 z-10 mb-2 grid w-64 grid-cols-8 gap-0.5 rounded-lg border border-border bg-surface-2 p-2 shadow-lg"
                    >
                      {EMOJI_LIST.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="flex h-7 w-7 items-center justify-center rounded text-lg hover:bg-surface"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
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
                    className="max-h-32 min-w-0 flex-1 resize-none rounded-3xl border-none bg-surface px-4 py-2.5 text-base text-ink outline-none transition-shadow focus:ring-1 focus:ring-accent-dim md:text-sm"
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
