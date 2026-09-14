import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { readMediaFileFromS3 } from "@/lib/media-storage";

// Sirve la media subida a S3 (imágenes/video/audio/documentos de las
// conversaciones). Requiere sesión: son archivos de clientes, no algo que
// deba quedar público en internet solo porque conocés la URL.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { fileName } = await params;
  // Evita path traversal — solo el nombre de archivo generado (uuid.ext), sin separadores.
  if (fileName.includes("/") || fileName.includes("..")) {
    return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
  }

  const file = await readMediaFileFromS3(fileName);
  if (!file) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Sin el charset explícito, un .txt en UTF-8 real (tildes, ñ) se ve como
  // "Â¿QuÃ©" al abrirlo -- el navegador/editor que lo recibe no tiene forma
  // de adivinar la codificación y cae a Latin-1 por default.
  const contentType = file.contentType ?? "application/octet-stream";
  const withCharset = contentType.startsWith("text/") && !contentType.includes("charset")
    ? `${contentType}; charset=utf-8`
    : contentType;

  const headers: Record<string, string> = {
    "Content-Type": withCharset,
    "Cache-Control": "private, max-age=3600",
  };

  // El navegador decide por MIME si abre el archivo inline o lo descarga --
  // para audio/video eso significa reproducirlo en la pestaña, sin ninguna
  // opción visible de guardarlo. `?download=nombre.ext` (link explícito de
  // "Descargar", ver meeting-attachments.tsx) fuerza el diálogo de guardar
  // con el nombre real del adjunto en vez del uuid interno.
  const downloadName = req.nextUrl.searchParams.get("download");
  if (downloadName) {
    const safeName = downloadName.replace(/[^\w.\- ]/g, "_");
    headers["Content-Disposition"] = `attachment; filename="${safeName}"`;
  }

  return new NextResponse(file.body, { headers });
}
