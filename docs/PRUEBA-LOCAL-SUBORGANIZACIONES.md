# Probar planes, marca, clave de OpenAI y suborganizaciones en local

Todo esto corre en tu computadora, con la base local. No toca producción.

## Preparar los datos de demostración

```bash
npx tsx --env-file=.env scripts/seed-demo-suborgs.ts
```

Es repetible: borra lo que creó la vez anterior y lo vuelve a crear, así que sirve para
"empezar de cero" cuando quieras. Las cuentas y la contraseña de prueba están al principio de
[scripts/seed-demo-suborgs.ts](../scripts/seed-demo-suborgs.ts) (constante `PASSWORD`).

Después arranca la app (`npm run dev`) y abre <http://localhost:3000/login>.

## Cuentas de demostración

| Cuenta | Qué es |
|---|---|
| `superadmin@demo.local` | Superadmin de la plataforma: ve `/admin` y fija el plan de cada organización |
| `admin@demo.local` | Ana, administradora de **Demo Financiera** (plan completo) |
| `admin2@demo.local` | Beto, segundo administrador de Demo Financiera |
| `vendedor1@demo.local` · `vendedor2@demo.local` · `vendedor3@demo.local` | Vendedores de Demo Financiera |
| `cliente-simple@demo.local` | Dueño de **Demo Cliente Simple** (plan con 1 admin y 1 vendedor, sin extras) |
| `ia-con-tope@demo.local` | Dueño de **Demo IA con cupo**: IA personalizada con tope de USD 10 al mes (lleva USD 3.20) |
| `ia-agotada@demo.local` | Dueño de **Demo IA agotada**: IA personalizada con tope de USD 1 al mes, ya superado: ve el aviso rojo |

**Demo Financiera** nace con: suborganizaciones (hasta 3), 2 administradores, 4 vendedores,
marca propia permitida y modo de IA "clave propia de la organización".

## Recorrido sugerido

1. **Plan (superadmin).** Entra como `superadmin@demo.local` → Organizaciones → *Demo Financiera*.
   Verás la tarjeta **Plan de la organización**: topes de administradores/vendedores (con el uso
   actual), suborganizaciones y marca propia. Cambia un número, guarda y
   mira cómo cambia lo que ve el dueño.
2. **Suborganizaciones.** Entra como `admin@demo.local` → Organización → pestaña
   **Suborganizaciones**. Crea "Sucursal Norte" marcando qué vendedores la usarán. Cambia los
   vendedores de una existente con el botón *Guardar vendedores*.
3. **Entrar a la hija.** En el menú lateral, el selector de organización muestra
   "Demo Financiera › Sucursal Norte". Dentro verás el aviso de que es una suborganización, los
   2 administradores (entran solos) y los vendedores elegidos. Sus chats, contactos y WhatsApp son
   aparte de los de la principal.
4. **Límites compartidos.** En la pestaña Equipo, la línea "Tu plan (compartido con tus
   suborganizaciones)" cuenta personas distintas: una vendedora asignada a dos hijas ocupa un solo
   lugar. Prueba invitar a más gente que el tope y verás el bloqueo.
5. **Marca.** En Demo Financiera → Organización → General → tarjeta **Marca**: sube un logo
   (PNG/JPG/WebP, hasta 400 KB), pon un nombre y un color. Cambia a la hija con el selector: hereda
   la marca del padre.
6. **Tres modos de IA (superadmin).** En el detalle de cada organización, tarjeta **Inteligencia
   artificial**: *clave de la plataforma* (la de siempre, con su tope diario), *clave personalizada*
   (tú le pones una clave y un tope de gasto y/o de tokens por mes) o *clave propia* (el dueño pega la
   suya). Entra como `superadmin@demo.local` a *Demo IA agotada*, sube el límite de gasto y guarda:
   el aviso rojo del dueño desaparece. La clave personalizada se prueba contra OpenAI antes de guardarse.
7. **Clave propia (dueño).** En *Demo Financiera* → Organización → Integraciones → **Clave de OpenAI**
   (aparece solo en el modo "propia"). Una clave inválida se rechaza con el motivo; una real queda cifrada.
8. **Avisos de IA detenida.** Con `ia-agotada@demo.local` verás un recuadro rojo arriba de todo el panel
   y, en Integraciones, "Este mes: USD 1.50 de USD 1.00". Con `ia-con-tope@demo.local` no hay aviso.
9. **Tamaño del logo.** En Marca hay un deslizador de 50% a 300% y una vista previa "Así se verá en el
   menú" (usa el mismo componente del menú). Sube un logo chico y agrándalo.
10. **Unir y separar organizaciones (superadmin).** En el detalle de cualquier organización, tarjeta
    **Organización principal**: elige una de la lista (solo aparecen las que tienen suborganizaciones
    habilitadas) y guarda. Para separarla, elige "Ninguna": aparece la casilla para quitar el acceso de
    las personas que venían del padre, con cuántas son.
11. **Plan simple.** Entra como `cliente-simple@demo.local`: no tiene pestaña Suborganizaciones,
   tarjeta Marca ni Clave de OpenAI, y el tope de 1 vendedor se hace cumplir.

## Pruebas automáticas

```bash
npx vitest run                                              # unitarias (todo el proyecto)
npx tsx --env-file=.env scripts/test-suborgs.ts             # integración de suborganizaciones (base local)
```

La segunda crea datos temporales en la base local y los borra al terminar. Comprueba, entre
otras cosas: que la hija copia el embudo del padre, que el padre no ve chats ni contactos de la
hija, que los límites cuentan personas distintas, que no se pueden crear más hijas que el tope
del plan ni hijas de hijas, y que quien sale del padre sale también de sus hijas.
