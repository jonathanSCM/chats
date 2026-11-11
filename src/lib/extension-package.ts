import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

/**
 * Empaqueta la extensión de Chrome (`meet-captions-extension/`, que el Docker copia junto con el proyecto) en un .zip, para
 * descargarla desde Ajustes y cargarla con «Cargar descomprimida». Así siempre es la versión desplegada.
 */
const EXCLUDE = new Set(["README.md", "STORE-LISTING.md"]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Zip mínimo (deflate), con nombres UTF-8. Suficiente para unas pocas decenas de archivos pequeños. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, packed);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(0x21, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

async function collect(dir: string, base = ""): Promise<ZipEntry[]> {
  const out: ZipEntry[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${item.name}` : item.name;
    if (item.isDirectory()) out.push(...(await collect(path.join(dir, item.name), rel)));
    else if (!EXCLUDE.has(rel)) out.push({ name: rel, data: await readFile(path.join(dir, item.name)) });
  }
  return out;
}

/** Los archivos de la extensión (sin README) para que ella misma se actualice escribiéndolos en su carpeta. */
export async function loadExtensionFiles(): Promise<{ version: string | null; files: { path: string; base64: string }[] } | null> {
  try {
    const entries = await collect(extensionDir());
    const manifest = entries.find((e) => e.name === "manifest.json");
    if (!manifest) return null;
    const version = (JSON.parse(manifest.data.toString("utf8")) as { version?: string }).version ?? null;
    return { version, files: entries.map((e) => ({ path: e.name, base64: e.data.toString("base64") })) };
  } catch {
    return null;
  }
}

/**
 * Versión para la Chrome Web Store. La tienda actualiza las extensiones sola y PROHÍBE el código alojado fuera del paquete, así
 * que se quita el «Actualizar ahora» (que baja archivos del CRM y los escribe en la carpeta) y el aviso de versión nueva, que
 * solo tienen sentido en la instalación manual «sin empaquetar».
 */
export function forStore(entries: ZipEntry[]): ZipEntry[] {
  return entries.map((e) => {
    if (e.name === "sidepanel.js") {
      let js = e.data.toString("utf8").replace(/\r\n/g, "\n");
      const from = js.indexOf("// ───────── Aviso de versión nueva");
      const to = js.indexOf("// ───────── Recuperar una grabación");
      if (from < 0 || to < from) throw new Error("forStore: no se encontró el bloque de actualización en sidepanel.js");
      js = js.slice(0, from) + js.slice(to);
      const tail = "void checkUpdate();\nsetInterval(checkUpdate, 60 * 60 * 1000);\n";
      if (!js.includes(tail)) throw new Error("forStore: no se encontró el arranque del aviso de versión");
      return { name: e.name, data: Buffer.from(js.replace(tail, ""), "utf8") };
    }
    if (e.name === "sidepanel.html") {
      const html = e.data.toString("utf8").replace(/\r\n/g, "\n");
      const out = html.replace(/ *<div class="notice warn" id="updateBox"[\s\S]*?<\/div>\n/, "");
      if (out === html) throw new Error("forStore: no se encontró el aviso de versión en sidepanel.html");
      return { name: e.name, data: Buffer.from(out, "utf8") };
    }
    return e;
  });
}

export async function buildExtensionZip(options: { store?: boolean } = {}): Promise<{ zip: Buffer; version: string | null; files: string[] } | null> {
  try {
    let entries = await collect(extensionDir());
    if (options.store) entries = forStore(entries);
    const manifest = entries.find((e) => e.name === "manifest.json");
    if (!manifest) return null;
    const version = (JSON.parse(manifest.data.toString("utf8")) as { version?: string }).version ?? null;
    return { zip: buildZip(entries), version, files: entries.map((e) => e.name) };
  } catch (error) {
    if (options.store) throw error;
    return null;
  }
}

export function extensionDir(): string {
  return path.join(process.cwd(), "meet-captions-extension");
}

export async function loadExtensionPackage(): Promise<{ zip: Buffer; version: string | null } | null> {
  try {
    const entries = await collect(extensionDir());
    const manifest = entries.find((e) => e.name === "manifest.json");
    if (!manifest) return null;
    const version = (JSON.parse(manifest.data.toString("utf8")) as { version?: string }).version ?? null;
    return { zip: buildZip(entries), version };
  } catch {
    return null; // si la carpeta no está en este despliegue, simplemente no se ofrece
  }
}
