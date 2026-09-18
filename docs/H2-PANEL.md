# Horizonte 2 — lo que cierra la paridad

> Un trimestre. Mapa en [`PLAN-PANEL.md`](./PLAN-PANEL.md). H1 §1 (conversaciones en D1),
> del que cuelgan casi todos, está hecho desde el 2026-08-26.
>
> **§4 (responder desde el panel) se construyó** con spec propia el 2026-08-26 y se
> retiró de aquí el 2026-09-16: su resumen está en [`IMPLEMENTADO.md`](./IMPLEMENTADO.md)
> («Bandeja de conversaciones»). Quedan los cuatro de abajo.
>
> Esbozo, no spec fina. Cada entregable se detalla al empezarlo — escribir la spec
> ahora es escribirla dos veces.

---

## §1. Base de conocimiento gestionable

Es exactamente la **fase 2 de `CONTEXTOS-AMPLIOS.md`** (`tenant_docs` en D1), ya en
`TAREAS-PENDIENTES.md` §2d. El hallazgo competitivo añade algo que ese doc no decía:
**no es solo calidad de respuesta, es una pantalla que el cliente espera operar él
mismo.**

Hoy el saber de un cliente es su `system_prompt`: un campo donde 220 caracteres de
instrucciones compiten con trece mil de datos (por eso Zoe y GOgestión contestan más
largo de lo que su prompt pide). El mercado resolvió esto hace dos años: Tidio ingiere
URLs, CSV y PDF con re-sincronización semanal; Wati acepta un PDF de hasta 200 MB;
Kommo construye la base desde la URL del negocio.

Pantalla propia: **subir, probar, publicar.**

**El hueco dentro del hueco:** Tidio documenta que al re-sincronizar las URLs *se
pierden los pares de pregunta-respuesta editados a mano*. **Ninguna de las ocho
plataformas tiene versionado real del conocimiento.** Ahí hay sitio, y es barato: una
tabla con versiones y un botón de volver atrás.

Regla que se mantiene de `CONTEXTOS-AMPLIOS.md`: **no recortar la base de Zoe para
ahorrar** — el problema es cómo se entrega, no cuánto hay.

---

## §2. Conversaciones no resueltas, enlazadas

Fin lo llama *Recommendations*, Gorgias *Opportunities*, Ada *Coaching*, Zendesk
*Spotlights*. Lo que todos tienen en común, y es lo copiable: **la recomendación enlaza a
las conversaciones exactas que la dispararon.**

**No hace falta IA para la primera versión**: es una consulta filtrada sobre
`conversations.unanswered > 0`, agrupada por parecido y ordenada por frecuencia.

Probablemente la pantalla más valiosa del panel: convierte el informe en una lista de
tareas ordenada por rentabilidad, y es el argumento comercial de la renovación —
*«el mes pasado arreglamos estas cinco, mira cómo bajó»*.

Regla operativa que recomienda Ada y que encaja con una pyme: **de tres a cinco temas de
alto volumen al mes**. No cien.

---

## §3. Probar el bot, con la traza

Extender el «Probar» que ya existe al rol cliente, y que enseñe **qué fuentes e
instrucciones usó** para responder. Lo tienen Tidio, Kommo, Crisp, Fin y HubSpot; Velai
lo tiene *parcial* (solo admin, sin traza).

Depende de §1: sin fuentes separadas del prompt no hay traza que enseñar.

---

## §5. Panel por vertical

Centribal menciona plantillas sectorizadas y Bookline es vertical puro, pero **nadie
enseña un panel de clínica, taller, inmobiliaria o asesoría con las métricas de ese
negocio.** Todos entregan el mismo cuadro genérico de conversaciones. Y Velai ya tiene
cuatro clientes en cuatro sectores y cinco páginas de aterrizaje por vertical.

Una gestoría quiere ver *trámites preguntados* y *citas confirmadas*. Una academia,
*matrículas interesadas* y *cursos preguntados*.

**Técnicamente es el campo `need` que ya se extrae en cada lead** (`leads.need`,
migración 0001), agrupado y renombrado por sector. No es un producto nuevo: es una tabla
de mapeo sector → etiquetas y un `GROUP BY`.

Empezar por **la gestoría (GOgestión) y la academia (Diálogos)** — los dos sectores con
cliente vivo y vocabulario claro.
