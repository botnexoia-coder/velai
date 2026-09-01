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
// La plantilla de LEADS entra en el catálogo como entrada DESCRIPTIVA (`aviso_lead`,
// fuente 'columnas'): así el catálogo es LA lista completa de plantillas del sistema
// y la vista «Plantillas» del panel la enseña junto a las demás. Su ALMACENAMIENTO
// sigue en las columnas históricas de tenants (lead_template_sid/lead_template_status)
// y su cuerpo en twilio.js (createLeadTemplate) — unificarla en tenant_templates exige
// migrar datos y lectores a la vez y sigue siendo un paso aparte.

export const TEMPLATE_CATALOG = {
  recordatorio_cita: {
    kind: 'recordatorio_cita',
    nombre: 'Recordatorio de cita (Confirmaciones)',
    // Descripción PARA PERSONAS (la pinta la vista Plantillas del panel): qué hace y
    // quién la envía, sin jerga de columnas ni de crons internos.
    descripcion: 'Recuerda la cita al cliente final 24 h antes, con botones «Confirmo» y «Cancelar».',
    fuente: 'registro', // estado en tenant_templates; se crea con el POST genérico plantillas/<kind>
    categoria: 'UTILITY', // mensaje iniciado por el negocio: SIEMPRE plantilla aprobada (63016)
    // Nombre con el que se somete a aprobación en Meta (exige minúsculas/0-9/_).
    approvalName: (slug) => `recordatorio_cita_${slug}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    // CONTRATO de variables: 1 nombre, 2 negocio, 3 fecha local, 4 hora local, 5 motivo,
    // 6 id de la cita (viaja en el payload de los botones). Lo llena
    // reminderTemplateVariables (worker/app.js) y los payloads `conf:<id>`/`canc:<id>`
    // los parsea handleReminderButton en el webhook de Twilio. Si cambias algo aquí,
    // cambia allí EN EL MISMO COMMIT.
    // Quién la envía: processReminders (cron de 5 min, worker/app.js) — sin modelo.
    content: (slug, businessName) => ({
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
            { title: 'Confirmo', id: 'conf:{{6}}' },
            { title: 'Cancelar', id: 'canc:{{6}}' },
          ],
        },
      },
    }),
  },
  // LEGACY-COLUMNAS: entrada solo descriptiva — SIN `content`, así el paso genérico de
  // aprovisionamiento la rechaza (template_kind_not_creatable). Se crea en el paso 2
  // del aprovisionamiento del cliente (createLeadTemplate, twilio.js) y su estado vive
  // en tenants.lead_template_sid/lead_template_status; la envía deliver() (app.js) al
  // equipo del negocio cuando entra un lead.
  aviso_lead: {
    kind: 'aviso_lead',
    nombre: 'Aviso de lead',
    descripcion: 'Avisa al equipo del negocio por WhatsApp cuando entra un lead nuevo.',
    fuente: 'columnas',
    categoria: 'UTILITY',
    approvalName: (slug) => `nuevo_lead_${slug}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
  },
};

// Lookup seguro (GUIA-WORKERS §2): 'constructor' y '__proto__' son kinds válidos para
// un atacante — nunca objeto[claveDelUsuario] a pelo.
export function templateKind(kind) {
  return typeof kind === 'string' && kind !== ''
    && Object.prototype.hasOwnProperty.call(TEMPLATE_CATALOG, kind)
    ? TEMPLATE_CATALOG[kind] : null;
}

// La lista del catálogo para la vista «Plantillas» del panel: solo lo descriptivo
// (los cuerpos y sample values no viajan — son contrato del worker, no dato de UI).
// categoria y descripcion viajan para que el panel no tenga NADA hardcodeado por kind:
// la tarjeta del kind nº 3 se pinta sola con lo que declare su entrada del catálogo.
export function catalogKinds() {
  return Object.values(TEMPLATE_CATALOG).map((d) => ({
    kind: d.kind, label: d.nombre, fuente: d.fuente, categoria: d.categoria, descripcion: d.descripcion || '',
  }));
}
