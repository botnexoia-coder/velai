# Finanzas: implementación y puesta en marcha

Las tres fases originales de [SPEC-FINANZAS.md](SPEC-FINANZAS.md) están desplegadas en
el commit `033807f`, confirmado por el [workflow de despliegue](https://github.com/botnexoia-coder/velai/actions/runs/35235574787).

La ampliación **Finanzas → Socios** está implementada en el árbol de trabajo y pendiente
de publicar con la migración **0038**. Permite añadir, corregir nombre/correo, quitar y
reactivar beneficiarios. `SOCIOS_EMAILS` sigue controlando quién puede entrar a Finanzas;
las altas y bajas del catálogo no conceden ni revocan permisos del panel.

## Cobertura de la especificación

| Requisito | Implementación | Evidencia de verificación |
|---|---|---|
| §1–2. Perímetro admin y segunda cerradura | Router montado en `buildAdminApp`; `esSocio` en los 17 handlers; `/me.socio`; lista en variables de entorno | `test/finanzas.test.js` recorre todos los métodos con un administrador no socio y un cliente, sin permitir consultas D1; `test/aislamiento.test.js` recorre el router completo con `clienteGate` |
| §3, §7. Esquema y catálogo | `0037_finanzas.sql`: cuatro tablas, índices, 22 conceptos (5 ingresos, 11 gastos, 6 egresos), la marca `sistema` del egreso de repartos con su índice parcial y el nombre del primer socio | Pruebas sobre SQLite real con todas las migraciones y claves ajenas activadas |
| §4. Cuentas por moneda | Sumas del libro agrupadas por EUR/COP; beneficio sin egresos; caja y repartido desde el origen | Prueba con ingresos históricos, movimientos del periodo, reparto y COP con beneficio negativo; prueba de periodo vacío con caja conservada |
| §5. Conceptos y movimientos | CRUD, validación de importes, fechas, tipo/concepto, cliente opcional, paginación de 50 por tupla; el concepto del sistema solo se reordena | Backend: entrada inválida, conceptos desactivados, protección del histórico, edición, borrado, filtros y 55 filas con fecha/timestamp idénticos |
| §5. Repartos | Cabecera y líneas en un `DB.batch`; beneficiarios validados contra socios activos de D1 y protegidos por trigger en el batch; aviso de caja negativa; borrado completo en batch | Trigger de SQLite que falla en la segunda línea y otro que falla al borrar la cabecera: ninguno deja cambios parciales |
| §5. CSV | Exportación de todo el libro filtrado; BOM, escapado CSV y protección de fórmulas reutilizada | Prueba de filtros, 55 filas sin límite de página, céntimos EUR presentados como euros y COP entero |
| §6. Panel | `/finanzas`, bloque Administración solo para socios, pestañas en `?tab=`, formularios, filtros, desglose, acumulados y catálogo con flechas | `Finanzas.test.tsx`, pruebas de formato y recorrido de navegador con handlers y SQLite reales |
| Ampliación Socios | CRUD en `/socios`; corrección del correo y asociación del histórico en una transacción; baja con pagos = desactivación; baja sin pagos = eliminación; alta, cambio y baja dejan rastro (`created_by`/`created_at` en la ficha y log del Worker) | Backend: duplicados, validación, caja invariable, rollback de cambio de correo y baja concurrente al reparto. E2E: alta, edición, pago, baja, reactivación y persistencia al recargar |
| §8. Integración CI | Ruta añadida a `check:js`, suite a `test:backend`; pruebas React y E2E descubiertas por los runners existentes | `npm run check`, tests del panel, typecheck, build y Playwright |
| §9. Alcance | Sin conversión de divisas, integración automática de IA, porcentajes ni funciones fiscales | Las cajas, sumas, formatos y repartos usan exclusivamente EUR/COP |
| §10. Tres fases | Movimientos/resumen, repartos y catálogo/exportación/filtro cliente/desglose implementados juntos | El recorrido E2E registra, corrige, reparte, reordena, desactiva un concepto usado, corrige su movimiento histórico y borra |

## Publicación de la gestión de socios

1. Aplicar la migración **0038** antes del nuevo Worker mediante el flujo de CI/CD
   existente. Se conserva intacta la 0037 ya desplegada. La nueva migración copia los
   beneficiarios iniciales y los del histórico, mantiene sus nombres y añade la guarda
   que impide escribir un reparto para un socio dado de baja durante la operación.
2. Publicar el Worker y el build del panel verificados. La pestaña **Socios** permite
   mantener nombre y correo sin editar variables ni ejecutar SQL.
3. `SOCIOS_EMAILS` conserva los permisos de entrada actuales
   (`botnexo.ia@gmail.com,juanesgarciag@gmail.com`) y sigue exigiendo rol `velai`.
   La gestión de beneficiarios no cambia `ADMIN_EMAILS`, `admin_users` ni Access.

No se necesita sembrar un saldo inicial: la caja parte de cero y se calcula con los
movimientos reales. Para cargar histórico se admite cualquier día desde 2025-01-01.

## Detalles de uso

- Las tarjetas y el desglose usan el periodo seleccionado. Los filtros tipo, moneda,
  concepto y cliente acotan el listado y su CSV. La caja nunca se filtra.
- EUR se escribe en euros con hasta dos decimales (coma o punto); COP, en pesos enteros.
  El API recibe céntimos EUR/pesos COP. El CSV expresa euros/pesos y conserva la columna
  `moneda`; no contiene un total que mezcle divisas.
- Toda operación sobre un socio queda registrada: la ficha guarda quién la dio de alta y
  cuándo, y el Worker escribe `fin_socio_alta`, `fin_socio_cambio` (con el de→a) y
  `fin_socio_baja`. Añadir a alguien que cobra no puede ser una operación sin rastro.
- En **Socios**, «Quitar» elimina a quien no tiene pagos. Si tiene repartos, lo deja
  inactivo para conservar su nombre e histórico; «Reactivar» lo devuelve al selector.
  Editar el correo mantiene juntos sus pagos de EUR y COP, con la caja intacta.
- Para corregir una línea de reparto, borrar el reparto completo y volver a registrarlo.
  El panel confirma cada borrado y el Worker registra `fin_borrado` con id y actor.
- El concepto que firman los repartos se localiza por la **marca** `sistema = 1` del
  catálogo, no por su nombre. La API rechaza renombrarlo, desactivarlo y borrarlo
  (`409 concepto_del_sistema`) y el panel no ofrece esos botones; reordenarlo sí. Si
  alguien lo retira a mano en D1, el reparto falla con un error explícito sin escribir nada.
- En un reparto, la línea de quien no cobra esta vez **se deja en blanco** y no se registra;
  solo hace falta quitar la línea si sobra. Sin ningún importe, el botón queda deshabilitado.
- Las flechas del catálogo desplazan las posiciones afectadas en una transacción.
  Desactivar un concepto lo retira del alta pero permite corregir sus movimientos previos.

## Comandos de verificación

La ampliación se verifica con los comandos de abajo, pruebas de migración sobre el
esquema ya desplegado y un recorrido E2E adicional de gestión de socios.

Resultado local del 2026-09-17: `check`, typecheck y build correctos; 18 pruebas de
Finanzas en backend, 166 pruebas del panel y 26 recorridos de navegador aprobados.
El recorrido de socios comprueba escritorio y móvil, sin desbordamiento horizontal.

La validación es local; no equivale a un despliegue ni a CI remoto ejecutado sobre un PR.

```sh
npm run check
npm run test:panel
npm run typecheck --prefix panel
npm run build --prefix panel
npm exec --prefix panel -- playwright test --config panel/playwright.config.ts
```

Los E2E de Finanzas sirven el build local e interceptan todas las peticiones: usan el
router real con un scope de prueba y SQLite efímera. No necesitan Cloudflare, Access,
secretos ni credenciales, y no contactan con producción.
