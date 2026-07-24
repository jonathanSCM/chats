# Zócalo — Sistema de diseño

Guía de marca y UI de la plataforma, para usar como referencia al diseñar la landing (u otras piezas) fuera del código.

## Nombre y concepto

**Zócalo** — plataforma para crear y operar bots de venta para WhatsApp Business.

Dirección visual: **"consola de operador"**. Es una herramienta de trabajo diario, no un juguete — la estética se inspira en paneles técnicos/terminales de alta gama (piensa Linear, Vercel, terminales de trading), con precisión tipográfica y datos en monospace, sobre fondo casi negro con un acento chartreuse muy saturado. Nada de gradientes morados ni ilustraciones genéricas de IA.

Para la **landing** (marketing) se puede permitir algo más de energía/venta que el panel interno (más espacio, jerarquía más grande, quizás algún mockup visual), pero manteniendo la misma paleta, tipografía y el motivo de "esquinas HUD".

## Paleta de colores

Tema oscuro, sin versión clara (decisión de marca, no se adapta a light mode).

| Token | Hex | Uso |
|---|---|---|
| `canvas` | `#0A0A0B` | Fondo base, casi negro |
| `surface` | `#131316` | Tarjetas, contenedores |
| `surface-2` | `#1C1C21` | Hover, elementos elevados, inputs |
| `border` | `#27272D` | Bordes sutiles |
| `border-strong` | `#38383F` | Bordes con más contraste (hover, foco) |
| `ink` | `#F3F2EC` | Texto principal (blanco cálido, no puro `#fff`) |
| `ink-muted` | `#96959D` | Texto secundario |
| `ink-faint` | `#616167` | Texto terciario, placeholders |
| **`accent`** | **`#D4FF3D`** | **Color de marca — chartreuse.** CTAs, links activos, highlights |
| `accent-ink` | `#0A0A0B` | Texto sobre fondo `accent` |
| `accent-dim` | `#7E8F2E` | Acento apagado (bordes, estados secundarios) |
| `warning` | `#FFB020` | Ámbar — estados de alerta (pago pendiente, uso cerca del límite) |
| `danger` | `#FF5D5D` | Rojo — errores, cancelaciones |
| `danger-dim` | `#4A2323` | Fondo para banners de error |

**Regla de uso del acento:** el chartreuse es el color más saturado de toda la paleta — úsalo con moderación (CTA principal, un highlight por sección, indicadores de estado activo). Si todo es chartreuse, deja de funcionar como acento.

`::selection` (texto seleccionado) usa `accent` de fondo con `accent-ink` de texto.

## Tipografía

Tres familias, todas de Google Fonts, autohosteadas vía `next/font`:

| Rol | Familia | Pesos | Uso |
|---|---|---|---|
| **Display** | [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) | 500, 600, 700, 800 | Títulos, headlines, wordmark |
| **Body** | [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) | 400, 500, 600 | Texto de párrafo, UI, botones |
| **Mono** | [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) | 400, 500 | Números, precios, IDs, timestamps, labels técnicos (mayúsculas + tracking amplio) |

Por qué esta combinación: Bricolage Grotesque tiene carácter geométrico distintivo para titulares sin ser genérico; IBM Plex Sans es igual de profesional pero más neutro para leer en párrafos largos; IBM Plex Mono (misma familia tipográfica que el body, por eso combinan bien) refuerza la sensación "técnica/precisa" en cualquier dato numérico — precios, contadores de uso, IDs.

**Nunca usar:** Inter, Roboto, Arial, system-ui, ni fuentes genéricas de "IA por defecto".

### Convenciones de uso
- Labels de UI (ej. "CORREO", "ESTADO", nombres de tabs) van en **mono, mayúsculas, `letter-spacing` amplio, tamaño pequeño** (~11px) — es la firma tipográfica más reconocible del producto.
- Precios y métricas grandes van en mono también (ej. `$79.00/mes`, `0 / 1000`).
- Headlines usan el display font en negrita (600-800), `tracking-tight` (kerning cerrado).

## Motivo visual: "esquinas HUD"

Firma visual recurrente: esquinas tipo visor de cámara/HUD en las tarjetas — dos trazos en L, arriba-izquierda y abajo-derecha, en color `accent`, que aparecen en hover o en estado activo (opacity 0 → 1). Sugiere "algo está siendo monitoreado/enfocado". Se usa en cards de bots, planes, y contenedores de login/signup.

```css
.corner-brackets::before { top: -1px; left: -1px; border-top: 2px solid var(--accent); border-left: 2px solid var(--accent); }
.corner-brackets::after  { bottom: -1px; right: -1px; border-bottom: 2px solid var(--accent); border-right: 2px solid var(--accent); }
```

## Textura de fondo

El fondo `canvas` no es un negro plano: lleva una textura de grano/ruido muy sutil (SVG `feTurbulence`, opacity 3.5%, `mix-blend-mode: overlay`) para dar profundidad sin volverse un patrón visible. En una landing con secciones grandes de fondo oscuro, esto evita que se vea "plano".

## Logo / wordmark

No hay isotipo — el wordmark es el nombre **"Zócalo"** en Bricolage Grotesque bold, seguido de un punto (`•`) sólido en color `accent`, del tamaño de una `x-height` aprox. Ese punto es el único elemento gráfico de marca; se repite en el footer y el sidebar como "firma" consistente.

```
Zócalo •
```

## Bordes, radios y espaciado

- Radio estándar de tarjetas/inputs/botones: `8px` (`rounded-lg` / `rounded-md`)
- Botones "pill": `rounded-full` (usado en badges de estado)
- Bordes: 1px, color `border` (sutil) o `border-strong` (hover/foco)
- Contenedores de contenido con ancho máximo `~1024px` (5xl) centrados, padding lateral `24px`

## Componentes de referencia (para que el diseño de la landing sea consistente)

- **Botón primario**: fondo `accent`, texto `accent-ink`, sin borde, `font-medium`, hover con brillo (`brightness-110`)
- **Botón secundario**: fondo `surface-2`, borde `border-strong`, hover cambia texto/borde a `accent`
- **Badge de estado**: pill pequeño, borde sutil, texto mono mayúsculas, con un punto de color delante (`●`) que pulsa si el estado es "activo"
- **Card**: `surface` + borde `border` + radio `8px` + motivo de esquinas HUD
- **Tabs**: subrayado inferior en `accent` bajo el tab activo, resto en `ink-muted`

## Tono de copy

Español directo, sin relleno corporativo. Frases cortas, orientadas a beneficio concreto ("Catálogo en minutos", no "Solución integral de gestión de catálogo"). Evitar jerga de "IA revolucionaria" — el producto se vende por ser rápido y concreto, no por ser IA.

## Animación

Mínima e intencional, no decorativa:
- **Entrada de contenido**: `fade-up` (opacity 0→1 + translateY 6px→0, 400ms, easing tipo "ease-out-expo") — se aplica una vez por sección/página, no en cascada excesiva
- **Estado activo pulsante**: punto de estado "activo" con un pulso de `box-shadow` sutil en `accent` (2s loop) — usado con moderación, solo para indicar "esto está vivo ahora mismo" (bot activo, suscripción activa)

---

*Este documento describe el sistema de diseño ya implementado en el panel (`src/app/globals.css`, componentes en `src/components/ui/`). La landing actual (`src/app/page.tsx`) es funcional pero minimalista — este doc es la base para que un diseño más elaborado siga siendo la misma marca.*
