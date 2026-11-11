import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

/** Versión de la extensión de Chrome que está desplegada. Pública (solo un número): la extensión la consulta para avisar si hay una nueva. */
export async function GET() {
  try {
    const manifest = JSON.parse(await readFile(path.join(process.cwd(), "meet-captions-extension", "manifest.json"), "utf8")) as { version?: string };
    return Response.json({ version: manifest.version ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ version: null });
  }
}
