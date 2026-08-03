"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Paperclip, FileText, X, Smartphone } from "lucide-react";
import { sendInboxMessageAction, sendInboxAttachmentAction } from "@/server/actions/inbox";
import { vendorColor } from "@/lib/vendor-color";

interface Vendor {
  id: string;
  name: string;
}

interface ConversationSummary {
  id: string;
  customerPhone: string;
  customerName: string | null;
  lastMessageAt: string;
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
  mimeType: string | null;
  fileName: string | null;
  viaPhoneApp: boolean;
  isHistorical: boolean;
  sentBy: Vendor | null;
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

function MessageMedia({ message }: { message: Message }) {
  if (!message.mediaUrl || !message.mediaType) return null;

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
      return <audio src={message.mediaUrl} controls className="mb-1.5 w-64 max-w-full" />;
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

export function InboxClient({
  currentUserId,
  isAdmin,
}: {
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<Vendor | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const prevUnreadRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Pide permiso de notificaciones del navegador una sola vez, al entrar al inbox.
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Alto calculado en JS (no vh-fijo): se adapta a lo que haya arriba
  // (banner de verificación, etc.) sin dejar el compositor "flotando" abajo.
  useEffect(() => {
    function recalc() {
      if (!rootRef.current) return;
      const top = rootRef.current.getBoundingClientRect().top;
      setHeight(window.innerHeight - top);
    }
    recalc();
    window.addEventListener("resize", recalc);
    const timeout = setTimeout(recalc, 200); // por si el banner tarda en pintar
    return () => {
      window.removeEventListener("resize", recalc);
      clearTimeout(timeout);
    };
  }, []);

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/inbox/conversations");
    if (!res.ok) return;
    const list: ConversationSummary[] = await res.json();

    // Detecta mensajes nuevos desde el último poll para avisar por
    // notificación del navegador (solo si el chat no es el que está abierto).
    for (const c of list) {
      const prevUnread = prevUnreadRef.current.get(c.id) ?? 0;
      if (
        c.unreadCount > prevUnread &&
        c.id !== selectedIdRef.current &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(c.customerName || c.customerPhone, {
          body: c.lastMessage?.content || "Nuevo mensaje",
          tag: c.id,
        });
      }
    }
    prevUnreadRef.current = new Map(list.map((c) => [c.id, c.unreadCount]));

    const totalUnread = list.reduce((sum, c) => sum + c.unreadCount, 0);
    document.title = totalUnread > 0 ? `(${totalUnread}) WhatsApp ProShop` : "WhatsApp ProShop";

    setConversations(list);
  }, []);

  const fetchMessages = useCallback(async (id: string) => {
    const res = await fetch(`/api/inbox/conversations/${id}/messages`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages);
    setCustomerPhone(data.conversation.customerPhone);
    setCustomerName(data.conversation.customerName ?? null);
    setAssignedTo(data.conversation.assignedTo ?? null);
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    if (!selectedId || sending) return;
    if (!pendingFile && !draft.trim()) return;
    setSending(true);
    setError(null);

    if (pendingFile) {
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("caption", draft);
      const result = await sendInboxAttachmentAction(selectedId, formData);
      if (result.error) setError(result.error);
      setPendingFile(null);
      setDraft("");
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
        mimeType: null,
        fileName: null,
        viaPhoneApp: false,
        isHistorical: false,
        sentBy: null,
      };
      setMessages((prev) => [...prev, optimistic]);

      const result = await sendInboxMessageAction(selectedId, content);
      if (result.error) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setError(result.error);
      }
    }

    fetchMessages(selectedId);
    fetchConversations();
    setSending(false);
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    e.target.value = "";
  }

  return (
    <div
      ref={rootRef}
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: height ? `${height}px` : "calc(100vh - 8rem)" }}
    >
      {/* Lista de conversaciones */}
      <aside className="w-80 shrink-0 border-r border-border bg-surface/60 overflow-y-auto">
        <div className="sticky top-0 border-b border-border bg-surface/90 px-4 py-4 backdrop-blur">
          <h1 className="font-display text-lg font-semibold text-ink">Chats</h1>
          {isAdmin && <p className="text-xs text-ink-faint">Vista de administrador — todas las conversaciones</p>}
        </div>
        {conversations.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-faint">No hay conversaciones todavía.</p>
        )}
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`flex w-full flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 ${
              selectedId === c.id ? "bg-surface-2" : ""
            }`}
          >
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
                    {timeFmt(c.lastMessage.createdAt)}
                  </span>
                )}
              </div>
            </div>
            {c.lastMessage && (
              <span className="truncate text-xs text-ink-muted">
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
                  backgroundColor: c.assignedTo ? vendorColor(c.assignedTo.id) : "var(--color-ink-faint)",
                }}
              />
              <span className="text-ink-faint">
                {c.assignedTo
                  ? c.assignedTo.id === currentUserId
                    ? "Tú"
                    : c.assignedTo.name
                  : "Sin asignar"}
              </span>
            </span>
          </button>
        ))}
      </aside>

      {/* Chat activo */}
      <section className="flex flex-1 flex-col overflow-hidden">
        {!selectedId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">
            Selecciona una conversación para empezar.
          </div>
        ) : (
          <>
            <div className="border-b border-border bg-surface/60 px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-display text-sm font-semibold text-ink">
                    {customerName || customerPhone}
                  </p>
                  {customerName && (
                    <p className="font-mono text-xs text-ink-faint">{customerPhone}</p>
                  )}
                </div>
                {assignedTo && (
                  <span
                    className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white"
                    style={{ backgroundColor: vendorColor(assignedTo.id) }}
                  >
                    {assignedTo.id === currentUserId ? "Tú" : assignedTo.name}
                  </span>
                )}
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {messages.map((m) => {
                const mine = m.role === "STAFF" || m.role === "BOT";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        mine ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"
                      }`}
                    >
                      <MessageMedia message={m} />
                      {m.content && (
                        <p className="whitespace-pre-wrap">{linkify(m.content, mine)}</p>
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
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input de mensaje fijo abajo, estilo WhatsApp */}
            <div className="border-t border-border bg-surface/80 px-4 py-3">
              {error && (
                <div className="mb-2 flex items-center justify-between rounded-md bg-danger-dim px-3 py-1.5 text-xs text-danger">
                  <span>{error}</span>
                  <button onClick={() => setError(null)}>
                    <X size={14} />
                  </button>
                </div>
              )}
              {pendingFile && (
                <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink-muted">
                  <span className="truncate">📎 {pendingFile.name}</span>
                  <button onClick={() => setPendingFile(null)}>
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={ACCEPTED_FILE_TYPES}
                  onChange={handleFilePick}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2"
                  title="Adjuntar archivo"
                >
                  <Paperclip size={18} />
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
                  className="max-h-32 flex-1 resize-none rounded-full border border-border bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-dim"
                />
                <button
                  onClick={handleSend}
                  disabled={(!draft.trim() && !pendingFile) || sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-40"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
