"use client";

import { useState, useTransition } from "react";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { addMeetingAttachmentAction, deleteMeetingAttachmentAction } from "@/server/actions/crm";

export interface MeetingAttachmentInfo {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compartido entre Seguimiento (reuniones de clientes) y el panel de
 * Reuniones ad-hoc (sin oportunidad) — las acciones que usa
 * (`addMeetingAttachmentAction`/`deleteMeetingAttachmentAction`) ya son
 * null-safe respecto a `opportunity`, así que sirven para las dos.
 */
export function MeetingAttachments({
  meetingId,
  attachments,
  editable,
  disabled,
}: {
  meetingId: string;
  attachments: MeetingAttachmentInfo[];
  editable: boolean;
  disabled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function handleDeleteAttachment(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirmDeleteId(null);
    startTransition(async () => {
      await deleteMeetingAttachmentAction(id);
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    startTransition(async () => {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const result = await addMeetingAttachmentAction(meetingId, formData);
        if (result.error) {
          setUploadError(result.error);
          break;
        }
      }
    });
    e.target.value = "";
  }

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      {attachments.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 text-[11px]">
              <FileText size={11} className="shrink-0 text-ink-faint" />
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-accent hover:underline"
                title={a.fileName}
              >
                {a.fileName}
              </a>
              <span className="shrink-0 text-ink-faint">({formatFileSize(a.fileSize)})</span>
              {editable && (
                <button
                  type="button"
                  disabled={disabled || isPending}
                  onClick={() => handleDeleteAttachment(a.id)}
                  className={`ml-auto shrink-0 cursor-pointer disabled:cursor-not-allowed ${
                    confirmDeleteId === a.id ? "text-danger" : "text-ink-faint hover:text-danger"
                  }`}
                  title={confirmDeleteId === a.id ? "¿Seguro? Toca de nuevo" : "Borrar archivo"}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <label
          className={`flex w-fit items-center gap-1 text-[11px] ${
            disabled || isPending ? "cursor-not-allowed text-ink-faint" : "cursor-pointer text-accent hover:opacity-80"
          }`}
        >
          <Paperclip size={11} />
          {isPending ? "Subiendo…" : "Adjuntar archivo"}
          <input type="file" multiple disabled={disabled || isPending} onChange={handleFileChange} className="hidden" />
        </label>
      )}
      {uploadError && <p className="mt-1 text-[11px] text-danger">{uploadError}</p>}
    </div>
  );
}
