/**
 * Arma el .zip de la extensión «solo subtítulos» (meet-captions-extension-lite/) para subirlo a la Chrome Web Store.
 *   npx tsx scripts/build-extension-lite-zip.ts <carpeta-de-salida>
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildZip, type ZipEntry } from "../src/lib/extension-package";

const DIR = path.join(process.cwd(), "meet-captions-extension-lite");
const EXCLUDE = new Set(["README.md", "STORE-LISTING.md"]);

function collect(dir: string, base = ""): ZipEntry[] {
  const out: ZipEntry[] = [];
  for (const name of readdirSync(dir)) {
    const rel = base ? `${base}/${name}` : name;
    if (statSync(path.join(dir, name)).isDirectory()) out.push(...collect(path.join(dir, name), rel));
    else if (!EXCLUDE.has(rel)) out.push({ name: rel, data: readFileSync(path.join(dir, name)) });
  }
  return out;
}

const outDir = process.argv[2] ?? ".";
const entries = collect(DIR);
const manifest = entries.find((e) => e.name === "manifest.json");
if (!manifest) throw new Error("No hay manifest.json en meet-captions-extension-lite/");
const version = (JSON.parse(manifest.data.toString("utf8")) as { version: string }).version;
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `proshop-subtitulos-meet-v${version}-store.zip`);
writeFileSync(file, buildZip(entries));
console.log(`${file}\n${entries.length} archivos`);
