"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * El navegador ya sabe renderizar PDFs adentro de un <iframe> con su propio
 * visor nativo — no hace falta ninguna librería de visor. `/api/media/...`
 * (y el equivalente de disco local) no manda `Content-Disposition:
 * attachment`, así que se muestra en vez de forzar la descarga.
 */
export function PdfViewerModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return createPortal(
    <div data-portal className="fixed inset-0 z-[100] flex flex-col bg-black/70 p-4 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="truncate text-sm font-medium text-white">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-md p-1 text-white hover:bg-white/10"
          title="Cerrar"
        >
          <X size={20} />
        </button>
      </div>
      <iframe src={url} title={title} className="flex-1 rounded-lg border-0 bg-white" />
    </div>,
    document.body,
  );
}
