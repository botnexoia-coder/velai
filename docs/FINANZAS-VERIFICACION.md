# Finanzas: implementación y puesta en marcha

Implementación de las tres fases de [SPEC-FINANZAS.md](SPEC-FINANZAS.md).
El código está en el árbol de trabajo. **`SOCIOS_EMAILS` lleva al primer socio**, Juan
Esteban García (`juanesgarciag@gmail.com`), en producción y staging; su nombre lo siembra la
migración en `fin_socios`. No se ha aplicado ninguna migración remota ni desplegado este
cambio.

## Cobertura de la especificación

| Requisito | Implementación | Evidencia de verificación |
|---|---|---|
| §1–2. Perímetro admin y segunda cerradura | Router montado en `buildAdminApp`; `esSocio` en los 13 handlers; `/me.socio`; lista en variables de entorno | `test/finanzas.test.js` recorre todos los métodos con un administrador no socio y un cliente, sin permitir consultas D1; `test/aislamiento.test.js` recorre el router completo con `clienteGate` |
| §3, §7. Esquema y catálogo | `0037_finanzas.sql`: cuatro tablas, índices, 22 conceptos (5 ingresos, 11 gastos, 6 egresos), la marca `sistema` del egreso de repartos con su índice parcial y el nombre del primer socio | Pruebas sobre SQLite real con todas las migraciones y claves ajenas activadas |
| §4. Cuentas por moneda | Sumas del libro agrupadas por EUR/COP; beneficio sin egresos; caja y repartido desde el origen | Prueba con ingresos históricos, movimientos del periodo, reparto y COP con beneficio negativo; prueba de periodo vacío con caja conservada |
| §5. Conceptos y movimientos | CRUD, validación de importes, fechas, tipo/concepto, cliente opcional, paginación de 50 por tupla; el concepto del sistema solo se reordena | Backend: entrada inválida, conceptos desactivados, protección del histórico, edición, borrado, filtros y 55 filas con fecha/timestamp idénticos |
| §5. Repartos | Cabecera y líneas en un `DB.batch`; beneficiarios validados contra entorno; aviso de caja negativa; borrado completo en batch | Trigger de SQLite que falla en la segunda línea y otro que falla al borrar la cabecera: ninguno deja cambios parciales |
| §5. CSV | Exportación de todo el libro filtrado; BOM, escapado CSV y protección de fórmulas reutilizada | Prueba de filtros, 55 filas sin límite de página, céntimos EUR presentados como euros y COP entero |
| §6. Panel | `/finanzas`, bloque Administración solo para socios, pestañas en `?tab=`, formularios, filtros, desglose, acumulados y catálogo con flechas | `Finanzas.test.tsx`, pruebas de formato y recorrido de navegador con handlers y SQLite reales |
| §8. Integración CI | Ruta añadida a `check:js`, suite a `test:backend`; pruebas React y E2E descubiertas por los runners existentes | `npm run check`, tests del panel, typecheck, build y Playwright |
| §9. Alcance | Sin conversión de divisas, integración automática de IA, porcentajes ni funciones fiscales | Las cajas, sumas, formatos y repartos usan exclusivamente EUR/COP |
| §10. Tres fases | Movimientos/resumen, repartos y catálogo/exportación/filtro cliente/desglose implementados juntos | El recorrido E2E registra, corrige, reparte, reordena, desactiva un concepto usado, corrige su movimiento histórico y borra |

## Activación pendiente

1. `SOCIOS_EMAILS` lleva `botnexo.ia@gmail.com,juanesgarciag@gmail.com`. La **cuenta raíz
   ve Finanzas desde el primer despliegue**: está en `ADMIN_EMAILS`, así que cumple las dos
   condiciones de `esSocio`. **`juanesgarciag@gmail.com` solo la verá si tiene rol velai**
   — no figura en `ADMIN_EMAILS`, de modo que hace falta que esté en `admin_users`
   (Configuración → Admins). Los socios siguientes se añaden igual, bajo `[vars]` y
   `[env.staging.vars]`.
   Nota: ambos correos aparecen como beneficiarios distintos al repartir; si son de la
   misma persona, conviene repartir siempre al mismo para no partir su acumulado.
2. Aplicar la migración 0037 por el flujo de CI/CD existente, antes de desplegar el Worker.
   El catálogo inicial es el de la especificación y la propia migración siembra el nombre
   del primer socio. Los siguientes se cargan en `fin_socios` con el correo en minúsculas y
   un `INSERT … ON CONFLICT(email) DO UPDATE`. Esta tabla únicamente aporta nombres; sin
   fila, se muestra el correo.
3. Desplegar el Worker y el build del panel que han pasado CI. Comprobar con una sesión de
   socio que `/api/admin/me` devuelve `socio: true` y aparece Administración → Finanzas;
   con un administrador no socio y con un cliente, Finanzas debe responder 403.

No se necesita sembrar un saldo inicial: la caja parte de cero y se calcula con los
movimientos reales. Para cargar histórico se admite cualquier día desde 2025-01-01.

## Detalles de uso

- Las tarjetas y el desglose usan el periodo seleccionado. Los filtros tipo, moneda,
  concepto y cliente acotan el listado y su CSV. La caja nunca se filtra.
- EUR se escribe en euros con hasta dos decimales (coma o punto); COP, en pesos enteros.
  El API recibe céntimos EUR/pesos COP. El CSV expresa euros/pesos y conserva la columna
  `moneda`; no contiene un total que mezcle divisas.
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

Resultado local del 2026-09-17, tras blindar el concepto de repartos y admitir líneas en
blanco: `npm run check` correcto (**257 tests**), **164 tests del panel**, typecheck de
aplicación y E2E correcto, build generado y **25 E2E correctos** en Chromium (incluidos los
dos recorridos de Finanzas). Revisadas las capturas de escritorio, móvil, formulario de
reparto y catálogo. `git diff --check` sin incidencias.

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
