import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { StaleActionReload } from "@/components/stale-action-reload";
import { PwaPrompts } from "@/components/pwa-prompts";
import { LEGACY_BROWSER_NOTICE_SCRIPT } from "@/lib/legacy-browser-notice";
import { PWA_EARLY_CAPTURE_SCRIPT } from "@/lib/pwa-install-store";
import "./globals.css";

// Inter es la única tipografía de la interfaz (guía de rediseño). La monoespaciada
// queda solo para identificadores técnicos (`font-code`).
// Las fuentes viven en el repo (src/app/fonts, licencia OFL) y no se bajan de Google al construir: antes, si Google
// Fonts fallaba o tardaba durante el build en el servidor, el despliegue entero se caía (Turbopack: "next/font/google
// queries have exactly one entry"). Subconjunto latino: cubre español completo.
const sans = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2", // variable: sirve todos los pesos 100-900
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});

const code = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WhatsApp ProShop",
  description: "Bandeja de conversaciones de WhatsApp para el equipo.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "ProShop",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

// viewportFit cover + maximumScale evitan el zoom al enfocar inputs en iOS
// y dejan que la app use la pantalla completa cuando se instala.
export const viewport: Viewport = {
  themeColor: "#172333",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

// Se ejecuta antes de hidratar React para evitar el flash del tema
// equivocado, y lo mismo con el menú lateral plegado: si se decidiera en
// React, la barra aparecería y desaparecería en cada carga.
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var isDark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.dataset.sidebar = localStorage.getItem("sidebar") || "open";
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${sans.variable} ${code.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: LEGACY_BROWSER_NOTICE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: PWA_EARLY_CAPTURE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink font-sans">
        <StaleActionReload />
        {children}
        <PwaPrompts />
      </body>
    </html>
  );
}
