import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MEDIA_DIR = path.join(process.cwd(), "public", "media");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "application/vnd.android.package-archive": "apk",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/zip": "zip",
  "application/x-rar-compressed": "rar",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
};

export function extensionForMime(mimeType: string, fallback = "bin"): string {
  const clean = mimeType.split(";")[0]?.trim() ?? mimeType;
  return EXT_BY_MIME[clean] ?? fallback;
}

// Guarda el archivo en /public/media y devuelve la URL pública servida por Next.js.
export async function saveMediaFile(buffer: Buffer, mimeType: string): Promise<string> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const ext = extensionForMime(mimeType);
  const fileName = `${randomUUID()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, fileName), buffer);
  return `/media/${fileName}`;
}
