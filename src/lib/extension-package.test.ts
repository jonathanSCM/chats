import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { buildZip, loadExtensionPackage } from "./extension-package";

describe("extension-package", () => {
  it("arma un zip válido con directorio central y datos recuperables", () => {
    const zip = buildZip([{ name: "a/b.txt", data: Buffer.from("hola ñandú") }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(1);
    const nameLen = zip.readUInt16LE(26);
    const size = zip.readUInt32LE(18);
    expect(zip.subarray(30, 30 + nameLen).toString()).toBe("a/b.txt");
    expect(inflateRawSync(zip.subarray(30 + nameLen, 30 + nameLen + size)).toString()).toBe("hola ñandú");
  });

  it("empaqueta la extensión real con manifest en la raíz y sin README", async () => {
    const pkg = await loadExtensionPackage();
    expect(pkg).not.toBeNull();
    expect(pkg!.version).toMatch(/^\d+\.\d+\.\d+$/);
    const text = pkg!.zip.toString("latin1");
    expect(text).toContain("manifest.json");
    expect(text).not.toContain("README.md");
  });
});

describe("paquete para la Chrome Web Store", () => {
  it("quita la auto-actualización (código alojado fuera del paquete) y el aviso de versión, y el JS sigue siendo válido", async () => {
    const { buildExtensionZip } = await import("./extension-package");
    const store = await buildExtensionZip({ store: true });
    const manual = await buildExtensionZip({ store: false });
    expect(store).not.toBeNull();
    // El zip va comprimido: se comprueba sobre el contenido armado, no sobre los bytes del zip.
    const { forStore } = await import("./extension-package");
    const { readFileSync } = await import("node:fs");
    const dir = `${process.cwd()}/meet-captions-extension`;
    const entries = ["sidepanel.js", "sidepanel.html"].map((name) => ({ name, data: readFileSync(`${dir}/${name}`) }));
    const [js, html] = forStore(entries).map((e) => e.data.toString("utf8"));
    expect(js).not.toContain("showDirectoryPicker");
    expect(js).not.toContain("/api/extension/files");
    expect(js).not.toContain("checkUpdate");
    expect(js).toContain("checkRecover"); // la recuperación de grabaciones SÍ se queda
    expect(html).not.toContain("updateBox");
    expect(html).toContain("recoverBox");
    expect(() => new Function(js.replace(/^\s*(import|export)\s.*$/gm, ""))).not.toThrow();
    expect(store!.files).toEqual(manual!.files); // mismos archivos: solo cambian esos dos
  });
});
