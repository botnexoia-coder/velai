// La ficha del cliente (rediseño 2026-08): pestañas con UN solo Guardar arriba —
// el punto ámbar marca pestañas con cambios sin guardar — y alta guiada por pasos
// (el borrador queda como prospecto sin enrutar hasta activarlo).
//
// Reglas que NO se rompen (§7 de la spec, portadas del v1):
//  - token write-only (solo viaja si se escribe; jamás se relee);
//  - cada paso de aprovisionamiento recarga la ficha ENTERA (refresca updated_at —
//    evita stale_tenant — y repuebla los inputs con el SID recién creado);
//  - bloqueo optimista con expected_updated_at → el 409 stale_tenant se explica;
//  - nada sensible en el DOM.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { traducir } from '../api/errors';
import { useToast } from '../components/Toasts';
import { IcoTick } from '../components/icons';
import {
  usePreview,
  useProvision,
  useProvisionStep,
  useTenantDetail,
  useTenantSave,
  useTenantUsers,
  useTenantVersions,
  useTenants,
  useUserAdd,
  useUserDelete,
  useVersionRestore,
  useLogoUpload,
  type TenantSaveBody,
} from '../hooks/queries';
import type { TenantChannel, TenantDetail, TenantDetailResponse } from '../api/types';

// Los campos de texto de la ficha (mismo mapa TF que el v1). channel_address NO está
// aquí a propósito: dejó de ser un campo que se teclea — el alta lo deriva del slug en
// el worker y los canales de mensajería se dan de alta en Conexiones.
const TF_KEYS = [
  'name',
  'slug',
  'twilio_from',
  'team_whatsapp',
  'telegram_chat_id',
  'lead_template_sid',
  'twilio_subaccount_sid',
  'waba_id',
  'meta_partner_status',
  'system_prompt',
  'bot_name',
  'brand_name',
  'logo_url',
  'brand_color',
  'brand_color_2',
  'agent_color',
  'greeting',
  'greeting_en',
  'placeholder',
  'wa_number',
  'theme',
  'ai_monthly_tokens',
  'ai_daily_limit',
] as const;
type TFKey = (typeof TF_KEYS)[number];
type Form = Record<TFKey, string>;

function emptyForm(): Form {
  return Object.fromEntries(TF_KEYS.map((k) => [k, ''])) as Form;
}

function formFrom(t: TenantDetail): Form {
  const f = emptyForm();
  for (const k of TF_KEYS) f[k] = t[k] === null || t[k] === undefined ? '' : String(t[k]);
  return f;
}

// chips_json y web_origins van aparte: en el form son una línea por valor; al worker
// viajan como array (el servidor valida y guarda JSON).
function jsonToLines(json: string | null): string {
  try {
    const a: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(a) ? a.join('\n') : '';
  } catch {
    return '';
  }
}
function linesFrom(text: string, max: number): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

const PANES = ['identidad', 'contexto', 'marca', 'prov', 'usuarios', 'historial'] as const;
type Pane = (typeof PANES)[number];
const WIZ: Pane[] = ['identidad', 'contexto', 'marca', 'prov', 'usuarios'];
const PANE_NAMES: Record<Pane, string> = {
  identidad: 'Identidad y canal',
  contexto: 'Contexto',
  marca: 'Marca del widget',
  prov: 'Aprovisionamiento',
  usuarios: 'Usuarios',
  historial: 'Historial',
};

// Vocabulario velai de los canales de la ficha (se PINTAN, no se editan).
const CHSTATE: Record<string, { dot: string; flag: ReactNode }> = {
  live: { dot: 'on', flag: <span className="flag ok">atendido</span> },
  inactive: { dot: '', flag: <span className="flag">cliente inactivo</span> },
  unrouted: { dot: 'bad', flag: <span className="flag off">sin enrutar</span> },
  off: { dot: '', flag: <span className="muted">sin conectar</span> },
};

export function ClienteFicha({ id, onClose }: { id: string | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string; updated_at: string } | null>(null);
  const tenantId = editing?.id ?? id;
  const { data: detail } = useTenantDetail(tenantId);
  const { data: tenants } = useTenants(true);
  const save = useTenantSave();

  const [form, setForm] = useState<Form>(emptyForm);
  const [chipsText, setChipsText] = useState('');
  const [originsText, setOriginsText] = useState('');
  const [active, setActive] = useState(false);
  const [token, setToken] = useState('');
  const [note, setNote] = useState('');
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<Pane>>(new Set());
  const [pane, setPane] = useState<Pane>('identidad');
  const [wizard, setWizard] = useState(id === null);
  const [wizStep, setWizStep] = useState(0);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  // provPost/save recargan la ficha ENTERA: al llegar datos nuevos se repueblan TODOS
  // los inputs (un input vacío guardado habría borrado la subcuenta de la fila) y el
  // updated_at fresco evita el stale_tenant en el siguiente Guardar.
  useEffect(() => {
    if (!detail) return;
    setForm(formFrom(detail.tenant));
    setChipsText(jsonToLines(detail.tenant.chips_json));
    setOriginsText(jsonToLines(detail.tenant.web_origins));
    setActive(Boolean(detail.tenant.active));
    setToken('');
    setEditing({ id: detail.tenant.id, updated_at: detail.tenant.updated_at });
    setDirty(new Set());
    setFieldErrs({});
  }, [detail]);

  const isDirty = dirty.size > 0;
  const markDirty = (p: Pane) => setDirty((s) => (s.has(p) ? s : new Set(s).add(p)));
  const set = (k: TFKey) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function confirmDiscard(): boolean {
    return !isDirty || window.confirm('Hay cambios sin guardar en esta ficha. ¿Cerrar y descartarlos?');
  }

  async function saveTenant(): Promise<boolean> {
    setFieldErrs({});
    const body: TenantSaveBody = { ...form };
    body['chips_json'] = linesFrom(chipsText, 3);
    body['web_origins'] = linesFrom(originsText, 6);
    body['active'] = active;
    body['note'] = note;
    if (token) body.twilio_auth_token = token; // write-only: solo si se escribe
    if (editing) body.expected_updated_at = editing.updated_at;
    try {
      const r = await save.mutateAsync({ id: editing?.id ?? null, body });
      if (!editing && r.id) setEditing({ id: r.id, updated_at: r.updated_at });
      else if (editing) setEditing({ id: editing.id, updated_at: r.updated_at });
      toast('Cliente guardado ✓ (el widget lo ve en ≤5 min por la caché)');
      setDirty(new Set());
      return true;
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      const m = code.match(/^invalid_(.+)$/);
      if (m && m[1]) {
        setFieldErrs({ [m[1]]: 'Formato inválido — revisa el ejemplo del campo.' });
        toast(`NO guardado: revisa el campo «${m[1]}»`, false);
      } else {
        toast(`NO guardado: ${traducir(code)}`, false);
      }
      return false;
    }
  }

  const err = (f: string) => (fieldErrs[f] ? <small className="muted field-err">{fieldErrs[f]}</small> : null);
  const wasNew = id === null;

  return (
    <dialog ref={dialogRef} className="tenant-modal" onClose={onClose} onCancel={(e) => {
      if (!confirmDiscard()) e.preventDefault();
    }} aria-label="Ficha del cliente">
      <div className="modal-top">
        <div className="modal-h">
          <strong>{editing && detail ? detail.tenant.name : wasNew ? 'Nuevo cliente' : 'Cliente'}</strong>
          <div className="mh-r">
            {!wizard ? (
              <>
                <input
                  className="inpill tnote"
                  placeholder="Nota del cambio (opcional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-label="Nota del cambio"
                />
                <button className="btn" type="button" disabled={save.isPending} onClick={() => void saveTenant()}>
                  Guardar
                </button>
              </>
            ) : null}
            <button
              className="btn alt"
              type="button"
              onClick={() => {
                if (confirmDiscard()) dialogRef.current?.close();
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
        {!wizard ? (
          <nav className="ttabs">
            {PANES.map((p) => {
              // Las pestañas de recursos existen solo con el cliente guardado.
              if (!editing && (p === 'prov' || p === 'usuarios' || p === 'historial')) return null;
              return (
                <button key={p} type="button" className={`ttab${pane === p ? ' is-on' : ''}${dirty.has(p) ? ' dirty' : ''}`} onClick={() => setPane(p)}>
                  {PANE_NAMES[p]}
                  <i className="dot" />
                </button>
              );
            })}
          </nav>
        ) : (
          <div className="wizsteps">
            {WIZ.map((p, i) => (
              <span key={p} style={{ display: 'contents' }}>
                {i ? <span className={`wline${i <= wizStep ? ' past' : ''}`} /> : null}
                <span className={`wstep ${i < wizStep ? 'done' : i === wizStep ? 'on' : ''}`}>
                  <span className="wdot">{i < wizStep ? <IcoTick /> : i + 1}</span>
                  <span className="wlab">{PANE_NAMES[p]}</span>
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="modal-b">
        {(wizard ? WIZ[wizStep] : pane) === 'identidad' ? (
          <section onInput={() => markDirty('identidad')}>
            <div className="grid">
              <Card label="Nombre">
                <input value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Barbería López" aria-label="Nombre" />
                {err('name')}
              </Card>
              <Card label="Slug">
                <input value={form.slug} onChange={(e) => set('slug')(e.target.value)} placeholder="barberia-lopez" aria-label="Slug" />
                {err('slug')}
              </Card>
              <div className="card cardwide">
                <b>Canales del cliente</b>
                <Channels channels={detail?.channels ?? null} isNew={!editing} />
                <small className="muted">
                  Se leen del enrutado real, no se escriben: cada canal se da de alta en Conexiones. La web funciona desde
                  el primer día por el slug. {err('channel_address')}
                </small>
              </div>
              <Card label="Twilio From">
                <input value={form.twilio_from} onChange={(e) => set('twilio_from')(e.target.value)} placeholder="whatsapp:+34910000000" aria-label="Twilio From" />
                {err('twilio_from')}
              </Card>
              <Card label="Equipo WhatsApp (coma)">
                <input value={form.team_whatsapp} onChange={(e) => set('team_whatsapp')(e.target.value)} placeholder="whatsapp:+34600111222,whatsapp:+34600333444" aria-label="Equipo WhatsApp" />
                {err('team_whatsapp')}
              </Card>
              <Card label="Telegram chat_id">
                <input value={form.telegram_chat_id} onChange={(e) => set('telegram_chat_id')(e.target.value)} placeholder="-100123456789" aria-label="Telegram chat_id" />
                {err('telegram_chat_id')}
              </Card>
              <Card label="Plantilla de aviso (SID)">
                <input value={form.lead_template_sid} onChange={(e) => set('lead_template_sid')(e.target.value)} placeholder="HX seguido de 32 hex" aria-label="Plantilla de aviso" />
                {err('lead_template_sid')}
              </Card>
              <Card label="Subcuenta Twilio">
                <input value={form.twilio_subaccount_sid} onChange={(e) => set('twilio_subaccount_sid')(e.target.value)} placeholder="AC seguido de 32 hex" aria-label="Subcuenta Twilio" />
                {err('twilio_subaccount_sid')}
              </Card>
              <Card label="WABA del cliente">
                <input value={form.waba_id} onChange={(e) => set('waba_id')(e.target.value)} placeholder="solo dígitos, 10-20" aria-label="WABA" />
                {err('waba_id')}
              </Card>
              <Card label="Auth token de la subcuenta">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="solo para cambiarlo"
                  aria-label="Auth token de la subcuenta"
                />
                <small className="muted">{detail?.tenant.has_twilio_token ? 'configurado ✓ (escribe solo para sustituirlo)' : 'sin configurar'}</small>
                {err('twilio_auth_token')}
              </Card>
              <Card label="Socio en Meta">
                <select value={form.meta_partner_status || 'pendiente'} onChange={(e) => set('meta_partner_status')(e.target.value)} aria-label="Socio en Meta">
                  <option>pendiente</option>
                  <option>concedido</option>
                  <option>revocado</option>
                </select>
              </Card>
              <Card label="Estado">
                <label>
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activo (enruta y atiende)
                </label>
              </Card>
            </div>
          </section>
        ) : null}
        {(wizard ? WIZ[wizStep] : pane) === 'contexto' ? (
          <ContextoPane
            form={form}
            set={set}
            markDirty={() => markDirty('contexto')}
            err={err}
            editingId={editing?.id ?? null}
            isNew={!editing}
            tenants={tenants?.tenants ?? []}
          />
        ) : null}
        {(wizard ? WIZ[wizStep] : pane) === 'marca' ? (
          <MarcaPane form={form} set={set} chipsText={chipsText} setChipsText={setChipsText} originsText={originsText} setOriginsText={setOriginsText} markDirty={() => markDirty('marca')} err={err} editingId={editing?.id ?? null} />
        ) : null}
        {(wizard ? WIZ[wizStep] : pane) === 'prov' && editing ? <ProvPane tenantId={editing.id} form={form} /> : null}
        {(wizard ? WIZ[wizStep] : pane) === 'usuarios' && editing ? <UsersPane tenantId={editing.id} err={err} setFieldErrs={setFieldErrs} /> : null}
        {!wizard && pane === 'historial' && editing ? <HistorialPane tenantId={editing.id} /> : null}
        {wizard ? (
          <div className="wizbar">
            {wizStep > 0 ? (
              <button className="btn alt" type="button" onClick={() => setWizStep((s) => Math.max(0, s - 1))}>
                Atrás
              </button>
            ) : null}
            <span className="muted wizhint">
              {wizStep === WIZ.length - 1
                ? 'Al finalizar, revisa la pestaña «Identidad y canal» y márcalo Activo cuando su canal real esté listo.'
                : 'El borrador se guarda al pasar de paso, sin activar nada hasta el final.'}
            </span>
            <button
              className="btn"
              type="button"
              disabled={save.isPending}
              onClick={() => {
                void (async () => {
                  // El canal no se teclea: el worker deriva pending:<slug> (prospecto que
                  // no enruta) y lo promueve a web:<slug> al marcar Activo.
                  if (isDirty || !editing) {
                    const ok = await saveTenant();
                    if (!ok) return;
                  }
                  if (wizStep === WIZ.length - 1) {
                    setWizard(false);
                    setPane('identidad');
                    toast('Alta completada ✓ — actívalo en «Identidad y canal» cuando su canal esté listo');
                    return;
                  }
                  setWizStep((s) => s + 1);
                })();
              }}
            >
              {wizStep === WIZ.length - 1 ? 'Finalizar' : 'Guardar y continuar'}
            </button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card">
      <b>{label}</b>
      {children}
    </div>
  );
}

function Channels({ channels, isNew }: { channels: TenantChannel[] | null; isNew: boolean }) {
  const list: TenantChannel[] = isNew ? [{ kind: 'web', address: 'se activa con el slug', state: 'off' }] : channels ?? [];
  if (!list.length) {
    return (
      <div className="chlist">
        <div className="chrow">
          <i />
          <span className="chaddr">Sin canales todavía.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="chlist">
      {list.map((c) => {
        const st = CHSTATE[c.state] ?? CHSTATE['off']!;
        return (
          <div key={c.kind} className="chrow">
            <i className={st.dot} />
            <span className="chk">{c.kind}</span>
            <span className="chaddr">{c.address ? String(c.address).replace(/^whatsapp:/, '') : '—'}</span>
            {st.flag}
          </div>
        );
      })}
    </div>
  );
}

// ── Contexto: el system prompt, con contador, duplicado y prueba del borrador ──
function ContextoPane({
  form,
  set,
  markDirty,
  err,
  editingId,
  isNew,
  tenants,
}: {
  form: Form;
  set: (k: TFKey) => (v: string) => void;
  markDirty: () => void;
  err: (f: string) => ReactNode;
  editingId: string | null;
  isNew: boolean;
  tenants: { id: string; name: string }[];
}) {
  const toast = useToast();
  const preview = usePreview();
  const [testMsg, setTestMsg] = useState('');
  const [reply, setReply] = useState('');
  const n = form.system_prompt.length;

  return (
    <section onInput={(e) => {
      // El mensaje de prueba no ensucia la ficha: no se guarda.
      if ((e.target as HTMLElement).getAttribute('aria-label') !== 'Mensaje de prueba') markDirty();
    }}>
      <div className="card">
        <b>
          Contexto del negocio (system prompt) · <span className="muted">{n} caracteres · ≈{Math.round(n / 4)} tokens en CADA mensaje</span>
        </b>
        {isNew ? (
          <div className="mb6">
            <label className="muted">
              Duplicar de…{' '}
              <select
                defaultValue=""
                aria-label="Duplicar contexto de"
                onChange={(e) => {
                  const src = e.target.value;
                  if (!src) return;
                  void api<TenantDetailResponse>(`/api/admin/tenants/${src}`).then((d) => {
                    set('system_prompt')(d.tenant.system_prompt ?? '');
                  });
                }}
              >
                <option value="">— empezar de cero —</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <textarea rows={14} className="promptbox" value={form.system_prompt} onChange={(e) => set('system_prompt')(e.target.value)} aria-label="Contexto del negocio" />
        {err('system_prompt')}
      </div>
      <div className="card mt12">
        <b>Probar el borrador (no guarda nada)</b>
        <div className="note mt6">
          <input
            placeholder="Mensaje de prueba, p. ej. «hola, ¿tenéis hueco mañana?»"
            className="grow"
            value={testMsg}
            onChange={(e) => setTestMsg(e.target.value)}
            aria-label="Mensaje de prueba"
          />
          <button
            className="btn alt"
            type="button"
            disabled={preview.isPending}
            onClick={() => {
              setReply('Pensando…');
              preview.mutate(
                // Sin cliente guardado, un uuid cualquiera: el endpoint no toca la fila.
                { id: editingId ?? '00000000-0000-4000-8000-000000000001', prompt: form.system_prompt, message: testMsg },
                {
                  onSuccess: (r) => setReply(r.reply),
                  onError: (e) => {
                    setReply('');
                    toast(`Prueba fallida: ${traducir(e)}`, false);
                  },
                },
              );
            }}
          >
            Probar
          </button>
        </div>
        <article className="muted prewrap-out">{reply}</article>
      </div>
      <div className="card mt12">
        <b>Consumo de IA de este cliente</b>
        <p className="muted mt6">
          El <b>saldo mensual</b> es lo que el cliente ve en SU panel, y no corta nada: es un contador. El <b>cupo diario</b>{' '}
          sí corta (429) y existe contra abuso — avisa a Velai al 80%. Vacíos = los valores por defecto del worker.
        </p>
        <p className="muted">
          Ojo: el contexto de arriba viaja en CADA turno, así que un prompt largo consume saldo en cada mensaje.
        </p>
        <div className="actions actions0">
          <label className="muted">
            Saldo mensual (tokens){' '}
            <input type="number" min={10000} step={100000} placeholder="5000000" className="inpill w150" value={form.ai_monthly_tokens} onChange={(e) => set('ai_monthly_tokens')(e.target.value)} aria-label="Saldo mensual de tokens" />
          </label>
          <label className="muted">
            Cupo diario (llamadas){' '}
            <input type="number" min={1} step={50} placeholder="1500" className="inpill w150" value={form.ai_daily_limit} onChange={(e) => set('ai_daily_limit')(e.target.value)} aria-label="Cupo diario de llamadas" />
          </label>
        </div>
        {err('ai_monthly_tokens')}
        {err('ai_daily_limit')}
      </div>
    </section>
  );
}

// ── Marca del widget: lo que ve el visitante, con previsualización en vivo ───
function MarcaPane({
  form,
  set,
  chipsText,
  setChipsText,
  originsText,
  setOriginsText,
  markDirty,
  err,
  editingId,
}: {
  form: Form;
  set: (k: TFKey) => (v: string) => void;
  chipsText: string;
  setChipsText: (v: string) => void;
  originsText: string;
  setOriginsText: (v: string) => void;
  markDirty: () => void;
  err: (f: string) => ReactNode;
  editingId: string | null;
}) {
  const toast = useToast();
  const upload = useLogoUpload();
  const provStep = useProvisionStep();
  const [file, setFile] = useState<File | null>(null);
  const [logoOut, setLogoOut] = useState('');

  return (
    <section onInput={markDirty}>
      <div className="card">
        <b>Marca del widget (chat en la web del cliente)</b>
        <p className="muted mt6">
          Lo que ve el visitante: logo, nombre, saludo, colores. Vacío = marca de Velai (hirevai.com no cambia). Se sirve
          por <code>/widget/boot</code> y se aplica sin deploy (caché 5 min).
        </p>
        <div className="marca">
          <div className="grid">
            <Card label="Nombre del bot">
              <input value={form.bot_name} onChange={(e) => set('bot_name')(e.target.value)} placeholder="Zoe" aria-label="Nombre del bot" />
              {err('bot_name')}
            </Card>
            <Card label="Nombre de marca">
              <input value={form.brand_name} onChange={(e) => set('brand_name')(e.target.value)} placeholder="Zoe Travel Spain" aria-label="Nombre de marca" />
              {err('brand_name')}
            </Card>
            <Card label="Logo del negocio">
              <input value={form.logo_url} onChange={(e) => set('logo_url')(e.target.value)} placeholder="https://… o sube una imagen aquí abajo" aria-label="URL del logo" />
              <div className="note mt6">
                <input type="file" id="tLogoFile" accept="image/png,image/jpeg,image/webp" className="filein" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <label className="btn alt btnsm" htmlFor="tLogoFile">
                  Elegir imagen
                </label>
                <span className="fname muted">{file ? file.name : 'ninguna elegida'}</span>
                <button
                  className="btn btnsm"
                  type="button"
                  disabled={upload.isPending}
                  onClick={() => {
                    if (!file) return setLogoOut('Elige una imagen primero.');
                    if (!editingId) return setLogoOut('Guarda el cliente antes de subir su logo.');
                    if (file.size > 2 * 1024 * 1024) return setLogoOut('Máximo 2 MB.');
                    setLogoOut('subiendo…');
                    upload.mutate(
                      { id: editingId, file, channels: [] },
                      {
                        onSuccess: (d) => {
                          set('logo_url')(d.logo_url);
                          setLogoOut('Subido ✓');
                          toast('Logo guardado');
                        },
                        onError: (e) => setLogoOut(`Error: ${traducir(e)}`),
                      },
                    );
                  }}
                >
                  Guardar logo
                </button>
                <span className="muted">{logoOut}</span>
              </div>
              <small className="muted">
                Se guarda en nuestro almacenamiento y sirve para el widget y para la <b>foto de perfil de WhatsApp</b>.
                Cuadrada, 640×640 o más, máx. 2 MB (PNG/JPG/WebP).
              </small>
              {err('logo_url')}
            </Card>
            <Card label="Colores (#rrggbb · el 2º opcional, degradado)">
              <div className="note mt6">
                <input value={form.brand_color} onChange={(e) => set('brand_color')(e.target.value)} placeholder="#1a4fd0" className="w150" aria-label="Color de marca" />
                <input value={form.brand_color_2} onChange={(e) => set('brand_color_2')(e.target.value)} placeholder="#f57a1f" className="w150" aria-label="Segundo color" />
              </div>
              {err('brand_color')}
              {err('brand_color_2')}
            </Card>
            <Card label="Color de la burbuja del equipo">
              <p className="muted mt6">
                Cuando una persona del equipo responde en el chat, su burbuja se distingue de la del asistente con este
                color. <b>Vacío = el color de marca de arriba</b>.
              </p>
              <div className="note mt6">
                <input value={form.agent_color} onChange={(e) => set('agent_color')(e.target.value)} placeholder="#5b3fa8" className="w150" aria-label="Color de la burbuja del equipo" />
              </div>
              {err('agent_color')}
            </Card>
            <Card label="Saludo (ES)">
              <textarea rows={2} value={form.greeting} onChange={(e) => set('greeting')(e.target.value)} placeholder="¡Hola! Soy Zoe 🐱 ¿A dónde sueñas viajar?" aria-label="Saludo" />
              {err('greeting')}
            </Card>
            <Card label="Saludo (EN, opcional)">
              <textarea rows={2} value={form.greeting_en} onChange={(e) => set('greeting_en')(e.target.value)} aria-label="Saludo en inglés" />
              {err('greeting_en')}
            </Card>
            <Card label="Sugerencias (hasta 3, una por línea)">
              <textarea rows={3} value={chipsText} onChange={(e) => setChipsText(e.target.value)} placeholder={'Vuelos a Colombia\nPaquetes con hotel'} aria-label="Sugerencias" />
              {err('chips_json')}
            </Card>
            <Card label="Placeholder del input">
              <input value={form.placeholder} onChange={(e) => set('placeholder')(e.target.value)} placeholder="Escribe tu mensaje..." aria-label="Placeholder del input" />
              {err('placeholder')}
            </Card>
            <Card label="WhatsApp de contacto (wa.me, solo dígitos)">
              <input value={form.wa_number} onChange={(e) => set('wa_number')(e.target.value)} placeholder="34644280183" aria-label="WhatsApp de contacto" />
              {err('wa_number')}
            </Card>
            <Card label="Tema del chat">
              <select value={form.theme} onChange={(e) => set('theme')(e.target.value)} aria-label="Tema del chat">
                <option value="">auto (según el visitante)</option>
                <option value="light">light</option>
                <option value="dark">dark</option>
              </select>
            </Card>
            <Card label="Dominios de la web (https, uno por línea, máx. 6)">
              <textarea rows={2} value={originsText} onChange={(e) => setOriginsText(e.target.value)} placeholder="https://… (apex y su www, uno por línea)" aria-label="Dominios de la web" />
              <small className="muted">Entran en la allowlist de CORS al Guardar (sin deploy). Después pulsa Sincronizar Turnstile.</small>
              {err('web_origins')}
            </Card>
          </div>
          <aside className="marcaprev">
            <b className="muted">Previsualización</b>
            <BrandPreview form={form} chipsText={chipsText} />
            <div className="actions actions0">
              <button
                className="btn alt"
                type="button"
                disabled={provStep.isPending}
                onClick={() => {
                  if (!editingId) return toast('Guarda primero el cliente: los dominios se leen de D1.', false);
                  provStep.mutate(
                    { id: editingId, step: 'domains' },
                    {
                      onSuccess: () => toast('Hecho ✓ — paso «domains» completado'),
                      onError: (e) => toast(`Paso «domains» fallido: ${traducir(e)}`, false),
                    },
                  );
                }}
              >
                Sincronizar Turnstile
              </button>
            </div>
            <small className="muted">Reescribe los hostnames del widget de Turnstile desde D1 (idempotente: también reconcilia).</small>
          </aside>
        </div>
      </div>
    </section>
  );
}

// Previsualización de la marca: mini-mock del chat con los valores actuales del form.
function BrandPreview({ form, chipsText }: { form: Form; chipsText: string }) {
  const c1 = form.brand_color.trim() || '#FF6B1A';
  const c2 = form.brand_color_2.trim() || c1;
  const bot = form.bot_name.trim() || 'Vai';
  const brand = form.brand_name.trim() || 'Velai';
  const logo = form.logo_url.trim();
  const greet = form.greeting.trim() || `¡Hola! Soy ${bot} 👋 ¿En qué te puedo ayudar?`;
  const chips = linesFrom(chipsText, 3);
  return (
    <div className={`brandprev${form.theme === 'dark' ? ' bp-dark' : ''}`}>
      <div className="bp-h" style={{ background: `linear-gradient(135deg,${c1},${c2})` }}>
        <span className="bp-av" style={{ background: c1 }}>
          {/^https:\/\//i.test(logo) ? <img src={logo} alt="" /> : bot.charAt(0).toUpperCase()}
        </span>
        <span className="bp-n">
          {bot} · {brand}
        </span>
      </div>
      <div className="bp-g">{greet}</div>
      {chips.length ? (
        <div className="bp-c">
          {chips.map((c) => (
            <span key={c} style={{ color: c1 }}>
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Aprovisionamiento Twilio (automático), por pasos ─────────────────────────
function ProvPane({ tenantId, form }: { tenantId: string; form: Form }) {
  const toast = useToast();
  const { data: prov, error } = useProvision(tenantId);
  const step = useProvisionStep();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [raw, setRaw] = useState('');

  // Los campos de la ficha viajan en el guardado, no aquí: el aprovisionamiento lee la
  // fila (por eso cada paso recarga la ficha entera). form solo informa el placeholder.
  void form;

  const lines = useMemo(() => {
    if (!prov) return error ? traducir(error) : '—';
    const out = [
      `Subcuenta: ${prov.subaccount.sid ? `${prov.subaccount.sid}${prov.subaccount.hasToken ? ' · token cifrado ✓' : ' · SIN token'}` : '—'}`,
      `Plantilla: ${prov.template.sid ? `${prov.template.sid} · ${prov.template.status ?? 'manual'}` : '—'}`,
      `Sender: ${prov.sender.sid ? `${prov.sender.sid} · ${prov.sender.status ?? '?'}` : '—'}`,
    ];
    if (prov.warnings.length) out.push(`⚠️ ${prov.warnings.join(' ')}`);
    return out.join('\n');
  }, [prov, error]);

  function provPost(paso: string, body?: unknown) {
    step.mutate(
      { id: tenantId, step: paso, body },
      {
        // Recargar la ficha ENTERA la hace la invalidación del hook (regla §7).
        onSuccess: () => toast(`Hecho ✓ — paso «${paso}» completado`),
        onError: (e) => toast(`Paso «${paso}» fallido: ${traducir(e)}`, false),
      },
    );
  }

  return (
    <section>
      <div className="card">
        <b>Aprovisionamiento Twilio (automático)</b>
        <div className="muted preline">{lines}</div>
        {raw ? <pre className="rawout">{raw}</pre> : null}
        <div className="actions actions0">
          <button className="btn alt" type="button" disabled={step.isPending} onClick={() => provPost('subaccount')}>
            1· Crear o adoptar subcuenta
          </button>
          <button className="btn alt" type="button" disabled={step.isPending} onClick={() => provPost('template')}>
            2· Plantilla → aprobación
          </button>
          <button
            className="btn alt"
            type="button"
            disabled={step.isPending}
            onClick={() => {
              setRaw('Consultando a Twilio…');
              step.mutate(
                { id: tenantId, step: 'template/check' },
                {
                  onSuccess: (r0) => {
                    const r = r0 as { status: string; reason?: string | null; stored: string | null; sid: string | null; applied: boolean; raw: unknown };
                    const out = [
                      `Estado según Twilio: ${r.status}${r.reason ? ` · ${r.reason}` : ''}`,
                      `Estado guardado: ${r.stored ?? '—'}`,
                      `Plantilla: ${r.sid}`,
                    ];
                    if (r.applied) out.push('→ la ficha se ha actualizado con este estado.');
                    if (r.status === 'unknown') out.push('⚠️ Twilio contestó pero SIN el estado donde lo leemos: mira el crudo de abajo, la forma de la respuesta ha cambiado.');
                    setRaw(`${out.join('\n')}\n\n${JSON.stringify(r.raw, null, 1)}`);
                    toast(r.applied ? `Plantilla ${r.status} ✓` : `Twilio dice: ${r.status}`);
                  },
                  onError: (e) => {
                    setRaw(`Fallo al consultar: ${traducir(e)}`);
                    toast(`Comprobación fallida: ${traducir(e)}`, false);
                  },
                },
              );
            }}
          >
            Comprobar plantilla ahora
          </button>
          <button
            className="btn alt"
            type="button"
            disabled={step.isPending}
            onClick={() => {
              setRaw('Reenviando a aprobación…');
              step.mutate(
                { id: tenantId, step: 'template/resubmit' },
                {
                  onSuccess: (r0) => {
                    const r = r0 as { raw: unknown };
                    setRaw(
                      `Reenviada ✓ — Twilio la aceptó otra vez. Comprueba en WhatsApp Manager que ahora SÍ aparece en la WABA;\nsi sigue a 0 plantillas, el problema está entre Twilio y Meta y toca ticket a Twilio.\n\n${JSON.stringify(r.raw, null, 1)}`,
                    );
                    toast('Plantilla reenviada a aprobación ✓');
                  },
                  onError: (e) => {
                    setRaw(`Twilio rechazó el reenvío: ${traducir(e)}`);
                    toast(`Reenvío fallido: ${traducir(e)}`, false);
                  },
                },
              );
            }}
          >
            Reenviar a aprobación
          </button>
          <input placeholder="+34910000000" className="w150" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Teléfono del sender" />
          <button className="btn alt" type="button" disabled={step.isPending} onClick={() => provPost('sender', { phone: phone.trim() })}>
            3· Crear sender
          </button>
          <input placeholder="OTP" className="w80" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Código OTP" />
          <button className="btn alt" type="button" disabled={step.isPending} onClick={() => provPost('sender/verify', { code: code.trim() })}>
            4· Verificar OTP
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Usuarios del panel de ESTE cliente (OTP en admin.hirevai.com) ────────────
function UsersPane({
  tenantId,
  err,
  setFieldErrs,
}: {
  tenantId: string;
  err: (f: string) => ReactNode;
  setFieldErrs: (e: Record<string, string>) => void;
}) {
  const toast = useToast();
  const { data } = useTenantUsers(tenantId);
  const add = useUserAdd();
  const del = useUserDelete();
  const [email, setEmail] = useState('');
  const users = data?.users ?? [];

  return (
    <section>
      <div className="card">
        <b>Usuarios del panel</b>
        <p className="muted mt6">
          Correos con acceso a los leads de ESTE cliente (entran con OTP en admin.hirevai.com). Alta y baja surten efecto
          inmediato.
        </p>
        <div className="mt6">
          {users.length
            ? users.map((u) => (
                <span key={u.email} className="flag off">
                  {u.email}{' '}
                  <a
                    href="#"
                    data-tip="Quitar acceso. Deja de entrar al panel de este cliente."
                    aria-label={`Quitar acceso a ${u.email}`}
                    onClick={(e) => {
                      e.preventDefault();
                      // Quitar al último se permite (a veces es lo que se quiere) pero avisando.
                      if (users.length === 1 && !window.confirm('Es el ÚNICO usuario: este cliente se queda sin acceso al panel. ¿Quitarlo igualmente?')) return;
                      setFieldErrs({});
                      del.mutate(
                        { id: tenantId, email: u.email },
                        {
                          onSuccess: (r) => {
                            if (r.gate === 'pendiente') {
                              toast('Fila borrada, pero la puerta de Access NO se sincronizó: ese correo aún puede autenticarse (el worker le da 403). Revisa Telegram.', false);
                            } else {
                              toast(`Acceso revocado ✓ a ${u.email}${r.gate === 'sincronizado' ? ' — puerta de Access actualizada' : ''}`);
                            }
                          },
                          onError: (e2) => toast(`Acceso NO revocado: ${traducir(e2)}`, false),
                        },
                      );
                    }}
                  >
                    ✕
                  </a>
                </span>
              ))
            : 'Sin usuarios: este cliente no tiene acceso al panel.'}
        </div>
        <div className="actions actions0">
          <input type="email" placeholder="gestora@cliente.com" className="grow inpill" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Correo del usuario" />
          <button
            className="btn alt"
            type="button"
            disabled={add.isPending}
            onClick={() => {
              const v = email.trim();
              if (!v) return;
              setFieldErrs({});
              add.mutate(
                { id: tenantId, email: v },
                {
                  onSuccess: (r) => {
                    setEmail('');
                    if (r.gate === 'sincronizado') toast(`Acceso concedido ✓ a ${v} — puerta de Access actualizada`);
                    else if (r.gate === 'pendiente') toast('Fila guardada, pero la puerta de Access NO se sincronizó (reintenta con otra alta/baja o revisa Telegram)', false);
                    else toast(`Acceso concedido ✓ a ${v} — la puerta de Access se gestiona a mano (sin CF_API_TOKEN)`);
                  },
                  onError: (e2) => {
                    const code = e2 instanceof Error ? e2.message : String(e2);
                    setFieldErrs({ panel_email: traducir(code) });
                    toast(`Acceso NO concedido: ${traducir(code)}`, false);
                  },
                },
              );
            }}
          >
            Añadir
          </button>
        </div>
        {err('panel_email')}
      </div>
    </section>
  );
}

// ── Historial: versiones del contexto y de la config; restaurar crea versión nueva ──
function HistorialPane({ tenantId }: { tenantId: string }) {
  const toast = useToast();
  const { data } = useTenantVersions(tenantId);
  const restore = useVersionRestore();
  const [shown, setShown] = useState<Set<number>>(new Set());
  const versions = data?.versions ?? [];

  return (
    <section>
      <div className="timeline versions">
        {versions.length ? (
          versions.map((v) => (
            <article key={v.id}>
              <b>{v.field}</b> · {v.actor_email} · {new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v.created_at))}
              {v.note ? ` · ${v.note}` : ''}{' '}
              <button
                className="btn alt btnsm"
                type="button"
                onClick={() => setShown((s) => {
                  const n = new Set(s);
                  if (n.has(v.id)) n.delete(v.id);
                  else n.add(v.id);
                  return n;
                })}
              >
                Ver
              </button>
              {v.field === 'system_prompt' && v.previous_value ? (
                <button
                  className="btn alt btnsm"
                  type="button"
                  disabled={restore.isPending}
                  onClick={() => {
                    if (!window.confirm('¿Restaurar esta versión del contexto? Se crea una versión nueva (reversible).')) return;
                    restore.mutate(
                      { id: tenantId, versionId: v.id },
                      {
                        onSuccess: () => toast('Contexto restaurado ✓ (se creó una versión nueva)'),
                        onError: (e) => toast(`NO restaurado: ${traducir(e)}`, false),
                      },
                    );
                  }}
                >
                  Restaurar
                </button>
              ) : null}
              {shown.has(v.id) ? <pre>{v.previous_value ?? '—'}</pre> : null}
            </article>
          ))
        ) : (
          <span className="muted">—</span>
        )}
      </div>
    </section>
  );
}
