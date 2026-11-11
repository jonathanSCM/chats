import { auth } from "@/server/auth";
import { loadExtensionPackage } from "@/lib/extension-package";

export const dynamic = "force-dynamic";

/** Descarga de la extensión de Chrome (zip) para quien tiene sesión en el CRM. */
export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response("No autorizado", { status: 401 });
  const pkg = await loadExtensionPackage();
  if (!pkg) return new Response("Extensión no disponible", { status: 404 });
  return new Response(new Uint8Array(pkg.zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="proshop-meet-extension-v${pkg.version ?? "0"}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
