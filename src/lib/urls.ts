// Regex compartida para detectar URLs en texto de mensajes -- usada tanto en
// el cliente (inbox-client.tsx, para linkificar) como en el servidor (para
// decidir si hay que pedir un preview del link y mandar preview_url a Meta).
export const URL_REGEX = /(https?:\/\/[^\s]+)/g;

/** Primera URL encontrada en el texto, o null si no hay ninguna. */
export function firstUrl(text: string): string | null {
  URL_REGEX.lastIndex = 0;
  const match = URL_REGEX.exec(text);
  return match ? match[0] : null;
}
