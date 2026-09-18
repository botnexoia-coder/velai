# Horizonte 1 — lo que queda de «lo barato que se nota»

> Semanas, no meses. Mapa y justificación del orden en [`PLAN-PANEL.md`](./PLAN-PANEL.md).
>
> **§1 (historial de conversaciones en D1) y §2 (informe semanal) están HECHOS** y
> desplegados desde el 2026-08-26: su resumen vive en
> [`IMPLEMENTADO.md`](./IMPLEMENTADO.md) y las comprobaciones en vivo que dejaron
> abiertas, en [`TAREAS-PENDIENTES.md`](./TAREAS-PENDIENTES.md) §2o. Se retiraron de
> aquí el 2026-09-16 para que este doc siga siendo solo trabajo por hacer.
>
> Quedan los tres de abajo. §5 es el único que depende de comprobar contra la API viva
> de Twilio qué campos expone de verdad.
>
> Al cerrar el horizonte: borrar este doc, resumen a `IMPLEMENTADO.md`, restos a
> `TAREAS-PENDIENTES.md`.

---

## §3. Comparativa con el periodo anterior

En cada tarjeta del Dashboard. Convierte un contador en un informe, y es la única
función de la tabla comparativa que solo tiene Gorgias.

En `/api/admin/stats` (`worker/app.js:2628`) cada consulta de 30 días gana su gemela
desplazada — `created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days')` —
y la respuesta devuelve `{ valor, anterior }` por métrica. Es literalmente un `WHERE`
desplazado; el `batch()` ya existe y absorbe las sentencias nuevas.

**Trampa a evitar:** `captura.desde` parte de `CONV_TRACKING_SINCE` (2026-08-26). Hasta finales
de septiembre la ventana anterior **no tiene población comparable**, y una comparación con cero
pintaría un -100% falso. Cuando `desde` cae dentro del periodo anterior, la tarjeta
enseña «—» y el motivo, no un porcentaje. El panel ya advierte de esto en la tasa de
captura; misma honestidad aquí.

---

## §4. Tiempo y dinero ahorrado

Solo Bookline y 1MillionBot traducen a lenguaje de dueño (`ETC`, horas humanas
ahorradas); Gorgias lo hace en soporte con dos tarjetas de primer nivel. Para Velai la
fórmula es aritmética:

```
horas_ahorradas = conversaciones_atendidas × minutos_por_conversación / 60
dinero_ahorrado = horas_ahorradas × coste_hora
```

**Lo importante no es la fórmula, son los supuestos visibles y editables por el
cliente.** Un número que el cliente puede ajustar es un número que defiende él.

```sql
ALTER TABLE tenants ADD COLUMN savings_minutes REAL;   -- NULL = usar el default
ALTER TABLE tenants ADD COLUMN savings_cost_hour REAL;
```

Defaults en `[vars]`, no en el esquema, para poder moverlos sin migración. La referencia
citable es el informe de ROI de Intercom: **6–12 $ por ticket atendido por una persona**.
La tarjeta enseña el supuesto usado en letra pequeña, con un lápiz para cambiarlo.

Cuenta conversaciones, no leads, y lo dice: *«supone que cada una de las 14
conversaciones habría costado 6 minutos a una persona»*.

---

## §5. Estado granular de plantillas

Velai ya tiene lo difícil — crear, comprobar a demanda, reenviar a aprobación y mostrar
la respuesta cruda de Twilio (`handleProvision`, `template/check` en
`worker/app.js:2288`; el barrido del cron en `:3563`). Lo que falta es que enseñe **siete
estados donde hoy enseña dos**.

Patrón a copiar casi literal (Respond.io):
`Processing / In Review / Approved / Rejected / Flagged / Paused / Appeal`, más:

- **el motivo de rechazo** y el **quality rating** traídos de Meta,
- sincronización automática con botón manual de respaldo (ya existe el botón),
- el **contador de ediciones** a la vista: 10 en 30 días, 1 cada 24 h en las aprobadas,
- y **valores de ejemplo obligatorios para cada parámetro** al crear la plantilla — es
  la causa de rechazo número uno según la documentación de Meta y de Wati.

```sql
ALTER TABLE tenants ADD COLUMN lead_template_reason TEXT;
ALTER TABLE tenants ADD COLUMN lead_template_quality TEXT;
ALTER TABLE tenants ADD COLUMN lead_template_checked_at TEXT;
ALTER TABLE tenants ADD COLUMN lead_template_edits_json TEXT;   -- [{at}] de las ediciones
```

`deliver()` seguirá bloqueando el envío con cualquier estado ≠ `approved`
(`worker/app.js:1160`), así que el `CHECK` no cambia de semántica: solo se ensancha el
vocabulario de lo que se muestra.

**Por qué va al final del horizonte:** es el único entregable cuyo alcance depende de
qué expone de verdad la API de Twilio. `rejection_reason` está documentado; el *quality
rating* vive en el lado WABA/Meta y puede no venir en la respuesta de aprobación de
Content API.

- [ ] **Verificar en vivo** contra una plantilla real (GOgestión sirve: su plantilla
      estuvo en `pending` eterno porque nunca llegó a Meta — es justo el caso que un
      panel así habría enseñado el primer día) qué campos devuelve Twilio, y recortar el
      alcance a los que existan antes de escribir la UI.
