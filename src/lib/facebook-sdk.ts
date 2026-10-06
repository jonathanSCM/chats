declare global {
  interface Window {
    FB?: {
      init: (params: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        autoLogAppEvents?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: {
          authResponse?: { code?: string; accessToken?: string };
          status?: string;
        }) => void,
        options: {
          config_id: string;
          response_type?: string;
          override_default_response_type?: boolean;
          // Para v4, la doc de Meta pide "extras: {}" vacío a propósito --
          // featureType/sessionInfoVersion son solo para v2/v3.
          extras?: Record<string, unknown>;
        },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = "https://connect.facebook.net/es_LA/sdk.js";
const SDK_LOAD_TIMEOUT_MS = 12_000;

// connect.facebook.net/.../sdk.js NO es el SDK real: es un stub de ~20
// líneas que crea `window.FB` al instante, con métodos falsos que solo
// encolan las llamadas para más tarde. El SDK de verdad llega después, en
// un segundo archivo aparte, y recién ahí reemplaza `window.FB`. Por eso
// "si window.FB existe, ya se puede usar" es falso — puede ser el stub, no
// el SDK real — y tratarlo como listo hacía que FB.init() se llamara dos
// veces (una en el stub, otra cuando llega el SDK de verdad) y que
// FB.login() cayera en medio de esa carrera con "FB.login() called before
// FB.init().". La única forma correcta de evitarlo: una sola promesa
// compartida, un solo <script>, un solo init() — nunca más de uno, nunca
// más de una vez, sin atajos basados en si `window.FB` "ya existe".
let sdkPromise: Promise<void> | null = null;

export function loadFacebookSdk(appId: string): Promise<void> {
  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("No se pudo cargar el SDK de Facebook a tiempo."));
      }, SDK_LOAD_TIMEOUT_MS);

      window.fbAsyncInit = () => {
        clearTimeout(timeout);
        window.FB!.init({ appId, cookie: true, xfbml: true, autoLogAppEvents: true, version: "v26.0" });
        resolve();
      };

      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = SDK_SRC;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("No se pudo descargar el SDK de Facebook."));
      };
      document.body.appendChild(script);
    });

    // Si falló (timeout, red, script bloqueado), no se deja la promesa
    // rechazada cacheada para siempre — un reintento debe poder volver a
    // pedir el script en vez de recibir el mismo fallo eternamente.
    sdkPromise.catch(() => {
      sdkPromise = null;
    });
  }

  return sdkPromise;
}
