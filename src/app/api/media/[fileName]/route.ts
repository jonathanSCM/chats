import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { readMediaFileFromS3 } from "@/lib/media-storage";

// Sirve la media subida a S3 (imágenes/video/audio/documentos de las
// conversaciones). Requiere sesión: son archivos de clientes, no algo que
// deba quedar público en internet solo porque conocés la URL.
export async function GET(
  _req: NextRequest,
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

  return new NextResponse(file.body, {
    headers: {
      "Content-Type": file.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
