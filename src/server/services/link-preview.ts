import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 500_000; // 500KB -- de sobra para leer <head>, no hace falta la página entera

export interface LinkPreview {
  title: string;
  description: string | null;
  imageUrl: string | null;
}

/**
 * true si la IP no debería ser alcanzable desde este servidor por una URL
 * que mandó un tercero (loopback, redes privadas, link-local -- esto último
 * cubre el endpoint de metadata de la nube, 169.254.169.254).
 */
function isPrivateIp(ip: string): boolean {
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("169.254.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  return false;
}

/**
 * Trae el og:title/og:description/og:image de una URL que mandó un
 * cliente o un vendedor -- el servidor hace el fetch, así que hay que
 * blindarlo contra SSRF: solo http/https, se resuelve el hostname y se
 * rechaza si cae en una red privada/local (antes del fetch, no solo
 * mirando el string de la URL -- así cubre también DNS rebinding), timeout
 * corto y tope de bytes leídos. Devuelve null si algo de esto falla o si
 * la página no tiene metadatos usables -- nunca tira error, es best-effort.
 */
export async function getLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const hostname = url.hostname;
  if (hostname === "localhost" || hostname.endsWith(".local")) return null;
  if (isIP(hostname) && isPrivateIp(hostname)) return null;

  if (!isIP(hostname)) {
    try {
      const { address } = await lookup(hostname);
      if (isPrivateIp(address)) return null;
    } catch {
      return null; // no resuelve -- no hay nada que buscar
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ProShopCRM-LinkPreview/1.0)" },
    });
    if (!res.ok || !res.body) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    // Se lee de a pedazos y se corta apenas se pasa el tope -- evita traer
    // páginas enormes solo para leer las meta tags del <head>.
    const reader = res.body.getReader();
    let received = 0;
    let html = "";
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      html += decoder.decode(value, { stream: true });
      if (received >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }

    return parseMetaTags(html, url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

/**
 * Regex simple en vez de un parser de HTML completo -- alcanza para leer
 * las meta og: y el título de la página, no hace falta más para un preview.
 */
function parseMetaTags(html: string, url: URL): LinkPreview | null {
  const ogTitle = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i,
  ]);
  const title =
    ogTitle ?? metaContent(html, [/<title[^>]*>([^<]*)<\/title>/i]) ?? url.hostname;

  const description = metaContent(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  ]);

  let imageUrl = metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i,
  ]);
  // og:image puede venir relativa -- se resuelve contra la URL original.
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, url).toString();
    } catch {
      imageUrl = null;
    }
  }

  return { title: title.slice(0, 200), description: description?.slice(0, 400) ?? null, imageUrl };
}
