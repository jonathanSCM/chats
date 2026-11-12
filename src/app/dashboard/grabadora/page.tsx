import { getOrCreateMyExtensionTokenAction } from "@/server/actions/extension-auth";
import { Recorder } from "./_components/recorder";

/**
 * Prototipo: grabadora dentro del propio CRM, sin extensión ni bot. Graba el audio de una pestaña (la reunión) más el
 * micrófono, y lo manda por partes al mismo endpoint que usa la extensión (api/extension/audio), con el mismo token personal
 * y el mismo selector de organización. Sirve en Chrome/Edge de Windows y de macOS (el audio de pestaña sí; el del sistema
 * completo depende del sistema operativo).
 */
export default async function GrabadoraPage() {
  const { token, name } = await getOrCreateMyExtensionTokenAction();
  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="text-lg font-semibold text-ink">Grabadora de reuniones</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Graba el audio de la pestaña de tu reunión y tu micrófono, y lo manda a la organización que elijas, igual que la extensión.
        Prototipo: sin subtítulos ni nombres de quién habla.
      </p>
      <Recorder token={token} userName={name} />
    </div>
  );
}
