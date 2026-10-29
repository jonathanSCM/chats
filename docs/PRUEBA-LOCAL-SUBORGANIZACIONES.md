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

**Demo Financiera** nace con: suborganizaciones (hasta 3), 2 administradores, 4 vendedores,
marca propia permitida y clave de OpenAI propia permitida.

## Recorrido sugerido

1. **Plan (superadmin).** Entra como `superadmin@demo.local` → Organizaciones → *Demo Financiera*.
   Verás la tarjeta **Plan de la organización**: topes de administradores/vendedores (con el uso
   actual), suborganizaciones, marca propia y clave de OpenAI propia. Cambia un número, guarda y
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
6. **Clave de OpenAI.** Organización → Integraciones → **Clave de OpenAI** (aparece solo si el plan
   lo permite). Con una clave inválida verás el mensaje de rechazo; no se guarda. Una clave real
   se prueba contra OpenAI antes de guardarse y queda cifrada.
7. **Plan simple.** Entra como `cliente-simple@demo.local`: no tiene pestaña Suborganizaciones,
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
