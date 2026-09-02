import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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

function s3Config() {
  const bucket = process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey, region: process.env.S3_REGION || "auto" };
}

const globalForS3 = globalThis as unknown as { s3Client: S3Client | undefined };

function getS3Client(config: NonNullable<ReturnType<typeof s3Config>>): S3Client {
  if (!globalForS3.s3Client) {
    globalForS3.s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true, // requerido por la mayoría de proveedores S3-compatibles (MinIO, R2, Spaces)
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return globalForS3.s3Client;
}

let warnedAboutLocalStorage = false;

// Guarda el archivo entrante/saliente y devuelve la URL para servirlo desde
// el chat. Si hay credenciales S3 configuradas, sube ahí (persiste entre
// deploys/reinicios); si no, cae a disco local bajo /public/media — solo
// seguro en producción si ese directorio está montado en un volumen
// persistente, porque de lo contrario se pierde en cada redeploy.
export async function saveMediaFile(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = extensionForMime(mimeType);
  const fileName = `${randomUUID()}.${ext}`;
  const config = s3Config();

  if (config) {
    const client = getS3Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: `media/${fileName}`,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    return `/api/media/${fileName}`;
  }

  if (!warnedAboutLocalStorage && process.env.NODE_ENV === "production") {
    warnedAboutLocalStorage = true;
    console.warn(
      "[media-storage] Guardando archivos en disco local (/public/media) porque no hay " +
        "credenciales S3 (S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) configuradas. " +
        "Si el contenedor no tiene un volumen persistente montado ahí, TODA la media " +
        "recibida/enviada se pierde en el próximo redeploy o reinicio.",
    );
  }

  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(path.join(MEDIA_DIR, fileName), buffer);
  return `/media/${fileName}`;
}

// Usado por /api/media/[fileName] para leer de vuelta un archivo subido a S3.
export async function readMediaFileFromS3(
  fileName: string,
): Promise<{ body: ReadableStream; contentType?: string } | null> {
  const config = s3Config();
  if (!config) return null;

  const client = getS3Client(config);
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: `media/${fileName}` }),
    );
    if (!res.Body) return null;
    return { body: res.Body.transformToWebStream(), contentType: res.ContentType };
  } catch {
    return null;
  }
}

// Usado al borrar un mensaje: limpia el archivo asociado para no dejar
// basura huérfana en el bucket o en disco. `mediaUrl` guarda `/api/media/{f}`
// (S3) o `/media/{f}` (disco local) — el nombre de archivo es lo último del
// path en ambos casos.
export async function deleteMediaFile(mediaUrl: string): Promise<void> {
  const fileName = mediaUrl.split("/").pop();
  if (!fileName) return;

  const config = s3Config();
  if (config) {
    try {
      const client = getS3Client(config);
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: `media/${fileName}` }));
    } catch (error) {
      console.error("[media-storage] No se pudo borrar de S3:", error);
    }
    return;
  }

  try {
    await unlink(path.join(MEDIA_DIR, fileName));
  } catch {
    // Ya no existe o nunca se guardó en disco (por ejemplo, si se cambió de
    // S3 a disco local después de que se subió el archivo) — no es un error.
  }
}

// Simétrico a saveMediaFile: lee de vuelta un archivo ya guardado a partir de
// la URL relativa que devolvió (`/api/media/{f}` o `/media/{f}`). A
// diferencia de readMediaFileFromS3 (pensado para servir la respuesta HTTP
// del proxy /api/media), este devuelve el buffer completo en memoria — lo
// que necesita, por ejemplo, mandar el audio grabado a la API de Whisper.
export async function readMediaFile(mediaUrl: string): Promise<Buffer> {
  const fileName = mediaUrl.split("/").pop();
  if (!fileName) throw new Error(`URL de media inválida: ${mediaUrl}`);

  const config = s3Config();
  if (config) {
    const client = getS3Client(config);
    const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: `media/${fileName}` }));
    if (!res.Body) throw new Error(`No se encontró en S3: ${fileName}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  return readFile(path.join(MEDIA_DIR, fileName));
}

export function isS3Configured(): boolean {
  return s3Config() !== null;
}
