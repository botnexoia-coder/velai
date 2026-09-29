// Catálogo de plantillas de WhatsApp — EN CÓDIGO: una plantilla es un CONTRATO con el
// código que la envía. El orden de sus variables lo llena una función concreta y los
// payloads de sus botones los parsea el webhook. Aquí, cambiar la plantilla y cambiar a
// su lector es el mismo diff y la revisión los ve juntos (misma filosofía que
// GUARDRAILS: config peligrosa = código).
//
// Desde 2026-09-29 (SPEC-NOTIFICACION-CITA) el CUERPO de las plantillas de citas es
// editable por el cliente, PERO dentro del contrato: el cliente escribe con variables
// con NOMBRE ({{nombre}}, {{fecha}}…) de una lista cerrada por kind (`texto.campos`),
// validarTexto aplica las reglas de Meta y las obligatorias, y cuerpoNumerado lo
// traduce a {{1}}..{{n}} por orden de aparición. Quien envía ya no depende de un orden
// fijo: variablesPara() arma ContentVariables a partir del MISMO texto guardado
// (tenant_templates.texto, 0047), así que el contrato no se puede desalinear. Los
// botones y sus payloads siguen siendo curados y NO editables.
//
// El ESTADO por cliente (sid de Twilio + ciclo de aprobación de Meta) vive en
// tenant_templates (migración 0030), genérico por `kind`: el paso de aprovisionamiento
// (`plantillas/<kind>` en worker/app.js) y el cron que vigila la aprobación
// (pollTemplateApprovals) trabajan contra esa tabla sin saber nada de recordatorios.
// La plantilla nº 3 debe ser SOLO una entrada nueva en este objeto.
//
// La plantilla de LEADS entra en el catálogo con su CUERPO incluido (`aviso_lead`,
// fuente 'columnas'): el catálogo es LA lista completa de plantillas del sistema y,
// desde 2026-09-01, también la ÚNICA fuente del cuerpo del aviso de lead — el paso
// `template` del aprovisionamiento lo lee de aquí (antes vivía duplicable en
// twilio.js/createLeadTemplate, hoy retirado) y la vista del cliente lo previsualiza.
// Su ALMACENAMIENTO sigue en las columnas históricas de tenants
// (lead_template_sid/lead_template_status): unificarlo en tenant_templates exige
// migrar datos y lectores a la vez y sigue siendo un paso aparte. Por eso su
// creación NO va por el POST genérico: la puerta es `fuente !== 'registro'`.

// Parejas de botones CURADAS del recordatorio (decisión de Juan, 2026-09-01: NUNCA
// texto libre hacia Twilio — un catálogo cerrado no puede colar inyección ni pasarse
// del límite de 25 caracteres por botón de WhatsApp). El TEXTO es lo único que varía:
// los payloads conf:/canc: son contrato con handleReminderButton y no cambian jamás.
// Cambiar los botones de una plantilla YA creada exige plantilla nueva + otra revisión
// de Meta (por eso el panel lo advierte); la antelación NO — esa es config del addon.
const PAREJAS_RECORDATORIO = [
  { id: 'confirmo_cancelar', confirmar: 'Confirmo', cancelar: 'Cancelar' },
  { id: 'si_voy_no_puedo', confirmar: 'Sí, voy', cancelar: 'No puedo ir' },
  { id: 'confirmar_cita_cancelar', confirmar: 'Confirmar cita', cancelar: 'Cancelar cita' },
  { id: 'asistire_no_asistire', confirmar: 'Asistiré', cancelar: 'No asistiré' },
];

export const TEMPLATE_CATALOG = {
  confirmacion_reserva: {
    kind: 'confirmacion_reserva', nombre: 'Cita agendada (confirmación)',
    descripcion: 'Avisa al cliente final por WhatsApp en cuanto su cita queda agendada, con el enlace privado para consultarla, cancelarla o cambiarla.',
    fuente: 'registro', categoria: 'UTILITY',
    approvalName: (slug) => `confirmacion_reserva_${slug}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    // Variables con nombre que el cliente puede usar; `enlace` es obligatoria: sin él la
    // notificación pierde su razón de ser (gestionar la cita). La llena
    // confirmationTemplateVariables (worker/app.js) con variablesPara().
    texto: {
      campos: ['nombre', 'negocio', 'servicio', 'fecha', 'hora', 'enlace'],
      obligatorias: ['fecha', 'hora', 'enlace'],
      // Meta rechaza cuerpos que EMPIEZAN o TERMINAN en variable: la frase final existe
      // por eso (la versión anterior acababa en {{5}} y nunca llegó a someterse).
      defecto: 'Hola {{nombre}}, tu cita con {{negocio}} está reservada para el {{fecha}} a las {{hora}}.\n\nPuedes consultarla, cancelarla o cambiarla aquí: {{enlace}}\n\n¡Te esperamos!',
    },
    content: (slug, businessName, _pareja = null, texto = null) => {
      const body = texto || TEMPLATE_CATALOG.confirmacion_reserva.texto.defecto;
      return {
        friendly_name: `confirmacion_reserva_${slug}`.replace(/[^a-z0-9_]/g, '_'), language: 'es',
        variables: ejemplosPara(body, businessName),
        types: { 'twilio/text': { body: cuerpoNumerado(body) } },
      };
    },
  },
  recordatorio_cita: {
    kind: 'recordatorio_cita',
    nombre: 'Recordatorio de cita (Confirmaciones)',
    // Descripción PARA PERSONAS (la pinta la vista Plantillas del panel): qué hace y
    // quién la envía, sin jerga de columnas ni de crons internos.
    descripcion: 'Recuerda la cita al cliente final con antelación, con botones para confirmar o cancelar.',
    fuente: 'registro', // estado en tenant_templates; se crea con el POST genérico plantillas/<kind>
    categoria: 'UTILITY', // mensaje iniciado por el negocio: SIEMPRE plantilla aprobada (63016)
    // Antelación CURADA (12/24/48, default 24). Es config del ADDON, no de la
    // plantilla: vive en tenants.reminder_hours y se cambia después sin nueva
    // aprobación — por eso el CUERPO de abajo es NEUTRO respecto al tiempo (nada de
    // «mañana»: la fecha y la hora van en variables).
    antelaciones: [12, 24, 48],
    antelacionDefault: 24,
    botones: PAREJAS_RECORDATORIO,
    botonesDefault: 'confirmo_cancelar',
    // Nombre con el que se somete a aprobación en Meta (exige minúsculas/0-9/_).
    approvalName: (slug) => `recordatorio_cita_${slug}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    // CONTRATO de variables: con el texto por defecto, 1 nombre, 2 negocio, 3 fecha
    // local, 4 hora local, 5 servicio/motivo — el mismo orden de siempre, así que las
    // plantillas ya aprobadas (texto NULL) reciben exactamente las variables de antes.
    // Con texto propio el orden es el de aparición (cuerpoNumerado). El id de la cita
    // viaja SIEMPRE en la variable siguiente a las del cuerpo, dentro del payload de los
    // botones (`conf:<id>`/`canc:<id>`), que parsea handleReminderButton en el webhook.
    // Lo llena reminderTemplateVariables (worker/app.js) con variablesPara().
    // Quién la envía: processReminders (cron de 5 min, worker/app.js) — sin modelo.
    // `pareja` llega YA validada contra PAREJAS_RECORDATORIO (templateOptions).
    texto: {
      campos: ['nombre', 'negocio', 'servicio', 'fecha', 'hora'],
      obligatorias: ['fecha', 'hora'],
      defecto: 'Hola {{nombre}}, te escribimos de {{negocio}} para recordarte tu cita del {{fecha}} a las {{hora}} ({{servicio}}). ¿Podrás venir?',
    },
    content: (slug, businessName, pareja = null, texto = null) => {
      const textos = pareja || PAREJAS_RECORDATORIO[0];
      const body = texto || TEMPLATE_CATALOG.recordatorio_cita.texto.defecto;
      const idVar = clavesDe(body).length + 1;
      return {
        friendly_name: `recordatorio_cita_${slug}`.replace(/[^a-z0-9_]/g, '_'),
        language: 'es',
        variables: { ...ejemplosPara(body, businessName), [idVar]: '00000000-0000-4000-8000-000000000000' },
        types: {
          // quick-reply: los botones de respuesta rápida de WhatsApp. La respuesta del
          // cliente abre su ventana de 24 h — las contestaciones no necesitan plantilla.
          'twilio/quick-reply': {
            body: cuerpoNumerado(body),
            actions: [
              { title: textos.confirmar, id: `conf:{{${idVar}}}` },
              { title: textos.cancelar, id: `canc:{{${idVar}}}` },
            ],
          },
        },
      };
    },
  },
  // LEGACY-COLUMNAS: su estado vive en tenants.lead_template_sid/lead_template_status
  // y se crea en el paso 2 del aprovisionamiento del cliente (que lee ESTE content) —
  // el POST genérico plantillas/<kind> la rechaza por fuente (template_kind_not_creatable).
  // La envía deliver() (app.js) al equipo del negocio cuando entra un lead.
  aviso_lead: {
    kind: 'aviso_lead',
    nombre: 'Aviso de lead',
    descripcion: 'Avisa al equipo del negocio por WhatsApp cuando entra un lead nuevo.',
    fuente: 'columnas',
    categoria: 'UTILITY',
    approvalName: (slug) => `nuevo_lead_${slug}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    // CONTRATO de variables: 1 WhatsApp, 2 Nombre, 3 Negocio, 4 Necesidad — lo llena
    // leadTemplateVariables (worker/app.js). Si cambias algo, cambia allí en el mismo
    // commit. Cuerpo portado TAL CUAL del createLeadTemplate histórico (twilio.js).
    content: (slug, businessName) => ({
      friendly_name: `nuevo_lead_${slug}`.replace(/[^a-z0-9_]/g, '_'),
      language: 'es',
      variables: { 1: '34612345678', 2: 'María', 3: 'Barbería en Madrid', 4: 'Atender clientes fuera de horario' },
      types: {
        'twilio/text': {
          body: `🔥 Nuevo lead – ${businessName}\n\n📱 WhatsApp: {{1}}\n👤 Nombre: {{2}}\n🏪 Negocio: {{3}}\n🎯 Necesidad: {{4}}\n\n⚡ Contactar hoy mismo`,
        },
      },
    }),
  },
};

// Lookup seguro (GUIA-WORKERS §2): 'constructor' y '__proto__' son kinds válidos para
// un atacante — nunca objeto[claveDelUsuario] a pelo.
export function templateKind(kind) {
  return typeof kind === 'string' && kind !== ''
    && Object.prototype.hasOwnProperty.call(TEMPLATE_CATALOG, kind)
    ? TEMPLATE_CATALOG[kind] : null;
}

// Valida las OPCIONES del diálogo de alta contra el catálogo. La pareja se busca por
// id en la lista curada (un id hostil — 'constructor', texto arbitrario — simplemente
// no está: array find, sin lookup por clave) y la antelación contra la lista curada.
// Sin body u opción ausente → los defaults del catálogo: el alta sin opciones (flujo
// anterior y llamadores viejos) sigue valiendo tal cual.
// Devuelve { error } si algo no casa: el llamante responde 400 SIN tocar Twilio.
export function templateOptions(def, body = {}) {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  let pareja = null;
  if (raw.botones !== undefined) {
    pareja = typeof raw.botones === 'string' ? (def.botones || []).find((b) => b.id === raw.botones) || null : null;
    if (!pareja) return { error: 'invalid_botones' };
  } else if (def.botonesDefault) {
    pareja = (def.botones || []).find((b) => b.id === def.botonesDefault) || null;
  }
  let antelacion = def.antelacionDefault ?? null;
  if (raw.antelacion !== undefined) {
    const n = Number(raw.antelacion);
    if (!(def.antelaciones || []).includes(n)) return { error: 'invalid_antelacion' };
    antelacion = n;
  }
  return { pareja, antelacion };
}

// ── Texto editable (SPEC-NOTIFICACION-CITA) ──────────────────────────────────
// Las variables con NOMBRE que existen en el sistema. Cada kind declara cuáles admite
// (`texto.campos`); una clave fuera de esa lista es un error, nunca se pasa a Meta.
// `ejemplo` es lo que se somete a Meta como sample value y lo que pinta la preview.
export const CAMPOS_TEXTO = {
  nombre: { label: 'Nombre del cliente', ejemplo: 'María' },
  negocio: { label: 'Tu negocio', ejemplo: null }, // el nombre real del negocio
  servicio: { label: 'Servicio', ejemplo: 'Consulta' },
  fecha: { label: 'Fecha', ejemplo: 'jueves, 4 de septiembre' },
  hora: { label: 'Hora', ejemplo: '10:00' },
  enlace: { label: 'Enlace para gestionar la cita', ejemplo: 'https://citas.hirevai.com/ejemplo/cita/0123456789abcdef0123456789abcdef' },
};
// Límite de Meta para el cuerpo de una plantilla (body ≤ 1.024 caracteres).
export const TEXTO_MAX = 1024;
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

// Claves en orden de PRIMERA aparición: ese orden ES la numeración {{1}}..{{n}}.
export function clavesDe(texto) {
  const out = [];
  for (const m of String(texto || '').matchAll(TOKEN)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
export function cuerpoNumerado(texto) {
  const claves = clavesDe(texto);
  return String(texto || '').replace(TOKEN, (_, k) => `{{${claves.indexOf(k) + 1}}}`);
}
export function ejemplosPara(texto, businessName) {
  const out = {};
  clavesDe(texto).forEach((k, i) => {
    out[i + 1] = k === 'negocio' ? (businessName || 'el negocio') : (CAMPOS_TEXTO[k]?.ejemplo ?? k);
  });
  return out;
}
// ContentVariables a partir del MISMO texto con el que se creó la plantilla activa:
// `valores` por clave; `extra` = variables que van detrás de las del cuerpo (el id de la
// cita de los botones del recordatorio). Texto null = el defecto del catálogo.
export function variablesPara(def, texto, valores, extra = []) {
  const claves = clavesDe(texto || def.texto.defecto);
  const out = {};
  claves.forEach((k, i) => { out[i + 1] = valores[k]; });
  extra.forEach((v, j) => { out[claves.length + 1 + j] = v; });
  return out;
}
export function textoEditable(def) {
  return Boolean(def && def.texto && def.fuente === 'registro' && typeof def.content === 'function');
}

// Normaliza lo que teclea el cliente: saltos de Windows, espacios de cola por línea.
export function normalizarTexto(raw) {
  return String(raw ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n').trim();
}

// Reglas de Meta + contrato del kind. Devuelve { errores: [{code, clave?}], texto,
// cuerpo }. Los códigos son contrato con el panel (panel/src/api/errors.ts).
export function validarTexto(def, raw) {
  const errores = [];
  const texto = normalizarTexto(raw);
  const err = (code, clave) => errores.push(clave ? { code, clave } : { code });
  if (!texto) { err('texto_vacio'); return { errores, texto, cuerpo: '' }; }
  const campos = def.texto.campos;
  const vistas = [];
  for (const m of texto.matchAll(TOKEN)) {
    const clave = m[1];
    if (!campos.includes(clave)) { if (!errores.some((e) => e.code === 'variable_desconocida' && e.clave === clave)) err('variable_desconocida', clave.slice(0, 30)); continue; }
    if (vistas.includes(clave)) { if (!errores.some((e) => e.code === 'variable_repetida' && e.clave === clave)) err('variable_repetida', clave); continue; }
    vistas.push(clave);
  }
  for (const clave of def.texto.obligatorias) if (!vistas.includes(clave)) err('falta_variable', clave);
  const sinTokens = texto.replace(TOKEN, '');
  if (/\{\{|\}\}/.test(sinTokens)) err('llaves_sueltas');
  if (/^\{\{/.test(texto)) err('empieza_con_variable');
  if (/\}\}$/.test(texto)) err('termina_con_variable');
  // Dos variables pegadas o separadas solo por espacios. Un signo entre medias sí vale:
  // «a las {{hora}} ({{servicio}})» es el cuerpo del recordatorio que Meta ya aprobó.
  if (/\}\}\s*\{\{/.test(texto)) err('variables_juntas');
  if (/\n{3,}/.test(texto)) err('saltos_excesivos');
  if (/\t| {5,}/.test(texto)) err('espacios_excesivos');
  // Meta rechaza plantillas con demasiadas variables para su longitud.
  const palabras = sinTokens.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const nVars = texto.match(TOKEN)?.length || 0;
  if (palabras < Math.max(3, nVars * 2)) err('pocas_palabras');
  const cuerpo = cuerpoNumerado(texto);
  if (cuerpo.length > TEXTO_MAX) err('texto_largo');
  return { errores, texto, cuerpo };
}

// Vista previa REAL: el cuerpo con los valores de ejemplo sustituidos. UNA sola fuente
// de verdad (este catálogo): el panel pinta lo que llega, sin duplicar el cuerpo.
export function renderTexto(texto, businessName = 'Clínica Ejemplo') {
  const ej = ejemplosPara(texto, businessName);
  const claves = clavesDe(texto);
  return String(texto || '').replace(TOKEN, (_, k) => String(ej[claves.indexOf(k) + 1] ?? ''));
}
function renderPreview(def) {
  if (typeof def.content !== 'function') return null;
  const c = def.content('ejemplo', 'Clínica Ejemplo');
  const tipo = c.types['twilio/quick-reply'] || c.types['twilio/text'];
  if (!tipo || !tipo.body) return null;
  return tipo.body.replace(/\{\{(\d+)\}\}/g, (_, n) => String((c.variables && c.variables[n]) ?? ''));
}

// Nombre para someter una REVISIÓN a Meta: el nombre de una plantilla es único por
// WABA (y uno borrado no se reutiliza en semanas), así que cada revisión lleva sufijo.
export function nombreRevision(def, slug, nowMs = Date.now()) {
  return `${def.approvalName(slug)}_r${new Date(nowMs).toISOString().slice(0, 16).replace(/\D/g, '')}`.slice(0, 500);
}

// La lista del catálogo para la vista «Plantillas» del panel: solo lo descriptivo
// (los cuerpos numerados y sample values no viajan — son contrato del worker; la
// preview ya va renderizada). categoria/descripcion/config viajan para que el panel no
// tenga NADA hardcodeado por kind: el diálogo de alta y el editor de texto se montan
// con lo que declare el catálogo.
export function catalogKinds() {
  return Object.values(TEMPLATE_CATALOG).map((d) => ({
    kind: d.kind, label: d.nombre, fuente: d.fuente, categoria: d.categoria, descripcion: d.descripcion || '',
    ...(typeof d.content === 'function' ? {
      config: {
        preview: renderPreview(d),
        ...(d.antelaciones ? { antelaciones: d.antelaciones, antelacionDefault: d.antelacionDefault } : {}),
        ...(d.botones ? { botones: d.botones, botonesDefault: d.botonesDefault } : {}),
        ...(textoEditable(d) ? {
          texto: {
            defecto: d.texto.defecto, max: TEXTO_MAX,
            campos: d.texto.campos.map((clave) => ({
              clave, label: CAMPOS_TEXTO[clave].label, obligatoria: d.texto.obligatorias.includes(clave),
              ejemplo: clave === 'negocio' ? 'Clínica Ejemplo' : CAMPOS_TEXTO[clave].ejemplo,
            })),
          },
        } : {}),
      },
    } : {}),
  }));
}
