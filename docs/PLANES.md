# Planes comerciales

Pantalla `/admin/planes` (solo superadmin). Un plan es una plantilla de lo que incluye y cuánto cuesta al mes. El precio **solo se anota** (alimenta "Facturación mensual anotada"); el cobro se hace por otro medio hasta que haya pasarela de pago. Cada plan tiene su **moneda** (soles, dólares, bolivianos o euros): la facturación anotada se suma por moneda, sin mezclarlas.

## Qué fija un plan

Máximo de administradores y vendedores, suborganizaciones (sí/no y tope), marca propia, y créditos de IA por mes (ver `CREDITOS-IA.md`). Al escribir los créditos el formulario muestra cuánto es (en dólares de presupuesto, respuestas del bot, análisis y resúmenes de reunión), y arriba de la lista hay una explicación de cómo se calculan. Vacío = sin tope. No fija la clave de IA ni lo que la organización ya configuró (marca, etc.).

## Cómo se usa

1. Crear el plan en `/admin/planes` (ej. GLA: S/ 249, 1 administrador, 4 vendedores, 8.000 créditos).
2. En la ficha de una organización (`/admin/organizations/<id>` → **Plan comercial**) elegir el plan y "Aplicar plan": copia los valores del plan a la organización.
3. Una suborganización no tiene plan propio: usa el de su organización principal.

## Qué pasa al cambiar

- **Editar un plan** → se aplica a **todas** las organizaciones que lo tienen (el panel pide confirmar y dice cuántas son). A cada dueño le sale un **aviso emergente** con lo que cambió en SU organización ("8.000 → 10.000 créditos…") y lo que ahora incluye su plan. A quien no le cambia nada no se le avisa; cambiar solo el nombre o el precio tampoco avisa.
- **Cambiar a una organización de un plan a otro** → también avisa al dueño. La primera asignación (el alta del cliente) no avisa.
- **Quitar el plan** → la organización queda "a medida" con los valores que tenía; no se avisa.
- El aviso se queda hasta que un administrador de la organización le da "Entendido" (se cierra para todos los administradores).
- Bajar un tope por debajo del uso actual no saca a nadie: solo impide agregar más.
- Si una organización con plan se ajusta a mano (ficha → Plan de la organización), la ficha avisa que difiere del plan; "Volver a aplicar el plan" la restablece. Editar el plan sobrescribe esos ajustes.

## Borrar un plan

Solo se puede si ninguna organización lo tiene; si no, primero hay que pasarlas a otro plan.

## Datos

Tabla `plans` (`price` + `currency`, migración `20261031030000_plan_currency`); `organizations.planId`, `planNoticeMessage`, `planNoticeAt`, `planStartedAt`, `planEndsAt` y la tabla `credit_requests` (migración `20261031040000_plan_validity_requests`). Migración `20261031010000_plans`, aditiva: sin plan, todo queda igual. Cada cambio queda en el registro de auditoría (`plan_created`, `plan_updated`, `plan_propagated`, `plan_assigned`, `plan_unassigned`, `plan_deleted`).

## Vigencia del plan

Cada organización con plan tiene **activo desde** y **activo hasta** (`planStartedAt` / `planEndsAt`). Al asignar un plan por primera vez corre desde hoy y vence en un mes (editable); cambiar de plan conserva las fechas; quitar el plan quita la vigencia ("a medida" no vence). En la ficha de la organización (Plan y créditos → Vigencia del plan) se puede **renovar** (1, 2, 3, 6 o 12 meses; suma desde el vencimiento si aún no pasó, desde hoy si ya venció) o **fijar la fecha** a mano. Renovar le deja al dueño el aviso "Tu plan se renovó hasta…". Una organización con plan pero sin fecha no vence (por ejemplo los planes asignados antes de esta función hasta que les pongas fecha).

| Estado | Cuándo | Qué pasa |
|---|---|---|
| Activo | falta más de 7 días | Todo normal |
| Por vencer | faltan 7 días o menos | Aviso amarillo al dueño en todo el panel |
| Vencido (en gracia) | los 5 días siguientes al vencimiento | Todo sigue funcionando, aviso al dueño |
| Vencido | pasada la gracia | Se detiene la **IA** (en cualquier modo de clave) y el asistente de reuniones no entra. El CRM sigue funcionando |

Una suborganización usa la vigencia de su organización principal. El dueño ve su plan, hasta cuándo está activo, qué incluye y cuándo se renuevan los créditos en General → **Mi plan**, con el botón **Pedir renovación**.

## Solicitudes

Los dueños piden **más créditos** o la **renovación del plan**; llegan a `/admin/solicitudes` (contador en el menú). Aprobar carga los créditos o renueva un mes y marca la solicitud atendida; el pago se coordina por otro medio.
