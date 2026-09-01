// Conexiones (SPEC-CONEXIONES): por dónde llegan las conversaciones y quién recibe
// cada aviso. El cliente abre SU tarjeta; Velai elige tenant con el selector de la
// cabecera. Tira de estado de canales arriba y dos columnas que fluyen por su cuenta.
import { useEffect, useMemo, useRef, useState } from 'react';
import { confirmar, pedirTexto } from '../components/Confirmar';
import { traducir } from '../api/errors';
import { ChIcon } from '../components/icons';
import { IcoPen, IcoTick, IcoX } from '../components/icons';
import { HoursGrid } from '../components/HoursGrid';
import { useToast } from '../components/Toasts';
import { cxTiles } from '../lib/canales';
import { fmt } from '../lib/format';
import { gridFromHours, hoursFromGrid, copyMonday, shSummary, type Grid, gridVacio } from '../lib/horario';
import { WIZ_FIN, wizState, type WizId } from '../lib/telegram';
import { logoEstado, waEstado } from '../lib/whatsapp';
import {
  useLogoApply,
  useLogoUpload,
  useMe,
  useNotifyPatch,
  useReportTest,
  useSenderProfile,
  useSenderSync,
  useTelegramBotDelete,
  useTelegramBotSave,
  useTelegramLink,
  useTelegramSetup,
  useTelegramUnlink,
  useTelegramWhitelabel,
  useTenantChannels,
  useTenantHours,
  useTenantTelegram,
  useTenantWhatsapp,
  useTenants,
  useTopicAdd,
  useTopicDelete,
  useTopicPatch,
} from '../hooks/queries';
import type { ConvChannel, TelegramInfo, TelegramLinkResponse, WhatsappInfoResponse } from '../api/types';

export function Conexiones() {
  const { data: me } = useMe();
  const isVelai = me?.role === 'velai';
  const isCliente = me?.role === 'cliente';
  const { data: tenants } = useTenants(isVelai === true);
  const [selected, setSelected] = useState<string | null>(null);

  const tenantId = isCliente
    ? me?.tenantId ?? null
    : selected ?? (tenants ? (tenants.tenants.find((t) => t.slug === 'velai') ?? tenants.tenants[0])?.id ?? null : null);

  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Conexiones</h1>
          <p>Por dónde llegan tus conversaciones y quién recibe cada aviso</p>
        </div>
        {isVelai ? (
          <div className="actions actions0">
            <span className="sel">
              <select value={tenantId ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label="Cliente de las conexiones">
                {(tenants?.tenants ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </span>
          </div>
        ) : null}
      </div>
      {tenantId ? <ConexionesBody key={tenantId} tenantId={tenantId} isVelai={isVelai === true} isCliente={isCliente === true} /> : null}
    </div>
  );
}

function ConexionesBody({ tenantId, isVelai, isCliente }: { tenantId: string; isVelai: boolean; isCliente: boolean }) {
  const { data: channels, error: chError } = useTenantChannels(tenantId);
  const { data: tg, error: tgError } = useTenantTelegram(tenantId);
  const { data: wa, error: waError } = useTenantWhatsapp(tenantId);
  const tiles = useMemo(() => cxTiles(channels?.channels ?? []), [channels]);

  return (
    <>
      {/* Tus canales: el worker ya colapsó los estados según el rol; aquí solo se les
          pone palabras. */}
      <div className="cxtiles">
        {chError ? (
          <div className="cxtile is-off">
            <span className="cxtm">
              <span className="cxta">{traducir(chError)}</span>
            </span>
          </div>
        ) : (
          tiles.map((t) => (
            <div key={t.kind} className={`cxtile${t.off ? ' is-off' : ''}`}>
              <span className="cxti">
                <ChIcon ch={t.kind as ConvChannel} />
              </span>
              <span className="cxtm">
                <span className="cxtn">{t.label}</span>
                <span className="cxta">{t.address}</span>
                <span className={`cxts ${t.stateCls}`}>
                  <i />
                  {t.stateLabel}
                </span>
              </span>
            </div>
          ))
        )}
      </div>
      <div className="cxcols">
        <div className="cxcol">
          {tgError ? (
            <div className="cxbox">
              <span className="cxtitle">Recibe tus leads en Telegram</span>
              <p className="cxsub">{traducir(tgError)}</p>
            </div>
          ) : tg ? (
            <TelegramWizard tenantId={tenantId} isVelai={isVelai} info={tg.telegram} />
          ) : null}
          <HorarioBox tenantId={tenantId} isCliente={isCliente} />
        </div>
        <div className="cxcol">
          <AvisosBox tenantId={tenantId} isVelai={isVelai} wa={wa} waError={waError} />
          {tg ? <InformeBox tenantId={tenantId} info={tg.telegram} /> : null}
          <LogoBox tenantId={tenantId} wa={wa} isCliente={isCliente} />
          <WhatsappBox tenantId={tenantId} isVelai={isVelai} wa={wa} waError={waError} />
        </div>
      </div>
      {isVelai ? <WebhookSetupBox /> : null}
    </>
  );
}

// ── Asistente de Telegram: riel de progreso clicable + una tarjeta por paso ──
// El estado real del servidor (bot, vínculo, temas) marca los pasos hechos; los pasos
// sin señal del servidor (grupo, permisos) se confirman con su botón (en memoria).
function TelegramWizard({ tenantId, isVelai, info }: { tenantId: string; isVelai: boolean; info: TelegramInfo }) {
  const toast = useToast();
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [requested, setRequested] = useState<string | null>(null);
  const [link, setLink] = useState<TelegramLinkResponse | null>(null);
  const [botToken, setBotToken] = useState('');
  const [topicName, setTopicName] = useState('');
  const [topicDesc, setTopicDesc] = useState('');

  const wl = useTelegramWhitelabel();
  const botSave = useTelegramBotSave();
  const botDel = useTelegramBotDelete();
  const mkLink = useTelegramLink();
  const unlink = useTelegramUnlink();
  const topicAdd = useTopicAdd();
  const topicPatch = useTopicPatch();
  const topicDel = useTopicDelete();

  const wiz = wizState(info, manual, requested);
  const goto = (id: WizId | null) => setRequested(id);
  // «confirmarPaso», no «confirm»: sombreaba a window.confirm y en la revisión de los
  // diálogos nativos hubo que pararse a distinguirla. Un nombre que no pisa globales.
  const confirmarPaso = (paso: string) => {
    setManual((m) => ({ ...m, [paso]: true }));
    setRequested(null);
  };

  return (
    <div className="cxbox">
      <div className="cxbh">
        <span className="grow">
          <span className="cxtitle">Recibe tus leads en Telegram</span>
          <p className="cxsub">Una sola vez, 5–10 minutos. El asistente detecta lo que ya está hecho y guarda tu avance.</p>
        </span>
        {isVelai ? (
          <span className="cxrow">
            <span className={`flag ${info.whitelabel ? 'ok' : 'off'}`}>{info.whitelabel ? 'activada' : 'desactivada'}</span>{' '}
            <button
              className="btn alt btnsm"
              type="button"
              disabled={wl.isPending}
              onClick={async () => {
                const enable = !info.whitelabel;
                if (!enable && !(await confirmar({ titulo: '¿Desactivar la marca blanca?', cuerpo: 'Si el cliente tiene bot propio, se retira y se desvincula su chat. Los avisos volverán a salir por el bot de Velai cuando se vuelva a vincular.', accion: 'Desactivar', peligro: true }))) return;
                wl.mutate(
                  { id: tenantId, enable },
                  {
                    onSuccess: () => {
                      toast(enable ? 'Marca blanca activada ✓ — el cliente ya ve el paso de bot propio' : 'Marca blanca desactivada');
                      setRequested('tgs1');
                    },
                    onError: (e) => toast(`No se pudo cambiar: ${traducir(e)}`, false),
                  },
                );
              }}
            >
              {info.whitelabel ? 'Desactivar' : 'Activar'}
            </button>
          </span>
        ) : null}
        <span className="tgchip">{wiz.progress}</span>
      </div>
      <div className="tgrail">
        {wiz.nodes.map((n, i) => (
          <span key={n.id} style={{ display: 'contents' }}>
            {i > 0 ? <i className={`tgbar${wiz.nodes[i - 1]?.done ? ' done' : ''}`} /> : null}
            <button className={`tgnode${n.done ? ' done' : ''}${n.current ? ' cur' : ''}`} type="button" onClick={() => goto(n.id)}>
              <span className="tgnum">{n.done ? <IcoTick /> : n.num}</span>
              <span className="tgnlbl">{n.label}</span>
            </button>
          </span>
        ))}
      </div>
      <div className="tgpanel">
        {wiz.open === 'tgs1' ? (
          <div className="tgstep">
            <div className="tgbody">
              <div className="tgh2">Crea el bot de tu negocio</div>
              <p className="tgsub">Así los avisos llegarán firmados por tu marca (p. ej. @MiNegocioBot).</p>
              <div className="tgcards">
                <div className="tgcard">
                  <b>1 · Abre @BotFather</b>
                  <p>
                    En Telegram, busca <b>@BotFather</b> — el que tiene la insignia azul de verificado.
                  </p>
                </div>
                <div className="tgcard">
                  <b>2 · Escríbele /newbot</b>
                  <p>
                    Te pedirá un nombre visible («Mi Negocio Avisos») y un usuario que termine en <b>bot</b>.
                  </p>
                </div>
                <div className="tgcard">
                  <b>3 · Copia el token</b>
                  <p>BotFather te dará una línea larga de números y letras: pégala aquí abajo.</p>
                </div>
              </div>
              <div className="muted mt6">
                {info.botUsername ? (
                  <span className="flag ok">Bot del negocio: @{info.botUsername} ✓</span>
                ) : (
                  <span className="flag off">Aún sin bot propio (se usa el bot de Velai)</span>
                )}
              </div>
              <div className="actions actions0">
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="pega aquí el token de @BotFather"
                  className="grow inpill"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  aria-label="Token de BotFather"
                />
                <button
                  className="btn"
                  type="button"
                  disabled={botSave.isPending}
                  onClick={() => {
                    const token = botToken.trim();
                    if (!token) return toast('Pega primero el token de @BotFather', false);
                    botSave.mutate(
                      { id: tenantId, token },
                      {
                        onSuccess: (d) => {
                          setBotToken('');
                          setRequested(null);
                          toast(`Bot propio guardado ✓ (@${d.botUsername}). Ahora vincula el chat: el bot NUEVO es el que debe entrar al grupo.`);
                        },
                        onError: (e) => toast(`No se pudo guardar el bot: ${traducir(e)}${e instanceof Error && 'why' in e && (e as { why?: string }).why ? ` — ${(e as { why?: string }).why}` : ''}`, false),
                      },
                    );
                  }}
                >
                  Guardar bot
                </button>
                {info.botUsername ? (
                  <button
                    className="btn alt"
                    type="button"
                    disabled={botDel.isPending}
                    onClick={async () => {
                      if (!(await confirmar({ titulo: '¿Quitar el bot propio?', cuerpo: 'Se desvincula el chat y los avisos volverán a salir por el bot de Velai cuando se vuelva a vincular.', accion: 'Quitar bot', peligro: true }))) return;
                      botDel.mutate(
                        { id: tenantId },
                        {
                          onSuccess: () => {
                            setRequested('tgs1');
                            toast('Bot propio retirado');
                          },
                          onError: (e) => toast(`No se pudo quitar: ${traducir(e)}`, false),
                        },
                      );
                    }}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            </div>
            <div className="tgnav">
              <span />
              <button className="btn alt" type="button" onClick={() => confirmarPaso('1')}>
                Prefiero usar el bot de Velai →
              </button>
            </div>
          </div>
        ) : null}
        {wiz.open === 'tgs2' ? (
          <div className="tgstep">
            <div className="tgbody">
              <div className="tgh2">Crea el grupo de tu equipo</div>
              <p className="tgsub">Ahí llegarán los avisos, para ti y para quien tú añadas.</p>
              <div className="tgcards">
                <div className="tgcard">
                  <b>1 · Nuevo grupo</b>
                  <p>
                    En Telegram: menú → <b>Nuevo grupo</b>.
                  </p>
                </div>
                <div className="tgcard">
                  <b>2 · Tu equipo</b>
                  <p>Añade a quien deba ver los leads (puedes añadir más luego).</p>
                </div>
                <div className="tgcard">
                  <b>3 · Nombre claro</b>
                  <p>
                    P. ej. <b>«Mi Negocio · Leads»</b>.
                  </p>
                </div>
              </div>
            </div>
            <div className="tgnav">
              <button className="btn alt" type="button" onClick={() => goto('tgs1')}>
                ← Anterior
              </button>
              <button className="btn" type="button" onClick={() => confirmarPaso('2')}>
                Ya tengo el grupo →
              </button>
            </div>
          </div>
        ) : null}
        {wiz.open === 'tgs3' ? (
          <div className="tgstep">
            <div className="tgbody">
              <div className="tgh2">Conecta el grupo con Vai</div>
              <p className="tgsub">Un toque desde el móvil y el bot queda dentro de tu grupo.</p>
              <div className="muted mt6">
                {info.linked ? (
                  <>
                    <span className="flag ok">Conectado{info.title ? `: ${info.title}` : ''}</span>
                    {info.linked_at ? <span className="muted"> desde {fmt(info.linked_at)}</span> : null}
                  </>
                ) : (
                  'Aún sin conectar: genera el enlace y ábrelo desde el móvil.'
                )}
              </div>
              <div className="actions actions0">
                <button
                  className="btn"
                  type="button"
                  disabled={mkLink.isPending}
                  onClick={() =>
                    mkLink.mutate(
                      { id: tenantId },
                      {
                        onSuccess: (d) => {
                          setLink(d);
                          setRequested('tgs3');
                        },
                        onError: (e) => toast(`No se pudo generar el enlace: ${traducir(e)}`, false),
                      },
                    )
                  }
                >
                  {info.linked ? 'Vincular otro chat' : 'Generar enlace de conexión'}
                </button>
                {info.linked ? (
                  <button
                    className="btn alt"
                    type="button"
                    disabled={unlink.isPending}
                    onClick={async () => {
                      if (!(await confirmar({ titulo: '¿Desvincular el Telegram?', cuerpo: 'Los avisos de leads dejarán de llegar a ese chat hasta que se vuelva a vincular.', accion: 'Desvincular', peligro: true }))) return;
                      unlink.mutate(
                        { id: tenantId },
                        {
                          onSuccess: () => {
                            setRequested(null);
                            toast('Telegram desvinculado');
                          },
                          onError: (e) => toast(`No se pudo desvincular: ${traducir(e)}`, false),
                        },
                      );
                    }}
                  >
                    Desconectar
                  </button>
                ) : null}
              </div>
              {link ? (
                <div className="mt6">
                  <p className="mb6">
                    <b>Abre este enlace desde el móvil</b> donde tienes Telegram:{' '}
                    <a href={link.groupUrl} target="_blank" rel="noopener noreferrer">
                      <b>conectar mi grupo</b>
                    </a>{' '}
                    → elige el grupo del paso anterior. En el grupo aparecerá la confirmación «✅ Listo…» y este paso
                    avanzará solo al recargar.
                  </p>
                  <p className="muted mb6">
                    ¿No llega la confirmación? Escribe dentro del grupo: <code>/start {link.token}</code> · ¿Prefieres un
                    chat directo contigo?{' '}
                    <a href={link.dmUrl} target="_blank" rel="noopener noreferrer">
                      usa este enlace
                    </a>
                    . Caduca en 15 minutos.
                  </p>
                </div>
              ) : null}
            </div>
            <div className="tgnav">
              <button className="btn alt" type="button" onClick={() => goto('tgs2')}>
                ← Anterior
              </button>
              <span />
            </div>
          </div>
        ) : null}
        {wiz.open === 'tgs4' ? (
          <div className="tgstep">
            <div className="tgbody">
              <div className="tgh2">Activa los «Temas» y dale permiso al bot</div>
              <p className="tgsub">Los Temas son las pestañas del grupo donde llegarán tus leads clasificados.</p>
              <div className="tgcards two">
                <div className="tgcard">
                  <b>1 · Activa los Temas</b>
                  <p>
                    Abre el grupo → toca su <b>nombre</b> (arriba) → <b>Editar</b> → interruptor <b>«Temas»</b>.
                  </p>
                </div>
                <div className="tgcard">
                  <b>2 · Bot administrador</b>
                  <p>
                    <b>Administradores</b> → añade el bot (el del paso 1, o el de Velai) → activa <b>«Gestionar temas»</b> →
                    guarda.
                  </p>
                </div>
              </div>
              <p className="muted mt6">Si al crear un tema falta algo, te lo diremos con palabras claras.</p>
            </div>
            <div className="tgnav">
              <button className="btn alt" type="button" onClick={() => goto('tgs3')}>
                ← Anterior
              </button>
              <button className="btn" type="button" onClick={() => confirmarPaso('4')}>
                Ya lo activé →
              </button>
            </div>
          </div>
        ) : null}
        {wiz.open === 'tgs5' ? (
          <div className="tgstep">
            <div className="tgbody">
              <div className="tgh2">Crea los temas para clasificar tus leads</div>
              <p className="tgsub">
                La <b>descripción</b> es lo que Vai usa para decidir qué lead va a cada tema. Lo que no encaje irá al
                chat General.
              </p>
              <div className="actions actions0">
                <input
                  placeholder="Nombre, p. ej. Presupuestos"
                  className="inpill"
                  value={topicName}
                  onChange={(e) => setTopicName(e.target.value)}
                  aria-label="Nombre del tema"
                />
                <input
                  placeholder="Descripción, p. ej. clientes que piden precio o cotización"
                  className="grow inpill"
                  value={topicDesc}
                  onChange={(e) => setTopicDesc(e.target.value)}
                  aria-label="Descripción del tema"
                />
                <button
                  className="btn"
                  type="button"
                  disabled={topicAdd.isPending}
                  onClick={() => {
                    const name = topicName.trim();
                    if (!name) return toast('Ponle nombre al tema', false);
                    topicAdd.mutate(
                      { id: tenantId, name, description: topicDesc.trim() },
                      {
                        onSuccess: () => {
                          setTopicName('');
                          setTopicDesc('');
                          setRequested('tgs5');
                          toast('Tema creado en el grupo de Telegram ✓');
                        },
                        onError: (e) => toast(`No se pudo crear el tema: ${traducir(e)}`, false),
                      },
                    );
                  }}
                >
                  Crear tema
                </button>
              </div>
              <div className="mt6">
                {info.topics.length ? (
                  <div className="cxtopics">
                    {info.topics.map((tp) => (
                      <div key={tp.thread_id} className="cxtrow">
                        <span className="cxtn2">{tp.name}</span>
                        <span className="cxtd">{tp.description || 'sin descripción'}</span>
                        <button
                          className="cxibtn"
                          type="button"
                          data-tip="Editar la descripción. Es lo que Vai usa para decidir qué lead va a este tema."
                          aria-label={`Editar la descripción de ${tp.name}`}
                          onClick={async () => {
                            // Cancelar es NO TOCAR NADA. Con el prompt nativo, cancelar
                            // colaba una descripción vacía y borraba la que hubiera.
                            const description = await pedirTexto({
                              titulo: `Descripción de «${tp.name}»`,
                              cuerpo: 'Es lo que Vai usa para decidir qué lead va a este tema. Vacía = el tema deja de describirse.',
                              placeholder: 'p. ej. clientes que piden precio o cotización',
                              inicial: tp.description ?? '',
                              accion: 'Guardar',
                            });
                            if (description === null) return;
                            topicPatch.mutate(
                              { id: tenantId, threadId: tp.thread_id, description },
                              {
                                onSuccess: () => toast('Descripción guardada ✓'),
                                onError: (e) => toast(`No se pudo guardar: ${traducir(e)}`, false),
                              },
                            );
                          }}
                        >
                          <IcoPen />
                        </button>
                        <button
                          className="cxibtn del"
                          type="button"
                          data-tip="Quitar del enrutado. El tema sigue en Telegram; solo deja de recibir leads."
                          aria-label={`Quitar ${tp.name} del enrutado`}
                          onClick={async () => {
                            if (!(await confirmar({ titulo: `¿Quitar «${tp.name}» del enrutado?`, cuerpo: 'El tema sigue existiendo en Telegram, pero los leads dejarán de clasificarse hacia él.', accion: 'Quitar del enrutado', peligro: true }))) return;
                            topicDel.mutate(
                              { id: tenantId, threadId: tp.thread_id },
                              {
                                onSuccess: () => toast('Tema quitado del enrutado'),
                                onError: (e) => toast(`No se pudo quitar: ${traducir(e)}`, false),
                              },
                            );
                          }}
                        >
                          <IcoX />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Aún no hay temas: crea el primero arriba.</p>
                )}
              </div>
            </div>
            <div className="tgnav">
              <button className="btn alt" type="button" onClick={() => goto('tgs4')}>
                ← Anterior
              </button>
              <button className="btn" type="button" onClick={() => setRequested(WIZ_FIN)}>
                Terminar →
              </button>
            </div>
          </div>
        ) : null}
        {wiz.open === WIZ_FIN ? (
          <div className="tgstep tgfin">
            <div className="tgbody tgfinbody">
              <span className="tgfinico">
                <IcoTick />
              </span>
              <div className="tgh2 mt6">Todo listo</div>
              <p className="tgsub">{wiz.finMsg}</p>
              {info.whitelabel ? (
                <div className="actions actions0">
                  <button className="btn alt btnsm" type="button" onClick={() => goto('tgs5')}>
                    Añadir o editar temas
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Horario de atención humana: Vai atiende 24/7; esto solo decide cuándo puede pasar
// una conversación a una persona del equipo. ─────────────────────────────────
const TZS: [string, string][] = [
  ['Europe/Madrid', 'España peninsular (Europe/Madrid)'],
  ['Atlantic/Canary', 'Canarias (Atlantic/Canary)'],
  ['America/Bogota', 'Colombia (America/Bogota)'],
  ['America/Mexico_City', 'México (America/Mexico_City)'],
  ['America/Argentina/Buenos_Aires', 'Argentina (America/Argentina/Buenos_Aires)'],
  ['America/Santiago', 'Chile (America/Santiago)'],
];

function HorarioBox({ tenantId, isCliente }: { tenantId: string; isCliente: boolean }) {
  const toast = useToast();
  const { data: av } = useTenantHours(tenantId, isCliente);
  const save = useNotifyPatch();
  const [grid, setGrid] = useState<Grid>(gridVacio);
  const [tz, setTz] = useState('Europe/Madrid');
  const [out, setOut] = useState('');
  const loadedRef = useRef<string | null>(null);

  // El horario se lee de /availability (ya devuelve el que está en vigor, con el
  // default aplicado). Se repuebla solo al llegar datos nuevos del servidor.
  useEffect(() => {
    if (!av) return;
    const key = JSON.stringify([av.hours, av.tz]);
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    setGrid(gridFromHours(av.hours));
    setTz(av.tz || 'Europe/Madrid');
    setOut(shSummary(av.hours));
  }, [av]);

  return (
    <div className="cxbox">
      <div className="cxbh">
        <span className="grow">
          <span className="cxtitle">Horario de atención humana</span>
          <p className="cxsub">
            Vai atiende <b>24 horas al día, todos los días</b>. Esto solo decide cuándo puede pasar una conversación a
            una persona de tu equipo.
          </p>
        </span>
        <span className="sel">
          <select value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Zona horaria del horario">
            {TZS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="cxshh">
        <span className="hd cxmicro">Día</span>
        <span className="ht cxmicro">Tramo 1</span>
        <span className="ht cxmicro">Tramo 2</span>
      </div>
      <HoursGrid grid={grid} onChange={setGrid} variant="toggles" idPrefix="sh" />
      <div className="cxrow">
        <button
          className="btn"
          type="button"
          disabled={save.isPending}
          onClick={() => {
            const hours = hoursFromGrid(grid);
            save.mutate(
              { id: tenantId, body: { support_hours: JSON.stringify(hours), support_tz: tz } },
              {
                onSuccess: () => {
                  setOut(shSummary(hours));
                  toast('Horario guardado ✓');
                },
                onError: (e) => toast(`Horario NO guardado: ${traducir(e)}`, false),
              },
            );
          }}
        >
          Guardar horario
        </button>
        <button
          className="btn alt btnsm"
          type="button"
          onClick={() => {
            setGrid(copyMonday(grid));
            setOut('Copiado — recuerda Guardar.');
          }}
        >
          Copiar el lunes a L-V
        </button>
        <span className="muted">{out}</span>
      </div>
    </div>
  );
}

// ── ¿Quién recibe los avisos? Un lead siempre se guarda en el panel; esto es quién
// recibe ADEMÁS un aviso al momento. ─────────────────────────────────────────
const AL: Record<string, [string, string]> = {
  on: ['flag ok', 'recibe avisos'],
  pending_template: ['flag', 'WhatsApp está aprobando la plantilla'],
  off: ['flag off', 'sin configurar'],
};

function AvisosBox({
  tenantId,
  isVelai,
  wa,
  waError,
}: {
  tenantId: string;
  isVelai: boolean;
  wa: WhatsappInfoResponse | undefined;
  waError: unknown;
}) {
  const toast = useToast();
  const save = useNotifyPatch();
  const [team, setTeam] = useState('');
  const [waNum, setWaNum] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!wa || loadedRef.current) return;
    loadedRef.current = true;
    setTeam(wa.whatsapp.team_whatsapp ?? '');
    setWaNum(wa.whatsapp.wa_number ?? '');
  }, [wa]);

  const alerts = wa?.alerts ?? null;
  return (
    <div className="cxbox">
      <span className="cxtitle">¿Quién recibe los avisos?</span>
      <p className="cxsub">Un lead siempre se guarda en el panel. Esto es quién recibe además un aviso al momento.</p>
      <div className="cxarows">
        {waError ? <p className="cxsub">{traducir(waError)}</p> : null}
        {alerts
          ? (['telegram', 'whatsapp'] as const).map((k) => {
              const s = AL[alerts[k]] ?? AL['off']!;
              return (
                <div key={k} className="cxarow">
                  <span className="cxti">
                    <ChIcon ch={k} />
                  </span>
                  <span className="cxan">{k === 'telegram' ? 'Telegram' : 'WhatsApp'}</span>
                  <span className={s[0]}>{s[1]}</span>
                </div>
              );
            })
          : null}
        {alerts && !alerts.any ? (
          <p className="as-ctx mt6">
            Ahora mismo <b>nadie recibe un aviso</b> cuando entra un lead: se guardan aquí en el panel, pero hay que
            entrar a mirarlos. Conecta tu Telegram arriba y los tendrás al momento — es lo único que no depende de que
            WhatsApp apruebe nada.
          </p>
        ) : null}
      </div>
      <div className="cxhr" />
      <span className="cxmicro">Números de aviso por WhatsApp</span>
      <p className="cxsub">
        Varios separados por coma, en formato <code>whatsapp:+34…</code>
      </p>
      <div className="cxrow">
        <input
          className="inpill grow"
          placeholder="whatsapp:+34600111222,whatsapp:+34600333444"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          aria-label="Números de aviso del equipo"
        />
        {isVelai ? (
          <input className="inpill w150" placeholder="nº de errores" value={waNum} onChange={(e) => setWaNum(e.target.value)} aria-label="Número de errores" />
        ) : null}
        <button
          className="btn alt btnsm"
          type="button"
          disabled={save.isPending}
          onClick={() => {
            setFieldErr('');
            save.mutate(
              { id: tenantId, body: { team_whatsapp: team.trim(), wa_number: waNum.trim() } },
              {
                onSuccess: () => toast('Números de aviso guardados ✓'),
                onError: (e) => {
                  setFieldErr(traducir(e));
                  toast(`No se pudo guardar: ${traducir(e)}`, false);
                },
              },
            );
          }}
        >
          Guardar
        </button>
      </div>
      <small className="muted field-err">{fieldErr}</small>
    </div>
  );
}

// ── Informe semanal: cada lunes, un resumen en el grupo de Telegram ──────────
const WR_ST: Record<string, string> = { sent: 'entregado', skipped: 'no enviado', failed: 'falló', sending: 'en curso' };

function InformeBox({ tenantId, info }: { tenantId: string; info: TelegramInfo }) {
  const toast = useToast();
  const patch = useNotifyPatch();
  const test = useReportTest();
  const on = info.weeklyReport;
  return (
    <div className="cxbox">
      <div className="cxbh">
        <span className="grow">
          <span className="cxtitle">Informe semanal</span>
          <p className="cxsub">
            Cada lunes por la mañana, un resumen de la semana en tu grupo de Telegram: conversaciones, leads, citas y las
            preguntas que Vai no supo contestar.
          </p>
        </span>
        <button
          className={`sw${on ? ' on' : ''}`}
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Informe semanal"
          disabled={patch.isPending}
          onClick={() =>
            patch.mutate(
              { id: tenantId, body: { weekly_report: !on } },
              {
                onSuccess: () => toast(!on ? 'Informe semanal activado ✓ (llega el lunes)' : 'Informe semanal desactivado ✓'),
                onError: (e) => toast(`No se pudo cambiar el informe: ${traducir(e)}`, false),
              },
            )
          }
        >
          <i />
        </button>
      </div>
      <div className="cxrow">
        <span className={`flag ${on ? 'ok' : 'off'}`}>{on ? 'activado' : 'desactivado'}</span>
        {info.linked ? (
          <button
            className="btn alt btnsm"
            type="button"
            disabled={test.isPending}
            onClick={() =>
              test.mutate(
                { id: tenantId },
                {
                  onSuccess: () => toast('Prueba enviada ✓ — míralo en tu grupo de Telegram'),
                  onError: (e) => toast(`La prueba NO salió: ${traducir(e)}`, false),
                },
              )
            }
          >
            Enviar una prueba ahora
          </button>
        ) : null}
      </div>
      {!info.linked ? <small className="muted">Vincula primero el grupo de Telegram: es por donde llega el informe.</small> : null}
      {/* «¿Salió el informe?» se responde aquí y no abriendo Telegram. */}
      <small className="muted">
        {info.lastReport
          ? `Último informe (semana del ${info.lastReport.period_start}): ${WR_ST[info.lastReport.status] ?? info.lastReport.status}${info.lastReport.detail ? ` — ${info.lastReport.detail}` : ''}`
          : info.linked
            ? 'Todavía no se ha enviado ninguno: el primero sale el lunes por la mañana.'
            : ''}
      </small>
    </div>
  );
}

// ── Tu logo: una imagen para el chat web y/o la foto de WhatsApp ─────────────
function LogoBox({ tenantId, wa, isCliente }: { tenantId: string; wa: WhatsappInfoResponse | undefined; isCliente: boolean }) {
  const toast = useToast();
  const upload = useLogoUpload();
  const apply = useLogoApply();
  const [file, setFile] = useState<File | null>(null);
  const [chWeb, setChWeb] = useState(true);
  const [chWa, setChWa] = useState(true);
  const [msg, setMsg] = useState('');

  const w = wa?.whatsapp;
  const logoWeb = w?.logo_url ?? null;
  const logoWa = w?.logo_wa_url ?? w?.logo_url ?? null;
  const estado = w ? logoEstado(w.logo_url, Boolean(w.sender_status), wa?.profileSync ?? null, traducir, fmt) : null;

  // isCliente entra en el mensaje de subida (brandLogo del sidebar lo refresca la
  // invalidación de /me… que aquí no aplica: el logo del shell se lee al recargar).
  void isCliente;

  return (
    <div className="cxbox">
      <span className="cxtitle">Tu logo</span>
      <p className="cxsub">
        WhatsApp la recorta en círculo y pide 640×640, así que a veces conviene una distinta de la del chat web. Máximo 2
        MB (PNG, JPG o WebP).
      </p>
      <div className="cxlogos">
        <div className="cxlogot">
          <span className="cxlogo" data-tip="El logo que sale en la burbuja del chat de tu web.">
            {logoWeb && /^https:\/\//i.test(logoWeb) ? <img src={logoWeb} alt="" /> : 'web'}
          </span>
          <span className="lb">Chat de tu web</span>
        </div>
        <div className="cxlogot">
          <span className="cxlogo" data-tip={'La foto de perfil que ven los clientes en WhatsApp.\nWhatsApp la recorta en círculo y pide 640×640.'}>
            {logoWa && /^https:\/\//i.test(logoWa) ? <img src={logoWa} alt="" /> : 'wa'}
          </span>
          <span className="lb">Tu WhatsApp</span>
        </div>
      </div>
      <div className="cxrow">
        <label className="chk2">
          <input type="checkbox" checked={chWeb} onChange={(e) => setChWeb(e.target.checked)} /> Chat de mi web
        </label>
        <label className="chk2">
          <input type="checkbox" checked={chWa} onChange={(e) => setChWa(e.target.checked)} /> Mi WhatsApp
        </label>
      </div>
      <div className="cxrow">
        <input
          type="file"
          id="cxLogoFile"
          accept="image/png,image/jpeg,image/webp"
          className="filein"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <label className="btn alt btnsm" htmlFor="cxLogoFile">
          Elegir imagen
        </label>
        <span className="fname muted">{file ? file.name : 'ninguna elegida'}</span>
        <button
          className="btn btnsm"
          type="button"
          disabled={upload.isPending}
          onClick={() => {
            if (!file) return setMsg('Elige una imagen primero.');
            if (file.size > 2 * 1024 * 1024) return setMsg('La imagen no puede pasar de 2 MB.');
            const channels = [...(chWeb ? ['web'] : []), ...(chWa ? ['whatsapp'] : [])];
            if (!channels.length) return setMsg('Marca al menos un canal.');
            setMsg('subiendo…');
            upload.mutate(
              { id: tenantId, file, channels },
              {
                onSuccess: (d) => {
                  setMsg(
                    `Listo ✓ ${d.canales.web ? 'Ya se ve en el chat de tu web' : 'Guardada para WhatsApp'}${d.whatsapp ? ' y en tu WhatsApp (puede tardar unos minutos en actualizarse).' : '.'}`,
                  );
                  toast('Logo actualizado');
                },
                onError: (e) => setMsg(`Error: ${traducir(e)}`),
              },
            );
          }}
        >
          Guardar logo
        </button>
        {estado?.applyVisible ? (
          <button
            className="btn alt btnsm"
            type="button"
            disabled={apply.isPending}
            onClick={() => {
              setMsg('aplicando a WhatsApp…');
              apply.mutate(
                { id: tenantId },
                {
                  onSuccess: () => {
                    setMsg('Aplicada a tu WhatsApp ✓ (puede tardar unos minutos en verse)');
                    toast('Foto aplicada a WhatsApp');
                  },
                  onError: (e) =>
                    setMsg(`No se pudo aplicar: ${traducir(e)}${e instanceof Error && 'why' in e && (e as { why?: string }).why ? ` — ${(e as { why?: string }).why}` : ''}`),
                },
              );
            }}
          >
            Aplicar a mi WhatsApp
          </button>
        ) : null}
      </div>
      <small className="muted">{msg || estado?.texto || ''}</small>
    </div>
  );
}

// ── WhatsApp del negocio: estado en lenguaje de negocio, nunca jerga de Twilio ──
function WhatsappBox({
  tenantId,
  isVelai,
  wa,
  waError,
}: {
  tenantId: string;
  isVelai: boolean;
  wa: WhatsappInfoResponse | undefined;
  waError: unknown;
}) {
  const toast = useToast();
  const sync = useSenderSync();
  const profile = useSenderProfile();
  const [out, setOut] = useState('');

  const estado = wa ? waEstado(wa.whatsapp, wa.alerts) : null;

  return (
    <div className="cxbox">
      <span className="cxtitle">WhatsApp del negocio</span>
      <p className="cxsub">La conexión inicial la hacemos juntos en una sesión corta — te avisaremos.</p>
      <div className="cxrow muted">
        {waError ? (
          traducir(waError)
        ) : estado ? (
          <>
            {estado.kind === 'sin_conectar' ? (
              'Sin conectar todavía. La conexión la hacemos juntos en una sesión corta — te avisaremos para agendarla.'
            ) : estado.kind === 'alta_sin_enrutar' ? (
              <>
                <span className="flag off">Tu número está dado de alta pero aún no recibe mensajes</span>{' '}
                <span className="muted">· lo dejamos atendido en unos minutos; no hace falta que hagas nada</span>
              </>
            ) : estado.kind === 'activo' ? (
              <>
                <span className="flag ok">Activo</span>
                {estado.sub === 'telegram_fallback' ? (
                  <span className="muted"> · mientras WhatsApp aprueba la plantilla, los avisos de leads te llegan por Telegram</span>
                ) : estado.sub === 'aprobando' ? (
                  <span className="muted"> · WhatsApp aún está aprobando la plantilla de avisos</span>
                ) : null}
              </>
            ) : estado.kind === 'verificando' ? (
              <span className="flag">Verificando tu número con WhatsApp…</span>
            ) : (
              <span className="flag off">Revisando un problema con tu número.</span>
            )}
            {estado.from ? <span className="muted"> · {estado.from}</span> : null}
          </>
        ) : (
          '—'
        )}
      </div>
      {isVelai ? (
        <>
          <div className="cxrow">
            <button
              className="btn alt btnsm"
              type="button"
              disabled={sync.isPending}
              onClick={() => {
                setOut('sincronizando…');
                sync.mutate(
                  { id: tenantId },
                  {
                    onSuccess: (d) => {
                      let texto = `Sincronizado ✓ · ${d.applied} campos${d.webhookFixed ? ' · webhook reparado' : ''}`;
                      if (!d.webhookOk) texto += ' · ⚠ WEBHOOK MAL: los mensajes NO llegan al worker';
                      if (d.conflicts.length) texto += ` · conflictos: ${d.conflicts.map((c) => `${c.field} (fila ${c.current} / Twilio ${c.fromTwilio})`).join('; ')}`;
                      setOut(texto);
                    },
                    onError: (e) => setOut(`Error: ${traducir(e)}`),
                  },
                );
              }}
            >
              Sincronizar desde Twilio
            </button>
            <button
              className="btn alt btnsm"
              type="button"
              disabled={profile.isPending}
              onClick={() => {
                setOut('aplicando marca…');
                profile.mutate(
                  { id: tenantId },
                  {
                    onSuccess: (d) => {
                      setOut(`Perfil actualizado ✓${d.applied.logo ? ' · con foto' : ' · SIN foto (sube el logo en la ficha)'}${d.applied.websites ? ' · con web' : ''}`);
                      toast('Perfil de WhatsApp actualizado');
                    },
                    onError: (e) => setOut(`Error: ${traducir(e)}`),
                  },
                );
              }}
            >
              Aplicar marca al perfil
            </button>
            <span className="muted">{out}</span>
          </div>
          <small className="muted">
            «Aplicar marca al perfil» manda el logo, la descripción y la web de la ficha a WhatsApp: es la foto que ve el
            cliente final. El nombre visible NO se toca (cambiarlo exige revisión de Meta).
          </small>
        </>
      ) : null}
    </div>
  );
}

// ── Webhook del bot (solo Velai, y una sola vez por bot) ─────────────────────
function WebhookSetupBox() {
  const setup = useTelegramSetup();
  const [out, setOut] = useState('');
  return (
    <div className="cxbox quiet mt12">
      <div className="cxbh">
        <span className="grow">
          <span className="cxtitle">Webhook del bot</span>
          <p className="cxsub">Solo Velai, y una sola vez por bot. Con el webhook activo, getUpdates deja de funcionar para ese bot.</p>
        </span>
        <button
          className="btn alt btnsm"
          type="button"
          disabled={setup.isPending}
          onClick={() =>
            setup.mutate(undefined, {
              onSuccess: (d) => setOut(`Webhook registrado ✓ (bot @${d.botUsername ?? '?'})`),
              onError: (e) => setOut(`Error: ${traducir(e)}`),
            })
          }
        >
          Registrar webhook
        </button>
      </div>
      <small className="muted">{out}</small>
    </div>
  );
}
