/**
 * Chrome "instala" una web como un WebAPK: una mini-app Android que fabrica con
 * código compilado en formato DEX 039, que solo existe desde Android 9 (API 28).
 * En Android 8.x el sistema no puede leerla y la app instalada se cierra al
 * abrirla (error "Unrecognized version number in base.apk: 0 3 9"), aunque el
 * sitio funcione perfecto en la pestaña de Chrome. Comprobado en un Galaxy J7
 * con Android 8.1 y Chrome 138.
 */
export const MIN_ANDROID_FOR_WEBAPK = 9;

/** "8.1.0" -> 8. Devuelve null si no se puede leer. */
export function androidMajor(platformVersion: string | null | undefined): number | null {
  const m = /^(\d+)/.exec(platformVersion ?? "");
  return m ? Number(m[1]) : null;
}

export function webApkUnsupported(platform: string | undefined, platformVersion: string | undefined): boolean {
  if (platform !== "Android") return false;
  const major = androidMajor(platformVersion);
  return major !== null && major < MIN_ANDROID_FOR_WEBAPK;
}

interface UserAgentDataLike {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string }>;
}

/**
 * La versión real de Android no sale en el user-agent (Chrome la congela en "10"),
 * pero sí en User-Agent Client Hints. Devuelve la versión ("8.1.0") si este
 * dispositivo no puede abrir un WebAPK; null si puede o si no se puede saber.
 */
export async function detectLegacyAndroid(): Promise<string | null> {
  const uad = (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
  if (!uad || typeof uad.getHighEntropyValues !== "function") return null;
  try {
    const { platformVersion } = await uad.getHighEntropyValues(["platformVersion"]);
    return webApkUnsupported(uad.platform, platformVersion) ? (platformVersion ?? null) : null;
  } catch {
    return null;
  }
}
