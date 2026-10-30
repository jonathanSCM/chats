# Planes comerciales

Pantalla `/admin/planes` (solo superadmin). Un plan es una plantilla de lo que incluye y cuánto cuesta al mes. El precio **solo se anota** (alimenta "Facturación mensual anotada"); el cobro se hace por otro medio hasta que haya pasarela de pago. Cada plan tiene su **moneda** (soles, dólares, bolivianos o euros): la facturación anotada se suma por moneda, sin mezclarlas.

## Qué fija un plan

Máximo de administradores y vendedores, suborganizaciones (sí/no y tope), marca propia, y créditos de IA por mes (ver `CREDITOS-IA.md`). Al escribir los créditos el formulario muestra cuánto es (en dólares de presupuesto, respuestas del bot, análisis y horas de transcripción), y arriba de la lista hay una explicación de cómo se calculan. Vacío = sin tope. No fija la clave de IA ni lo que la organización ya configuró (marca, etc.).

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

Tabla `plans` (`price` + `currency`, migración `20261031030000_plan_currency`); `organizations.planId`, `planNoticeMessage`, `planNoticeAt`. Migración `20261031010000_plans`, aditiva: sin plan, todo queda igual. Cada cambio queda en el registro de auditoría (`plan_created`, `plan_updated`, `plan_propagated`, `plan_assigned`, `plan_unassigned`, `plan_deleted`).
