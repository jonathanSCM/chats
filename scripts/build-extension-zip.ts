/**
 * Arma el .zip de la extensión de Chrome.
 *   npx tsx scripts/build-extension-zip.ts store <carpeta-de-salida>   → para subir a la Chrome Web Store (sin auto-actualización)
 *   npx tsx scripts/build-extension-zip.ts manual <carpeta-de-salida>  → instalación «sin empaquetar» (con «Actualizar ahora»)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildExtensionZip } from "../src/lib/extension-package";

async function main() {
  const [mode, outDir = "."] = process.argv.slice(2);
  if (mode !== "store" && mode !== "manual") throw new Error("Uso: build-extension-zip.ts <store|manual> <carpeta-de-salida>");
  const built = await buildExtensionZip({ store: mode === "store" });
  if (!built) throw new Error("No se pudo armar el paquete.");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `proshop-meet-extension-v${built.version}${mode === "store" ? "-store" : ""}.zip`);
  writeFileSync(file, built.zip);
  console.log(`${file}\n${built.files.length} archivos, ${(built.zip.length / 1024).toFixed(1)} KB`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
