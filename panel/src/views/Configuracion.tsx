// Configuración (solo velai): admins de Velai y estado de las integraciones. Dentro,
// lo de integraciones/token/webhook es SOLO para admins raíz — el servidor decide con
// 403 root_only y el panel solo pinta el aviso.
import { useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { traducir } from '../api/errors';
import { useToast } from '../components/Toasts';
import { IcoCloud, IcoDb, IcoKey, IcoLock, IcoShield } from '../components/icons';
import { fmt } from '../lib/format';
import {
  useAdminAdd,
  useAdminDelete,
  useAdmins,
  useCfTokenClear,
  useCfTokenSave,
  useConfig,
  useWebhookCheck,
} from '../hooks/queries';
import type { ConfigInfo, WebhookInfo } from '../api/types';

export function Configuracion() {
  const { data: config, error: configError } = useConfig();
  const rootOnly = configError instanceof ApiError && configError.message === 'root_only';

  // Semáforo global: verde operativo · ámbar requiere atención · rojo error.
  const overall = config ? cfgOverall(config) : null;

  return (
    <div>
      <div className="vhead">
        <div>
          <h1>Configuración</h1>
          <p>Admins de Velai y estado de las integraciones</p>
        </div>
        {overall ? (
          <span className={`stpill ${overall.all ? 'ok' : 'warn'}`}>
            <i />
            {overall.all ? 'Todo operativo' : 'Requiere atención'} · {overall.n} de {overall.total}
          </span>
        ) : null}
      </div>
      <Admins />
      {rootOnly ? (
        <p className="muted mt12">
          El estado de las integraciones y el token de Cloudflare son solo para admins raíz (los de la configuración del
          worker).
        </p>
      ) : null}
      {configError && !rootOnly ? <p className="error mt12">{traducir(configError)}</p> : null}
      {config ? <Integraciones config={config} /> : null}
    </div>
  );
}

function cfgOverall(c: ConfigInfo): { n: number; total: number; all: boolean } {
  const t = c.cf_token;
  const oks = [
    t.source !== 'none' && t.valid === true,
    Boolean(c.account_id),
    Boolean(c.turnstile_sitekey),
    Boolean(c.groups.clientes && c.groups.admins),
    Boolean(c.d1 && c.kv),
  ];
  const n = oks.filter(Boolean).length;
  return { n, total: oks.length, all: n === oks.length };
}

// ── Admins de Velai: alta/baja desde el panel, con la puerta de Access incluida ──
function Admins() {
  const { data, error } = useAdmins();
  const add = useAdminAdd();
  const del = useAdminDelete();
  const toast = useToast();
  const [email, setEmail] = useState('');

  const roots = data ? data.admins.filter((a) => a.root).length : 0;

  return (
    <div className="panelcard">
      <b>
        Admins de Velai (ven TODO)
        <span className="pt-count">
          {data ? `${data.admins.length}${data.admins.length === 1 ? ' admin' : ' admins'} · ${roots}${roots === 1 ? ' raíz' : ' raíces'}` : ''}
        </span>
      </b>
      <p className="muted mt6">
        Entran en admin.hirevai.com con código por correo (One-time PIN). El alta y la baja actualizan también la puerta
        de Cloudflare Access — sin CLI ni dashboard. Los marcados «raíz» viven en la configuración del worker y no se
        pueden quitar desde aquí (a propósito: nada del panel puede dejar a Velai fuera de su propio panel).
      </p>
      <div className="mt6">
        {error ? <span className="muted">{traducir(error)}</span> : null}
        {data
          ? data.admins.map((a) => (
              <span key={a.email} className={`flag ${a.root ? 'ok' : 'off'}`}>
                {a.email}
                {a.root ? (
                  ' · raíz'
                ) : (
                  <a
                    href="#"
                    data-tip="Quitar admin. Pierde el acceso al panel y sale de la puerta de Access."
                    aria-label={`Quitar a ${a.email}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (!window.confirm(`¿Quitar el acceso de ADMIN de ${a.email}?`)) return;
                      del.mutate(a.email, {
                        onSuccess: (r) => {
                          if (r.gate === 'pendiente') {
                            toast(
                              'Fila borrada, pero la puerta de Access NO se sincronizó: ese correo aún puede autenticarse (el worker le da 403). Revisa Telegram.',
                              false,
                            );
                          } else {
                            toast(`Admin quitado ✓${r.gate === 'sincronizado' ? ' — puerta de Access actualizada' : ''}`);
                          }
                        },
                        onError: (e2) => toast(`NO quitado: ${traducir(e2)}`, false),
                      });
                    }}
                  >
                    ✕
                  </a>
                )}
              </span>
            ))
          : '—'}
      </div>
      <div className="actions actions0">
        <input
          type="email"
          placeholder="nuevo-admin@correo.com"
          className="grow inpill"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Correo del nuevo admin"
        />
        <button
          className="btn alt"
          type="button"
          onClick={() => {
            const v = email.trim();
            if (!v) return;
            if (!window.confirm(`Un ADMIN ve TODOS los clientes y TODOS los leads, y puede gestionar usuarios. ¿Dar acceso total a ${v}?`)) return;
            add.mutate(v, {
              onSuccess: (r) => {
                setEmail('');
                if (r.gate === 'sincronizado') toast('Admin añadido ✓ — puerta de Access actualizada, ya puede entrar con OTP');
                else if (r.gate === 'pendiente') toast('Admin guardado, pero la puerta de Access NO se sincronizó (revisa Telegram y reintenta)', false);
                else toast('Admin añadido ✓ — añade su correo a la política «Equipo Velai» en Zero Trust (modo manual)');
              },
              onError: (e2) => toast(`Admin NO añadido: ${traducir(e2)}`, false),
            });
          }}
        >
          Añadir admin
        </button>
      </div>
    </div>
  );
}

// ── Estado de las integraciones (solo raíz) ──────────────────────────────────
function Integraciones({ config }: { config: ConfigInfo }) {
  const t = config.cf_token;
  const tokenState = t.source === 'none' ? 'warn' : t.valid === true ? 'ok' : 'bad';
  const tokenLabel = t.source === 'none' ? 'sin configurar' : t.valid === true ? `válido · ${t.status ?? 'activo'}` : `NO válido ✗ (${t.status ?? '?'})`;
  const acc = String(config.account_id ?? '');

  return (
    <div className="panelcard mt12">
      <b>Estado de las integraciones</b>
      <p className="muted mt6">
        Lo que el worker comprueba al abrir esta vista. La KEK, la API key de Anthropic y las credenciales maestras de
        Twilio no se gestionan aquí a propósito: viven como secrets del worker.
      </p>
      <TokenCard state={tokenState} label={tokenLabel} source={t.source} />
      <div className="cfgtiles">
        <Tile
          icon={<IcoCloud />}
          iconCls="cloud"
          name="Cuenta de Cloudflare"
          pills={<StPill state={acc ? 'ok' : 'warn'} label={acc ? 'conectada' : 'sin CF_ACCOUNT_ID'} />}
          detail={acc ? `cuenta ${acc.slice(0, 4)}…${acc.slice(-4)}` : 'necesaria para sincronizar con Cloudflare'}
        />
        <Tile
          icon={<IcoShield />}
          iconCls="shield"
          name="Turnstile"
          pills={<StPill state={config.turnstile_sitekey ? 'ok' : 'warn'} label={config.turnstile_sitekey ? 'sitekey configurada' : 'sin sitekey'} />}
          detail="protege el widget del chat web"
        />
        <Tile
          icon={<IcoLock />}
          iconCls="lock"
          name="Grupos de Access"
          pills={
            <>
              <StPill state={config.groups.clientes ? 'ok' : 'warn'} label="clientes" />
              <StPill state={config.groups.admins ? 'ok' : 'warn'} label="admins" />
            </>
          }
          detail="las puertas de entrada al panel"
        />
        <Tile
          icon={<IcoDb />}
          iconCls="db"
          name="Bindings del worker"
          pills={
            <>
              <StPill state={config.d1 ? 'ok' : 'bad'} label="D1" />
              <StPill state={config.kv ? 'ok' : 'bad'} label="KV" />
            </>
          }
          detail="leads (D1) y rate limit del chat (KV)"
        />
      </div>
      <Webhook />
      <div className="cfglegend">
        <span>
          <i className="lg-ok" />
          operativo
        </span>
        <span>
          <i className="lg-warn" />
          requiere atención
        </span>
        <span>
          <i className="lg-bad" />
          error
        </span>
      </div>
    </div>
  );
}

function StPill({ state, label }: { state: 'ok' | 'warn' | 'bad'; label: string }) {
  return (
    <span className={`stpill ${state} sm`}>
      <i />
      {label}
    </span>
  );
}

function Tile({ icon, iconCls, name, pills, detail }: { icon: ReactNode; iconCls: string; name: string; pills: ReactNode; detail: string }) {
  return (
    <div className="tile">
      <div className="trow">
        <span className={`tico ${iconCls}`}>{icon}</span>
        <span className="tname">{name}</span>
      </div>
      <div className="trow">{pills}</div>
      <span className="tdetail">{detail}</span>
    </div>
  );
}

// El token de API de Cloudflare: write-only — se valida contra Cloudflare ANTES de
// guardarse, se cifra con la KEK y nunca se vuelve a mostrar.
function TokenCard({ state, label, source }: { state: 'ok' | 'warn' | 'bad'; label: string; source: ConfigInfo['cf_token']['source'] }) {
  const toast = useToast();
  const save = useCfTokenSave();
  const clear = useCfTokenClear();
  const [token, setToken] = useState('');
  return (
    <div className={`cfgtoken ${state}`}>
      <div className="cfg-h">
        <span className="tico key">
          <IcoKey />
        </span>
        <span className="cfg-t">
          <span className="cfg-name">Token de API de Cloudflare</span>
          <span className="cfg-desc">
            Firma las sincronizaciones de Turnstile y las puertas de Access. Write-only: se valida contra Cloudflare
            ANTES de guardarse, se cifra con la KEK y nunca se vuelve a mostrar.
          </span>
        </span>
        <span className="chip">origen: {source === 'none' ? '—' : source === 'panel' ? 'panel · cifrado en D1' : 'secret del worker'}</span>
        <span className={`stpill ${state}`}>
          <i />
          {label}
        </span>
      </div>
      <div className="cfg-rot">
        <input
          type="password"
          autoComplete="new-password"
          placeholder="nuevo token de API de Cloudflare"
          className="inpill"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          aria-label="Nuevo token de API de Cloudflare"
        />
        <button
          className="btn alt"
          type="button"
          onClick={() => {
            const v = token.trim();
            if (!v) return;
            if (!window.confirm('El token se validará contra Cloudflare y pasará a usarse para TODAS las sincronizaciones (Turnstile y puertas de Access). ¿Continuar?')) return;
            save.mutate(v, {
              onSuccess: (r) => {
                setToken('');
                toast(`Token validado y guardado ✓ (${r.status}) — origen: panel`);
              },
              onError: (e) => toast(`Token NO guardado: ${traducir(e)}`, false),
            });
          }}
        >
          Validar y guardar
        </button>
        <button
          className="btn alt"
          type="button"
          onClick={() => {
            if (!window.confirm('¿Retirar el token del panel y volver al secret del worker?')) return;
            clear.mutate(undefined, {
              onSuccess: (r) =>
                toast(
                  `Hecho ✓ — origen: ${r.source === 'worker' ? 'secret del worker' : 'SIN token: las sincronizaciones quedan en manual'}`,
                  r.source === 'worker',
                ),
              onError: (e) => toast(`No se pudo: ${traducir(e)}`, false),
            });
          }}
        >
          Volver al secret del worker
        </button>
      </div>
    </div>
  );
}

// ── Diagnóstico del webhook de Telegram (solo lectura, bajo demanda) ─────────
// Es la forma de mirar sin romper: getUpdates NO se puede usar con un webhook activo
// (Telegram responde 409), y desactivarlo dejaría a todos los clientes sin poder vincular.
function Webhook() {
  const check = useWebhookCheck();
  const [out, setOut] = useState<WebhookInfo | null>(null);
  const [msg, setMsg] = useState<string>('—');
  return (
    <div className="cfgwh">
      <div className="cfg-h">
        <b>Webhook de Telegram</b>
        <button
          className="btn alt btnsm"
          type="button"
          disabled={check.isPending}
          onClick={() => {
            setOut(null);
            setMsg('preguntando a Telegram…');
            check.mutate(undefined, {
              onSuccess: setOut,
              onError: (e) => setMsg(`No se pudo comprobar: ${traducir(e)}`),
            });
          }}
        >
          Comprobar
        </button>
      </div>
      <p className="muted mt6">
        Solo lectura: pregunta a Telegram cómo tiene registrado el webhook del bot de Velai y qué falló en la última
        entrega. No cambia nada. Es la forma de mirar sin romper: <code>getUpdates</code> NO se puede usar con un webhook
        activo (Telegram responde 409), y desactivarlo dejaría a todos los clientes sin poder vincular.
      </p>
      <div className="mt6">
        {!out ? (
          <span className="muted">{msg}</span>
        ) : !out.configured ? (
          <span className="whbad">El worker no tiene TELEGRAM_TOKEN: no hay bot que consultar.</span>
        ) : out.error ? (
          <span className="whbad">Telegram no respondió: {out.error}</span>
        ) : (
          <>
            <WhRow k="URL" v={out.url ?? 'sin registrar'} cls={out.url ? (out.coincide ? 'whok' : 'whbad') : 'whbad'} />
            {/* Un webhook apuntando a otro sitio es un webhook «activo» que no nos
                entrega nada, y desde fuera se ve igual que uno sano: por eso se compara. */}
            {out.url && !out.coincide ? <WhRow k="Debería ser" v={out.esperada ?? ''} cls="whbad" /> : null}
            <WhRow
              k="En cola"
              v={`${out.pendientes ?? 0}${(out.pendientes ?? 0) > 0 ? ' — se están acumulando' : ''}`}
              cls={(out.pendientes ?? 0) > 0 ? 'whbad' : 'whok'}
            />
            {out.ultimoError ? (
              <WhRow k="Último error" v={`${out.ultimoError.mensaje}${out.ultimoError.cuando ? ` (${fmt(out.ultimoError.cuando)})` : ''}`} cls="whbad" />
            ) : (
              <WhRow k="Último error" v="ninguno" cls="whok" />
            )}
            {out.ip ? <WhRow k="IP de Telegram" v={out.ip} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function WhRow({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="whrow">
      <b>{k}</b>
      <span className={cls}>{v}</span>
    </div>
  );
}
