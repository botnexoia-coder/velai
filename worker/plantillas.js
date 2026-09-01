// Catálogo de plantillas de WhatsApp — EN CÓDIGO, nunca en D1 ni editable desde el
// panel, a propósito: una plantilla es un CONTRATO con el código que la envía. El orden
// exacto de sus variables lo llena una función concreta y los payloads de sus botones
// los parsea el webhook; editar un cuerpo desde el panel podría romper ese contrato sin
// que ningún test lo viera. Aquí, cambiar la plantilla y cambiar a su lector es el mismo
// diff y la revisión los ve juntos (misma filosofía que GUARDRAILS: config peligrosa =
// código).
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
    // CONTRATO de variables: 1 nombre, 2 negocio, 3 fecha local, 4 hora local, 5 motivo,
    // 6 id de la cita (viaja en el payload de los botones). Lo llena
    // reminderTemplateVariables (worker/app.js) y los payloads `conf:<id>`/`canc:<id>`
    // los parsea handleReminderButton en el webhook de Twilio. Si cambias algo aquí,
    // cambia allí EN EL MISMO COMMIT.
    // Quién la envía: processReminders (cron de 5 min, worker/app.js) — sin modelo.
    // `pareja` llega YA validada contra PAREJAS_RECORDATORIO (templateOptions).
    content: (slug, businessName, pareja = null) => {
      const textos = pareja || PAREJAS_RECORDATORIO[0];
      return {
        friendly_name: `recordatorio_cita_${slug}`.replace(/[^a-z0-9_]/g, '_'),
        language: 'es',
        variables: {
          1: 'María', 2: businessName || 'el negocio', 3: 'jueves, 4 de septiembre',
          4: '10:00', 5: 'consulta', 6: '00000000-0000-4000-8000-000000000000',
        },
        types: {
          // quick-reply: los botones de respuesta rápida de WhatsApp. La respuesta del
          // cliente abre su ventana de 24 h — las contestaciones no necesitan plantilla.
          'twilio/quick-reply': {
            body: 'Hola {{1}}, te escribimos de {{2}} para recordarte tu cita del {{3}} a las {{4}} ({{5}}). ¿Podrás venir?',
            actions: [
              { title: textos.confirmar, id: 'conf:{{6}}' },
              { title: textos.cancelar, id: 'canc:{{6}}' },
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

// Vista previa REAL del mensaje: el cuerpo de la plantilla con sus valores de ejemplo
// sustituidos. UNA sola fuente de verdad (este catálogo): el panel pinta lo que llega,
// sin duplicar ni un literal del cuerpo.
function renderPreview(def) {
  if (typeof def.content !== 'function') return null;
  const c = def.content('ejemplo', 'Clínica Ejemplo');
  const tipo = c.types['twilio/quick-reply'] || c.types['twilio/text'];
  if (!tipo || !tipo.body) return null;
  return tipo.body.replace(/\{\{(\d+)\}\}/g, (_, n) => String((c.variables && c.variables[n]) ?? ''));
}

// La lista del catálogo para la vista «Plantillas» del panel: solo lo descriptivo
// (los cuerpos crudos y sample values no viajan — son contrato del worker; la preview
// ya va renderizada). categoria/descripcion/config viajan para que el panel no tenga
// NADA hardcodeado por kind: el diálogo de alta se monta con lo que declare el catálogo.
export function catalogKinds() {
  return Object.values(TEMPLATE_CATALOG).map((d) => ({
    kind: d.kind, label: d.nombre, fuente: d.fuente, categoria: d.categoria, descripcion: d.descripcion || '',
    ...(typeof d.content === 'function' ? {
      config: {
        preview: renderPreview(d),
        ...(d.antelaciones ? { antelaciones: d.antelaciones, antelacionDefault: d.antelacionDefault } : {}),
        ...(d.botones ? { botones: d.botones, botonesDefault: d.botonesDefault } : {}),
      },
    } : {}),
  }));
}
