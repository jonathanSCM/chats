import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Los scripts de Tampermonkey para Meet que se pueden copiar desde Ajustes. Viven en `meet-userscript/` (el Docker
 * copia todo el proyecto), así que lo que se copia siempre es la versión que está desplegada.
 */
export interface MeetScript {
  id: string;
  file: string;
  title: string;
  description: string;
}

export const MEET_SCRIPTS: MeetScript[] = [
  {
    id: "proshop",
    file: "proshop-meet.user.js",
    title: "ProShop CRM — Subtítulos y audio de Meet",
    description:
      "Graba los subtítulos y el audio de la reunión (voces + tu micrófono cuando no estás silenciado) y los manda al CRM, o avisa al asistente para que entre solo.",
  },
  {
    id: "popout",
    file: "meet-captions-popout.user.js",
    title: "Meet Captions Pop-out",
    description: "Saca los subtítulos de Meet a una ventana flotante para que no ocupen espacio en la pantalla de la reunión.",
  },
];

export interface MeetScriptWithCode extends MeetScript {
  code: string;
  version: string | null;
}

export function scriptVersion(code: string): string | null {
  return /^\/\/\s*@version\s+(\S+)/m.exec(code)?.[1] ?? null;
}

export async function loadMeetScripts(): Promise<MeetScriptWithCode[]> {
  const dir = path.join(process.cwd(), "meet-userscript");
  const loaded = await Promise.all(
    MEET_SCRIPTS.map(async (script) => {
      try {
        const code = await readFile(path.join(dir, script.file), "utf8");
        return { ...script, code, version: scriptVersion(code) };
      } catch {
        return null; // si el archivo no está en este despliegue, simplemente no se muestra
      }
    }),
  );
  return loaded.filter((s): s is MeetScriptWithCode => s !== null);
}
