// Panel admin — rediseño 2026-08 (aprobado en el canvas «Panel Velai — Rediseño»):
// navegación lateral, ficha de cliente con pestañas y UN solo Guardar, alta guiada
// por pasos (el borrador queda como prospecto sin enrutar hasta activarlo).
// Reglas que NO se rompen (§7 de la spec): token write-only, provPost recarga la
// ficha entera, nada sensible en el DOM, sin recursos externos salvo las fuentes
// de hirevai.com, y los mismos id/TERRS que traducen los códigos del worker.
// El JS del panel vive en admin-panel.js como función real (validable por
// node --check y ejecutable en tests); aquí solo se serializa al HTML como IIFE
// — (fn)() y no por nombre, para ser inmune a renombrados del bundler.
// OJO (incidente 2026-08-20): wrangler bundlea con keepNames y esbuild inyecta
// llamadas a su helper __name(fn,...) DENTRO del cuerpo de panelApp — el helper
// vive en la cabecera del bundle y no viaja con toString(), así que el script
// del panel define un shim de __name ANTES de la IIFE. Cualquier cambio aquí
// debe pasar scripts/check-bundle.mjs (lo corre el workflow de deploy contra
// el bundle real): es lo único que reproduce lo que ejecuta el navegador.
import { panelApp } from './admin-panel.js';

export const ADMIN_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Panel · Velai</title>
<style nonce="__NONCE__">
@font-face{font-family:'Cabinet Grotesk';src:url('https://hirevai.com/fonts/cabinet-grotesk-900.woff2?v=2') format('woff2');font-weight:900;font-display:swap}
@font-face{font-family:'Satoshi';src:url('https://hirevai.com/fonts/satoshi-400.woff2?v=2') format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:'Satoshi';src:url('https://hirevai.com/fonts/satoshi-500.woff2?v=2') format('woff2');font-weight:500;font-display:swap}
:root{color-scheme:dark;
--ink:255,248,244;
--orange:#FF6B1A;--orange2:#FF8C40;--amber:#FFAA00;
--bg:#09070A;--bg2:#110D13;--bg3:#0C0A0E;--side:#0D0A10;--surface:#181220;
--border:rgba(255,107,26,.10);--border2:rgba(var(--ink),.14);--line:rgba(var(--ink),.06);
--white:#FFF8F4;--muted:rgba(var(--ink),.62);--muted2:rgba(var(--ink),.48);
--font-d:'Cabinet Grotesk',system-ui,sans-serif;--font-b:'Satoshi',system-ui,sans-serif;
--r:16px;--r-sm:10px;
--ok:#199e70;--bad:#e66767;
--st-new:#3987e5;--st-contacted:#c98500;--st-qualified:#9085e9;--st-won:#199e70;--st-lost:#e66767;--st-spam:#8b8b95;
--stt-new:#9cc4ee;--stt-contacted:#ecc27c;--stt-qualified:#c3bdf5;--stt-won:#7fd7b2;--stt-lost:#f2a4a4;--stt-spam:#b9b9c2;--amber-t:#ffce7a;--chip-t:#FF8C40}
/* ── Tema de las VISTAS (canvas «Panel Velai — Tema claro», 2026-08-20): CLARO por
   defecto; body.dark las devuelve al oscuro original. La barra lateral NO entra en
   el ámbito y conserva siempre los tokens oscuros de :root — por eso ningún selector
   cambia: solo se redefinen los tokens dentro de main, los dialogs y los toasts. */
main,dialog,#toasts{color-scheme:light;--ink:39,30,25;
--bg:#F7F3EF;--bg2:#FFFDFB;--bg3:#F1EBE5;--surface:#F3EDE7;
--border:rgba(255,107,26,.18);--border2:rgba(39,30,25,.16);--line:rgba(39,30,25,.09);
--white:#271E19;--muted:rgba(39,30,25,.62);--muted2:rgba(39,30,25,.60);
--stt-new:#2a6dbd;--stt-contacted:#a06a00;--stt-qualified:#6a5fd0;--stt-won:#12805a;--stt-lost:#c04444;--stt-spam:#6d6d78;--amber-t:#8a5a00;--chip-t:#b84e08}
body.dark main,body.dark dialog,body.dark #toasts{color-scheme:dark;--ink:255,248,244;
--bg:#09070A;--bg2:#110D13;--bg3:#0C0A0E;--surface:#181220;
--border:rgba(255,107,26,.10);--border2:rgba(255,248,244,.14);--line:rgba(255,248,244,.06);
--white:#FFF8F4;--muted:rgba(255,248,244,.62);--muted2:rgba(255,248,244,.48);
--stt-new:#9cc4ee;--stt-contacted:#ecc27c;--stt-qualified:#c3bdf5;--stt-won:#7fd7b2;--stt-lost:#f2a4a4;--stt-spam:#b9b9c2;--amber-t:#ffce7a;--chip-t:var(--orange2)}
*{box-sizing:border-box}
body{margin:0;display:flex;min-height:100vh;background:var(--bg);color:var(--white);font:14px/1.5 var(--font-b)}
main::before{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(var(--ink),.04) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--ink),.04) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 40%,transparent 100%);mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 40%,transparent 100%)}
button,input,select,textarea{font:inherit;color:var(--white)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--orange);outline-offset:2px}
/* ── Barra lateral ── */
.side{position:sticky;top:0;height:100vh;width:230px;flex-shrink:0;display:flex;flex-direction:column;background:var(--side);border-right:1px solid var(--border);padding:24px 14px 16px;z-index:20}
.brand{display:flex;align-items:center;gap:9px;font-family:var(--font-d);font-weight:900;font-size:19px;letter-spacing:-.02em;padding:0 10px}
.brand i{width:9px;height:9px;border-radius:50%;background:var(--orange);box-shadow:0 0 10px rgba(255,107,26,.7)}
.brand small{font-family:var(--font-b);font-weight:500;font-size:10.5px;letter-spacing:.18em;color:var(--muted);text-transform:uppercase;margin-top:3px}
/* Con el logo del cliente cargado, el punto naranja y la palabra Velai dejan paso a su
   marca: el panel es SUYO (pedido de Juan, 2026-08-24). Velai sigue firmando en el pie. */
.brand.haslogo i,.brand.haslogo .bname,.brand.haslogo small{display:none}
.brand.haslogo{gap:10px;padding:0 6px}
.brand .blogo{display:none}
.brand.haslogo .blogo{display:flex;align-items:center;gap:9px;min-width:0}
.brand .blogo img{width:34px;height:34px;border-radius:9px;object-fit:cover;flex:none;background:rgba(255,255,255,.06)}
.brand .blogo b{font-family:var(--font-b);font-weight:600;font-size:12.5px;line-height:1.25;letter-spacing:.01em;color:var(--white);text-transform:none;white-space:normal;overflow:hidden}
/* Pie de página fijo y delgado: la firma de Velai siempre visible sin robar espacio. */
/* OJO: --ink/--card SOLO existen dentro de main/dialog/#toasts (ver nota de tokens
   arriba). El pie vive FUERA de main, así que usa los tokens de :root — los mismos del
   sidebar — y de paso cumple la regla de que el marco del panel va oscuro siempre. */
.foot{position:fixed;left:230px;right:0;bottom:0;height:30px;display:flex;align-items:center;justify-content:center;gap:6px;font-family:var(--font-b);font-size:11px;letter-spacing:.02em;color:var(--muted);background:var(--side);border-top:1px solid var(--border);z-index:15}
.foot b{font-weight:700;color:var(--white)}
main{padding-bottom:74px}
@media(max-width:900px){.foot{left:0}}
.sep{height:1px;background:var(--line);margin:18px 4px}
.navlabel{font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:rgba(var(--ink),.42);padding:6px 12px 8px}
.tabs{display:flex;flex-direction:column;gap:3px}
.tab{display:flex;align-items:center;gap:11px;border:0;background:none;border-radius:var(--r-sm);padding:10px 12px;color:var(--muted);cursor:pointer;font-weight:500;font-size:14px;text-align:left}
.tab svg{width:18px;height:18px;flex-shrink:0}
.tab:hover{color:var(--white);background:rgba(var(--ink),.04)}
.tab.is-on{background:rgba(255,107,26,.12);color:var(--orange2);font-weight:700}
.spacer{flex:1}
.sidefoot{border-top:1px solid var(--line);padding-top:10px}
.sidefoot .tab{width:100%}
/* ── Botones ── */
.btn{border:0;border-radius:var(--r-sm);padding:10px 17px;background:var(--orange);color:#fff;cursor:pointer;font-weight:700;transition:background .15s ease;box-shadow:0 4px 18px rgba(255,107,26,.22)}
.btn:hover{background:var(--orange2)}
.btn.alt{background:var(--bg2);border:1px solid var(--border2);color:var(--white);font-weight:500;box-shadow:none}
.btn.alt:hover{border-color:var(--orange);color:var(--orange2)}
.btn.bad{background:#5d2626;border:1px solid rgba(230,103,103,.4);box-shadow:none;color:#fff}
/* ── Contenido ── */
main{flex:1;min-width:0;position:relative;padding:30px clamp(20px,3vw,42px) 60px;background:var(--bg);color:var(--white)}
/* Ningún contenido puede empujar la página a lo ancho: las tablas ya scrollean dentro
   de .table, y las URLs largas (logo, direcciones de canal) parten en vez de estirar la
   tarjeta — el scroll horizontal de toda la vista era eso (Conexiones, 2026-08-24). */
main{overflow-x:clip}
.card,.grid,.actions,.tgw-top,.tgpanel{min-width:0}
.card small,.card code,.tgsub,.chaddr,#cxLogoOut,#waSyncOut,#tgSetupOut{overflow-wrap:anywhere}
.vhead{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 22px}
.vhead h1{margin:0;font-family:var(--font-d);font-weight:900;font-size:27px;letter-spacing:-.02em}
.vhead p{margin:6px 0 0;color:var(--muted);font-size:13.5px}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:16px}
.stat{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:20px 22px}
.stat b{display:block;font-size:11px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.stat .n{font-family:var(--font-d);font-weight:900;font-size:36px;line-height:1;letter-spacing:-.02em}
.stat small{display:block;margin-top:7px;color:var(--muted2);font-size:11.5px}
.stat.alerta{border-color:rgba(230,103,103,.45);background:linear-gradient(180deg,rgba(230,103,103,.10),var(--bg2))}
.stat.alerta .n{color:var(--bad)}
.chartcard{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px 22px 12px;display:flex;flex-direction:column;margin-bottom:22px}
.chartcard b{font-size:11px;font-weight:500;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
#chart{height:74px;display:flex;align-items:flex-end;gap:5px;margin-top:12px}
#chart .bar{flex:1;min-height:2px;background:linear-gradient(180deg,var(--orange2),var(--orange));opacity:.65;border-radius:4px 4px 0 0;transition:opacity .12s}
/* La gráfica de gasto reutiliza el mismo componente de barras del dashboard: mismo
   lenguaje visual, cero código nuevo de dibujo. */
#aiChart{height:64px;display:flex;align-items:flex-end;gap:4px}
#aiChart .bar{flex:1;min-height:2px;background:linear-gradient(180deg,var(--orange2),var(--orange));opacity:.55;border-radius:4px 4px 0 0}
#aiChart .bar:hover{opacity:.95}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
/* Barra horizontal etiquetada: mismo lenguaje que la tabla de gasto (.share). */
.brow{display:grid;grid-template-columns:minmax(96px,auto) 1fr auto;align-items:center;gap:10px;padding:5px 0;font-size:12.5px}
.brow .bt{height:7px;border-radius:4px;background:rgba(var(--ink),.07);overflow:hidden}
.brow .bt i{display:block;height:100%;background:var(--orange);opacity:.8;border-radius:4px}
.brow .bv{color:var(--muted);white-space:nowrap}
.brow.warn .bt i{background:#e0a021}
.brow.bad .bt i{background:#d64545}
.aihead{display:flex;align-items:center;justify-content:space-between;gap:12px}
table.tnarrow{min-width:0}
.share{display:inline-flex;align-items:center;gap:8px;min-width:120px}
.share i{height:6px;border-radius:3px;background:var(--orange);opacity:.75;display:block}
#chart .bar:hover{opacity:1}
.chartlabels{display:flex;justify-content:space-between;color:var(--muted2);font-size:11px;margin-top:6px}
/* ── Filtros ── */
.filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:16px}
.filters input,.note textarea{background:var(--bg2);color:var(--white);border:1px solid rgba(var(--ink),.10);border-radius:var(--r-sm);padding:10px 13px;font-size:13px}
.filters input:hover{border-color:var(--orange)}
.filters input[name=source]{max-width:120px}
.filters input[type=date]{color:rgba(var(--ink),.80)}
.filters .fchk{display:inline-flex;align-items:center;gap:7px;font-size:13px;cursor:pointer}
/* Rejilla de horario: una fila por día, dos tramos (la jornada partida es la norma aquí). */
.shgrid{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.shrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.shday{min-width:88px;font-weight:600;font-size:13px}
.shpair{display:inline-flex;align-items:center;gap:6px}
.shsep{color:var(--muted2);font-size:12px}
.shrow input[type=time]{background:var(--bg2);color:var(--white);border:1px solid var(--border2);border-radius:var(--r-sm);padding:7px 9px;font-size:13px}
@media(max-width:700px){.shday{min-width:100%}}
.search{flex:1;min-width:220px;max-width:340px;display:flex;align-items:center;gap:9px;background:var(--bg2);border:1px solid rgba(var(--ink),.10);border-radius:var(--r-sm);padding:0 13px}
.search:hover,.search:focus-within{border-color:var(--orange)}
.search svg{width:15px;height:15px;color:rgba(var(--ink),.40);flex-shrink:0}
.search input.q{flex:1;background:none;border:0;padding:10px 0;min-width:0}
.search input.q:focus-visible{outline:none}
.sel{position:relative;display:inline-flex}
.sel select{appearance:none;-webkit-appearance:none;background:var(--bg2);color:rgba(var(--ink),.80);border:1px solid rgba(var(--ink),.10);border-radius:var(--r-sm);padding:10px 32px 10px 13px;font-size:13px;cursor:pointer}
.sel:hover select{border-color:var(--orange)}
.sel::after{content:'';position:absolute;right:13px;top:50%;width:7px;height:7px;border-right:1.5px solid rgba(var(--ink),.45);border-bottom:1.5px solid rgba(var(--ink),.45);transform:translateY(-70%) rotate(45deg);pointer-events:none}
#resultCount,#chCount{margin-left:auto;color:var(--muted);font-size:12.5px;white-space:nowrap}
/* ── Tablas ── */
.table{border:1px solid var(--border);border-radius:var(--r);overflow:auto;background:var(--bg2)}
table{width:100%;border-collapse:collapse;min-width:960px}
th{position:sticky;top:0;background:var(--bg2);z-index:5;color:rgba(var(--ink),.50);font-size:11px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;box-shadow:inset 0 0 0 999px rgba(var(--ink),.02)}
th,td{padding:15px 16px;text-align:left;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
td.tel{font-variant-numeric:tabular-nums}
tr[data-id],tr[data-tid]{cursor:pointer}
tr[data-id]:hover,tr[data-tid]:hover{background:rgba(255,107,26,.05)}
.pill{display:inline-flex;align-items:center;gap:7px;background:rgba(var(--ink),.03);border:1px solid rgba(var(--ink),.08);border-radius:999px;padding:4px 11px;font-size:12px;font-weight:500;white-space:nowrap}
.pill b{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.s-new b{background:var(--st-new)}.s-new{color:var(--stt-new)}
.s-contacted b{background:var(--st-contacted)}.s-contacted{color:var(--stt-contacted)}
.s-qualified b{background:var(--st-qualified)}.s-qualified{color:var(--stt-qualified)}
.s-won b{background:var(--st-won)}.s-won{color:var(--stt-won)}
.s-lost b{background:var(--st-lost)}.s-lost{color:var(--stt-lost)}
.s-spam b{background:var(--st-spam)}.s-spam{color:var(--stt-spam)}
.tenant{display:inline-flex;align-items:center;gap:9px;white-space:nowrap}
.tenant i{width:4px;height:20px;border-radius:3px;flex-shrink:0}
.nb{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);margin-right:8px;white-space:nowrap}
.nb i{width:7px;height:7px;border-radius:50%}
.nb.ok i{background:var(--ok)}.nb.wait i{background:var(--amber)}.nb.bad i{background:var(--bad)}
.flag{display:inline-block;border-radius:7px;padding:3px 9px;font-size:11.5px;margin:1px 4px 1px 0;background:rgba(255,170,0,.10);color:var(--amber-t);border:1px solid rgba(255,170,0,.22)}
.flag.ok{background:rgba(25,158,112,.10);color:var(--stt-won);border-color:rgba(25,158,112,.25)}
.flag.off{background:rgba(var(--ink),.05);color:var(--muted);border-color:rgba(var(--ink),.10)}
.flag.web{background:rgba(57,135,229,.10);color:var(--stt-new);border-color:rgba(57,135,229,.25)}
.flag a{color:inherit;text-decoration:none;margin-left:4px;font-weight:700}
.flag a:hover{color:var(--bad)}
.meter{display:inline-block;width:64px;height:5px;background:rgba(var(--ink),.08);border-radius:3px;overflow:hidden;vertical-align:middle;margin-right:8px}
.meter i{display:block;height:100%;background:linear-gradient(90deg,var(--orange),var(--orange2));border-radius:3px}
/* Rol cliente: la interfaz oculta lo que no le aplica, pero la DEFENSA es del worker
   (cada endpoint valida el scope por su cuenta — SPEC-HANDOFF §B.3.5). */
body.cliente .velai-only{display:none}
/* El inverso: cosas que SOLO ve el cliente. El saldo de IA es para él — Velai tiene la
   tarjeta de coste en dólares, que jamás debe salir del panel de Velai. */
.cliente-only{display:none}body.cliente .cliente-only{display:block}
.saldo{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:6px}
.saldo .n{font-family:var(--font-d);font-weight:900;font-size:30px;letter-spacing:-.02em}
.saldo .of{color:var(--muted)}
.bigbar{height:12px;border-radius:999px;background:var(--line);overflow:hidden;margin-top:12px}
.bigbar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--orange),var(--orange2))}
.bigbar.hot i{background:linear-gradient(90deg,var(--amber),var(--bad))}
body.cliente #tenantFilter,body.cliente #mTenantsCard{display:none}
body.cliente th:nth-child(2),body.cliente td:nth-child(2){display:none}
#escalations{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
#escalations:empty{display:none}
.esc{display:inline-flex;align-items:center;gap:8px;background:rgba(255,170,0,.1);border:1px solid rgba(255,170,0,.3);border-radius:999px;padding:5px 6px 5px 12px;font-size:12.5px;color:var(--amber-t)}
.esc button{border:0;border-radius:999px;background:var(--bg2);color:var(--white);padding:3px 10px;cursor:pointer;font-size:11.5px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:14px 4px 0;color:var(--muted);font-size:12px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend i{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.muted{color:var(--muted)}.error{color:var(--bad)}
.pager{text-align:center;margin:18px}
.empty{text-align:center;padding:36px;color:var(--muted)}
/* ── Modales ── */
dialog{width:min(820px,calc(100% - 24px));max-height:92vh;overflow:auto;background:var(--bg2);color:var(--white);border:1px solid var(--border2);border-radius:var(--r);padding:0}
dialog#tenantModal{width:min(1120px,calc(100% - 24px))}
dialog::backdrop{background:rgba(5,3,6,.78);backdrop-filter:blur(3px)}
.modal-top{position:sticky;top:0;z-index:5;background:var(--bg2)}
.modal-h{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid var(--line)}
#detail .modal-h{position:sticky;top:0;z-index:5;background:var(--bg2)}
.modal-top .modal-h{border-bottom:0}
.modal-h strong{font-family:var(--font-d);font-weight:900;font-size:18px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mh-r{display:flex;gap:10px;align-items:center;flex:1;justify-content:flex-end;min-width:0}
#tNote{width:min(320px,38vw)}
.modal-b{padding:20px 22px}
/* Pestañas de la ficha: un solo Guardar arriba; el punto ámbar marca pestañas con cambios sin guardar */
.ttabs{display:flex;flex-wrap:wrap;padding:0 22px;border-bottom:1px solid rgba(var(--ink),.08)}
.ttab{display:inline-flex;align-items:center;gap:7px;border:0;background:none;cursor:pointer;padding:11px 2px;margin-right:22px;color:var(--muted);font-size:13.5px;font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px}
.ttab.is-on{color:var(--orange2);font-weight:700;border-bottom-color:var(--orange)}
.ttab .dot{display:none;width:6px;height:6px;border-radius:50%;background:var(--amber)}
.ttab.dirty .dot{display:inline-block}
.wizbar{display:flex;align-items:center;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
#wizHint{flex:1;font-size:12px}
/* Stepper del alta: círculos numerados con conector; hecho = check naranja tenue, activo = naranja pleno */
.wizsteps{display:flex;align-items:center;padding:14px 22px;border-bottom:1px solid rgba(var(--ink),.08);overflow-x:auto}
.wstep{display:inline-flex;align-items:center;gap:9px;white-space:nowrap}
.wdot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;background:rgba(var(--ink),.05);color:rgba(var(--ink),.5);border:1px solid rgba(var(--ink),.10)}
.wdot svg{width:12px;height:12px}
.wstep.on .wdot{background:var(--orange);color:#fff;border-color:var(--orange);box-shadow:0 0 14px rgba(255,107,26,.4)}
.wstep.done .wdot{background:rgba(255,107,26,.16);color:var(--orange2);border-color:rgba(255,107,26,.4)}
.wlab{font-size:13px;font-weight:600;color:rgba(var(--ink),.5)}
.wstep.on .wlab{color:var(--white)}
.wstep.done .wlab{color:rgba(var(--ink),.75)}
.wline{flex:1;height:1px;background:rgba(var(--ink),.08);margin:0 14px;min-width:18px}
.wline.past{background:rgba(255,107,26,.35)}
/* Marca del widget: campos a la izquierda, previsualización fija en columna derecha */
.marca{display:flex;gap:24px;align-items:flex-start;margin-top:10px}
.marca .grid{flex:1;min-width:0;grid-template-columns:repeat(2,minmax(0,1fr))}
.marcaprev{width:320px;flex-shrink:0;position:sticky;top:118px}
@media(max-width:1000px){.marca{flex-direction:column}.marcaprev{width:100%;position:static}}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.card.cardwide{grid-column:1/-1}
.rawout{margin:10px 0 0;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;font-size:12px;line-height:1.45;color:var(--muted);white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
.asunto{border-left:3px solid var(--orange)}
.asunto .as-need{margin:2px 0 0;font-size:15px;line-height:1.4}
.asunto .as-ctx{margin:5px 0 0;color:var(--muted);font-size:13px;line-height:1.45}
.chlist{display:grid;gap:6px;margin:8px 0 2px}
.chrow{display:flex;align-items:center;gap:10px;padding:8px 11px;background:var(--bg3);border:1px solid var(--border);border-radius:8px}
.chrow i{width:8px;height:8px;border-radius:50%;background:rgba(var(--ink),.20);flex-shrink:0}
.chrow i.on{background:var(--ok)}
.chrow i.bad{background:var(--bad)}
.chrow .chk{min-width:92px;font-weight:600}
.chrow .chaddr{color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:560px){.chrow{flex-wrap:wrap;gap:6px}.chrow .chaddr{flex-basis:100%}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:calc(var(--r) - 4px);padding:14px 16px}
.card b{display:block;color:var(--muted);font-size:11px;font-weight:500;letter-spacing:.07em;text-transform:uppercase;margin-bottom:5px}
/* …pero ese es el estilo del TÍTULO de la tarjeta, y se aplicaba a cualquier <b> anidado:
   un énfasis dentro de un párrafo salía en mayúsculas y como bloque, partiendo la frase en
   tres. Se veía en «La DESCRIPCIÓN es lo que Vai usa…» desde antes. Reset aditivo, para no
   tocar la regla del título y arriesgar los que sí son directos. */
.card p b,.card small b,.card li b,.card td b,.card span b{display:inline;color:inherit;font-size:inherit;font-weight:700;letter-spacing:normal;text-transform:none;margin:0}
.card input,.card textarea,.card select{width:100%;background:var(--bg3);color:var(--white);border:1px solid rgba(var(--ink),.10);border-radius:8px;padding:9px 12px;margin-top:4px}
.panelcard{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:22px 24px}
.panelcard>b{display:block;font-family:var(--font-d);font-weight:900;font-size:15px;letter-spacing:-.01em;margin-bottom:2px}
.panelcard input{background:var(--bg3)}
.pt-count{font-family:var(--font-b);font-weight:500;font-size:12px;color:var(--muted);margin-left:8px}
/* ── Configuración: estado de integraciones con semáforo (verde/ámbar/rojo) ── */
.stpill{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:5px 13px;font-size:12.5px;font-weight:700;white-space:nowrap;border:1px solid transparent}
.stpill i{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.stpill.sm{padding:4px 11px;font-size:11.5px;gap:6px}
.stpill.sm i{width:6px;height:6px}
.stpill.ok{background:rgba(25,158,112,.10);border-color:rgba(25,158,112,.30);color:var(--stt-won)}
.stpill.ok i{background:var(--ok);box-shadow:0 0 8px rgba(25,158,112,.8)}
.stpill.warn{background:rgba(255,170,0,.10);border-color:rgba(255,170,0,.30);color:var(--amber-t)}
.stpill.warn i{background:var(--amber)}
.stpill.bad{background:rgba(230,103,103,.10);border-color:rgba(230,103,103,.35);color:var(--stt-lost)}
.stpill.bad i{background:var(--bad)}
.cfgtoken{background:var(--bg3);border:1px solid rgba(var(--ink),.08);border-radius:12px;padding:18px 20px;margin-top:14px}
.cfgtoken.ok{border-color:rgba(25,158,112,.25)}
.cfgtoken.warn{border-color:rgba(255,170,0,.30)}
.cfgtoken.bad{border-color:rgba(230,103,103,.35)}
.cfg-h{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.cfg-t{flex:1;min-width:220px}
.cfg-name{display:block;font-size:14px;font-weight:700}
.cfg-desc{display:block;font-size:12px;color:var(--muted2);margin-top:2px;max-width:640px}
.chip{display:inline-flex;align-items:center;background:rgba(var(--ink),.05);border:1px solid rgba(var(--ink),.10);color:rgba(var(--ink),.70);border-radius:999px;padding:4px 12px;font-size:11.5px;font-weight:500;white-space:nowrap}
.cfg-rot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.cfg-rot input{flex:1;max-width:420px}
.tico{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.tico svg{width:16px;height:16px}
.tico.key{background:rgba(255,107,26,.14);color:var(--orange2)}
.tico.cloud{background:rgba(57,135,229,.14);color:var(--stt-new)}
.tico.shield{background:rgba(255,170,0,.14);color:var(--amber-t)}
.tico.lock{background:rgba(144,133,233,.14);color:var(--stt-qualified)}
.tico.db{background:rgba(42,168,184,.14);color:#8fd8e0}
.cfgtiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:14px}
.cfgtiles .tile{background:var(--bg3);border:1px solid rgba(var(--ink),.08);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.tile .trow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tile .tname{font-size:13px;font-weight:700}
.tile .tdetail{font-size:11.5px;color:var(--muted2)}
.cfglegend{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px;font-size:11.5px;color:var(--muted2)}
.cfglegend span{display:inline-flex;align-items:center;gap:6px}
.cfglegend i{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.cfglegend .lg-ok{background:var(--ok)}.cfglegend .lg-warn{background:var(--amber)}.cfglegend .lg-bad{background:var(--bad)}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
.note{display:flex;gap:8px}
.lead-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.note textarea{flex:1}
/* Bandeja de dos paneles: lista a la izquierda, hilo a la derecha. Altura ACOTADA a
   propósito — el hilo tiene que scrollar dentro de su panel, no empujar la página. */
.inbox{display:grid;grid-template-columns:320px minmax(0,1fr);border:1px solid var(--border2);border-radius:var(--r);overflow:hidden;height:min(72vh,760px);background:var(--bg2)}
/* min-height:0 en TODA la cadena, no solo min-width. Un hijo de grid/flex tiene
   min-height:auto por defecto y NO puede encogerse por debajo de su contenido: sin esto el
   log nunca activa su scroll, crece entero y empuja el cajón de escritura fuera de la caja,
   donde el overflow:hidden de .inbox lo recorta. Era justo lo que se veía. */
.inbox-l{border-right:1px solid var(--border2);display:flex;flex-direction:column;min-width:0;min-height:0}
.inbox-list{overflow-y:auto;flex:1;min-height:0}
.chtabs{display:flex;gap:6px;padding:10px;border-bottom:1px solid var(--border2);flex-wrap:wrap}
.chtab{border:1px solid var(--border2);background:none;color:var(--muted);border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.chtab.is-on{border-color:var(--orange);color:var(--orange)}
.chtab b{font-weight:800}
.cvrow{display:flex;gap:10px;padding:11px 12px;border-bottom:1px solid var(--line);cursor:pointer;align-items:flex-start}
.cvrow:hover{background:var(--bg3)}
.cvrow.is-on{background:var(--surface)}
.cvav{width:34px;height:34px;border-radius:50%;flex:0 0 34px;display:grid;place-items:center;font-size:12px;font-weight:800;color:#fff}
.cvmain{min-width:0;flex:1}
.cvtop{display:flex;gap:8px;align-items:baseline}
.cvwho{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.cvwhen{font-size:11px;color:var(--muted2);white-space:nowrap}
.cvprev{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.cvdot{width:8px;height:8px;border-radius:50%;background:var(--orange);flex:0 0 8px;margin-top:6px}
.inbox-r{display:flex;flex-direction:column;min-width:0;min-height:0}
.thread-empty{flex:1;display:grid;place-items:center;color:var(--muted2);padding:20px;text-align:center}
.thread{display:flex;flex-direction:column;min-height:0;flex:1}
/* Misma trampa que .tgstep de arriba: una clase que fija display GANA al atributo
   [hidden], así que sin esto los dos paneles se dibujaban a la vez, el hilo empujaba al
   cajón de escritura fuera de la caja y el log se quedaba sin scroll propio. */
.thread-empty[hidden],.thread[hidden]{display:none}
.mono{font-family:ui-monospace,monospace;font-size:11px;opacity:.75}
.thread-h{padding:12px 14px;border-bottom:1px solid var(--border2);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.thread-log{flex:1;overflow-y:auto;padding:14px;min-height:0}
.composer{border-top:1px solid var(--border2);padding:10px 12px}
.composer textarea{width:100%;resize:vertical;min-height:52px;background:var(--bg2);color:var(--white);border:1px solid var(--border2);border-radius:var(--r-sm);padding:10px 12px;font:inherit;font-size:13px}
.composer textarea:disabled{opacity:.55;cursor:not-allowed}
.composer .crow{display:flex;gap:8px;align-items:center;margin-top:7px}
.cwin{font-size:12px;color:var(--muted)}
.cwin.shut{color:var(--bad)}
@media(max-width:900px){.inbox{grid-template-columns:1fr;height:auto}.inbox-l{border-right:0;border-bottom:1px solid var(--border2)}.inbox-list{max-height:44vh}.thread-log{max-height:52vh}}

/* Transcripción: burbujas de chat. El visitante a la izquierda y Vai a la derecha —
   leerlo tiene que parecerse a leer el chat, no a leer una tabla de filas. */
.chatlog{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.bub{max-width:76%;padding:8px 12px;border-radius:14px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.bub.user{align-self:flex-start;background:var(--card2);border:1px solid var(--line);border-bottom-left-radius:4px}
.bub.bot{align-self:flex-end;background:rgba(255,107,26,.10);border:1px solid rgba(255,107,26,.30);border-bottom-right-radius:4px}
/* La respuesta HUMANA no se disfraza de bot: si no se distinguen, nadie sabe si el
   cliente habló con Vai o con una persona, y la tasa de resolución miente. */
.bub.agent{align-self:flex-end;background:rgba(25,158,112,.12);border:1px solid rgba(25,158,112,.35);border-bottom-right-radius:4px}
.bub time{display:block;margin-top:4px;font-size:11px;opacity:.6}
.bub .who{display:block;font-size:11px;font-weight:700;opacity:.75;margin-bottom:2px}
.timeline{margin-top:20px}
.timeline h3{font-family:var(--font-d);font-weight:900;letter-spacing:-.01em}
.timeline article{border-left:2px solid rgba(255,107,26,.25);padding:0 0 14px 14px}
.field-err{display:block;margin-top:4px;color:var(--bad)}.field-err:empty{display:none}
/* La CSP (style-src con nonce) BLOQUEA los atributos style="" inline: todo estilo
   estático va en clases y todo valor dinámico se aplica por CSSOM (paint()). */
.mt12{margin-top:12px}.grow{flex:1}.w150{max-width:150px}.w80{max-width:80px}
.prewrap{white-space:pre-wrap;margin-top:8px}.preline{margin:8px 0;white-space:pre-line}
.promptbox{width:100%;font-family:ui-monospace,monospace;font-size:12.5px}
.inpill{background:var(--bg3);border:1px solid rgba(var(--ink),.10);border-radius:var(--r-sm);padding:9px 12px}
.mt6{margin-top:6px}.okmsg{color:var(--stt-won)}.mb6{margin:6px 0}.actions0{margin:4px 0 0;align-items:center}
.legend .d-new{background:var(--st-new)}.legend .d-contacted{background:var(--st-contacted)}.legend .d-qualified{background:var(--st-qualified)}.legend .d-won{background:var(--st-won)}.legend .d-lost{background:var(--st-lost)}
/* Previsualización de la marca del widget: mini-mock del chat con los valores del form */
#brandPrev{margin-top:8px;max-width:300px;border-radius:12px;overflow:hidden;border:1px solid var(--border2);background:#ece5dd}
#brandPrev .bp-h{display:flex;align-items:center;gap:8px;padding:8px 10px;color:#fff;background:#075e54}
#brandPrev .bp-av{width:26px;height:26px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#FF6B1A;color:#fff;font-weight:700;font-size:12px;flex-shrink:0}
#brandPrev .bp-av img{width:100%;height:100%;object-fit:cover}
#brandPrev .bp-n{font-size:12px;font-weight:600}
#brandPrev .bp-g{margin:8px;background:#fff;color:#111;border-radius:0 8px 8px 8px;padding:6px 8px;font-size:12px;width:fit-content;max-width:85%}
#brandPrev .bp-c{display:flex;flex-wrap:wrap;gap:4px;margin:0 8px 8px}
#brandPrev .bp-c span{border:1px solid rgba(0,0,0,.2);border-radius:10px;padding:3px 8px;font-size:10.5px;background:#fff;color:#075e54}
#brandPrev.bp-dark{background:#0b141a}
#brandPrev.bp-dark .bp-g{background:#1f2c34;color:#e9edef}
#brandPrev.bp-dark .bp-c span{background:#1f2c34;color:#e9edef;border-color:rgba(255,255,255,.2)}
/* Toasts de resultado (guardado ✓ / error): contenedor popover para quedar en el top
   layer POR ENCIMA de los <dialog> abiertos — un fixed normal quedaría detrás. */
#toasts{position:fixed;top:14px;right:14px;left:auto;bottom:auto;margin:0;border:0;padding:0;background:transparent;overflow:visible;flex-direction:column;align-items:flex-end;gap:8px}
#toasts:popover-open{display:flex}
.toast{background:var(--bg2);border:1px solid var(--ok);color:var(--white);border-radius:var(--r-sm);padding:10px 14px;box-shadow:0 8px 30px rgba(0,0,0,.45);font-size:13px;max-width:360px;opacity:0;transform:translateY(-6px);transition:opacity .2s ease,transform .2s ease}
.toast.on{opacity:1;transform:none}
.toast.err{border-color:var(--bad);background:linear-gradient(180deg,rgba(230,103,103,.12),var(--bg2))}
#tVersions article{margin-bottom:10px}
#tVersions pre{white-space:pre-wrap;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px;font-size:11.5px;max-height:220px;overflow:auto}
@media(max-width:1100px){.grid{grid-template-columns:1fr 1fr}}
@media(max-width:900px){body{flex-direction:column}.side{position:static;height:auto;width:auto;flex-direction:row;align-items:center;gap:6px;padding:10px 16px;border-right:0;border-bottom:1px solid var(--border)}.sep,.navlabel{display:none}.tabs{flex-direction:row}.sidefoot{border:0;padding:0;margin-left:auto}.brand small{display:none}}
@media(max-width:700px){.grid{grid-template-columns:1fr}#tNote{display:none}}
/* Vista Calendario (SPEC-CALENDARIO), estilo Google Calendar: rejilla continua
   (gap 1px sobre fondo = líneas finas), número del día en círculo (hoy relleno),
   citas como chips con barra de color. El detalle del día se abre en modal. */
.cliente-only{display:none}
body.cliente .cliente-only{display:flex}
.calnav{display:flex;align-items:center;gap:10px;margin:2px 0 10px}
.calnav b{font-size:16px;text-transform:capitalize;min-width:185px;text-align:center}
.calgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden}
.caldow{background:var(--bg2);font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;text-align:center;padding:7px 0}
.calcell{background:var(--bg2);min-height:104px;padding:3px;cursor:pointer;overflow:hidden;text-align:center}
.calcell:hover{background:var(--bg3)}
.calcell.out{cursor:default}
.calcell.out:hover{background:var(--bg2)}
.dnum{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;font-size:11.5px;color:var(--muted);font-weight:600;margin:2px 0}
.calcell.today .dnum{background:var(--orange);color:#fff}
.calchip{display:block;font-size:10.5px;line-height:1.45;margin:2px 3px 0;padding:1px 6px 1px 5px;border-radius:4px;background:rgba(255,107,26,.15);color:var(--chip-t);border-left:3px solid var(--orange);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.calmore{display:block;font-size:10px;color:var(--muted);margin-top:2px;text-align:left;padding-left:6px}
.btnsm{padding:4px 10px;font-size:12px}
/* Asistente horizontal de Conexiones (canvas «Conexión de Telegram guiada»,
   aprobado por Juan 2026-08-21): riel de progreso clicable + una tarjeta por paso.
   Estados SOLO por clases (la CSP no cubre style="" dinámico). */
.tgw-top{display:flex;align-items:flex-start;gap:16px}
.tgw-top .grow{flex:1}
/* La regla global .card b (bloque, gris, MAYÚSCULAS) no aplica dentro del asistente:
   reset amplio y re-especialización de títulos. Y [hidden] debe GANAR al display
   de las clases de nodo/barra — si no, el paso oculto deja un nodo fantasma. */
.card .tgpanel b,.card b.tgh{display:inline;color:inherit;font-size:inherit;font-weight:700;letter-spacing:0;text-transform:none;margin:0}
.card b.tgh{display:block;font-family:var(--font-d);font-size:19px;letter-spacing:-.02em;color:var(--white)}
.card b.tgh-sm{font-size:16px}
.card .tgcard>b{display:block;font-size:12.5px;color:var(--white);margin-bottom:2px}
/* El selector de archivo nativo no se puede maquillar: se oculta accesiblemente y su
   <label> hace de botón del panel. La clase va donde haya un input file (aquí y ficha). */
.filein{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.filein:focus-visible+label{outline:2px solid var(--orange);outline-offset:2px}
.fname{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.chk2{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);cursor:pointer}
.chk2 input{accent-color:var(--orange);width:15px;height:15px}
.cxlogo{width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:rgba(var(--ink),.06);overflow:hidden;flex:none;font-size:11px;color:rgba(var(--ink),.5)}
.cxlogo img{width:100%;height:100%;object-fit:cover}
.tgnode[hidden],.tgbar[hidden],.tgstep[hidden]{display:none}
.tgh{font-family:var(--font-d);font-weight:700;font-size:19px;letter-spacing:-.02em}
.tgh2{font-family:var(--font-d);font-weight:700;font-size:16px;letter-spacing:-.01em}
.tgsub{margin:4px 0 0;color:var(--muted);font-size:13px}
.tgchip{font-size:12px;color:var(--muted);background:var(--bg);border:1px solid var(--border2);border-radius:999px;padding:5px 12px;white-space:nowrap}
.tgrail{display:flex;align-items:flex-start;margin:20px 0 4px}
.tgnode{display:flex;flex-direction:column;align-items:center;gap:7px;width:86px;flex-shrink:0;border:0;background:none;cursor:pointer;padding:0;font-family:inherit}
.tgnum{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-weight:700;font-size:13.5px;background:rgba(var(--ink),.08);color:var(--muted)}
.tgnode.cur .tgnum{background:var(--orange);color:#fff;box-shadow:0 0 0 4px rgba(255,107,26,.18)}
.tgnode.done .tgnum{background:var(--ok);color:#fff}
.tgnlbl{font-size:11.5px;font-weight:500;color:var(--muted);text-align:center;max-width:100%;overflow-wrap:anywhere}
.tgnode:hover .tgnlbl{color:var(--white)}
.tgnode.cur .tgnlbl{color:var(--chip-t);font-weight:700}
.tgnode.done .tgnlbl{color:var(--white)}
.tgbar{flex:1;height:3px;border-radius:2px;margin-top:15px;background:rgba(var(--ink),.12)}
.tgbar.done{background:var(--ok)}
.tgpanel{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin-top:14px;min-height:250px;display:flex;flex-direction:column}
.tgstep{flex:1;display:flex;flex-direction:column}
.tgstep[hidden]{display:none}
.tgbody{flex:1}
.tgcards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}
.tgcards.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.tgcard{background:var(--bg2);border:1px solid rgba(var(--ink),.10);border-radius:10px;padding:13px 15px}
.tgcard b{font-size:12.5px}
.tgcard p{margin:6px 0 0;color:var(--muted);font-size:12.5px}
.tgnav{display:flex;justify-content:space-between;gap:10px;margin-top:16px;align-items:center}
.tgfinbody{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.tgfinico{display:inline-flex;align-items:center;justify-content:center;width:54px;height:54px;border-radius:50%;background:rgba(25,158,112,.12);color:var(--ok)}
.tgfinico svg{width:26px;height:26px}
@media(max-width:900px){.tgcards,.tgcards.two{grid-template-columns:1fr}.tgnlbl{display:none}.tgnode{width:44px}}
.caldaylist>div{padding:9px 0;border-bottom:1px solid var(--line)}
.caldaylist>div:last-child{border-bottom:0}
</style></head><body>
<aside class="side">
<div class="brand" id="brand"><i></i><span class="bname">Velai</span> <small>Panel</small><span class="blogo"><img id="brandLogo" alt=""><b id="brandName"></b></span></div>
<div class="sep"></div>
<div class="navlabel velai-only">Gestión</div>
<nav class="tabs" role="tablist">
<button class="tab is-on" role="tab" aria-selected="true" data-view="dashboard" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="12" width="4" height="9"></rect><rect x="10" y="7" width="4" height="14"></rect><rect x="17" y="3" width="4" height="18"></rect></svg>Dashboard</button>
<button class="tab" role="tab" aria-selected="false" data-view="leads" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"></path><circle cx="10" cy="7" r="4"></circle><path d="M21 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>Leads</button>
<button class="tab" role="tab" aria-selected="false" data-view="conversaciones" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>Conversaciones</button>
<button class="tab" role="tab" aria-selected="false" data-view="calendario" id="calNavBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><line x1="8" y1="3" x2="8" y2="7"></line><line x1="16" y1="3" x2="16" y2="7"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>Calendario</button>
<button class="tab" role="tab" aria-selected="false" data-view="conexiones" id="cxNavBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>Conexiones</button>
<button class="tab velai-only" role="tab" aria-selected="false" data-view="tenants" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Clientes</button>
<button class="tab velai-only" role="tab" aria-selected="false" data-view="canales" id="chNavBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10"></path><circle cx="18" cy="7" r="2.4"></circle><path d="M4 17h10"></path><circle cx="18" cy="17" r="2.4"></circle><path d="M4 12h6"></path></svg>Canales</button>
</nav>
<div class="navlabel velai-only">Sistema</div>
<nav class="tabs">
<button class="tab velai-only" role="tab" aria-selected="false" data-view="config" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"></line><circle cx="9" cy="7" r="2.4"></circle><line x1="4" y1="17" x2="20" y2="17"></line><circle cx="15" cy="17" r="2.4"></circle></svg>Configuración</button>
</nav>
<span class="spacer"></span>
<div class="sidefoot">
<button class="tab" id="themeBtn" type="button" title="Cambia el tema de las vistas (la barra lateral siempre es oscura)"><svg id="thMoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"></path></svg><svg id="thSun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><circle cx="12" cy="12" r="4.5"></circle><line x1="12" y1="2.5" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="21.5"></line><line x1="2.5" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="21.5" y2="12"></line><line x1="5.3" y1="5.3" x2="7" y2="7"></line><line x1="17" y1="17" x2="18.7" y2="18.7"></line><line x1="5.3" y1="18.7" x2="7" y2="17"></line><line x1="17" y1="7" x2="18.7" y2="5.3"></line></svg><span id="themeLabel">Tema oscuro</span></button>
<button class="tab" id="logout" type="button" title="Cerrar la sesión de Cloudflare Access"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path></svg>Salir</button>
</div>
</aside>
<main><div id="viewDashboard">
<div class="vhead"><div><h1>Dashboard</h1><p>Leads y consumo, de un vistazo</p></div></div>
<div class="metrics">
<div class="stat"><b>Leads · 30 días</b><span class="n" id="mTotal">—</span></div>
<div class="stat"><b>Sin contactar</b><span class="n" id="mNew">—</span><small id="mNewSub"></small></div>
<div class="stat" id="mFailCard"><b>Avisos fallidos · 7 días</b><span class="n" id="mFail">—</span></div>
<div class="stat" id="mTenantsCard"><b>Clientes activos</b><span class="n" id="mTenants">—</span></div>
</div>
<div class="chartcard cliente-only mt12" id="saldoCard"><b id="saldoTitle">Saldo de IA</b>
<div class="saldo"><span class="n" id="saldoLeft">—</span><span class="of" id="saldoOf"></span></div>
<div class="bigbar" id="saldoBar"><i data-w="0"></i></div>
<div class="chartlabels"><span id="saldoToday"></span><span id="saldoPct"></span></div>
<div id="saldoChart" class="mt6"></div>
<small class="muted" id="saldoNote"></small></div>
<div class="chartcard"><b>Leads por día · 14 días</b><div id="chart"></div><div class="chartlabels"><span id="chartFrom"></span><span id="chartTo"></span></div></div>
<div class="grid2 mt12">
<div class="chartcard"><b>Leads por canal · 30 días</b><div id="canalRows" class="mt6 muted">—</div></div>
<div class="chartcard"><b>Tasa de captura · 30 días</b><div class="metrics mt6"><div class="stat"><b>Conversaciones</b><span class="n" id="capConv">—</span></div><div class="stat"><b>Acaban en lead</b><span class="n" id="capPct">—</span><small id="capSub"></small></div></div><div id="capRows" class="mt6 muted"></div></div>
</div>
<div class="chartcard velai-only mt12" id="aiCard"><div class="aihead"><b>Gasto de IA</b><span class="sel"><select id="aiDays"><option value="7">7 días</option><option value="30" selected>30 días</option><option value="90">90 días</option></select></span></div>
<div class="metrics mt6"><div class="stat"><b>Coste del periodo</b><span class="n" id="aiCost">—</span><small id="aiCostSub"></small></div>
<div class="stat"><b>Llamadas al modelo</b><span class="n" id="aiCalls">—</span></div>
<div class="stat"><b>Tokens</b><span class="n" id="aiTokens">—</span></div></div>
<div id="aiChart" class="mt6"></div><div class="chartlabels"><span id="aiFrom"></span><span id="aiTo"></span></div>
<div class="table mt12"><table class="tnarrow"><thead><tr><th>Cliente</th><th>Llamadas</th><th>Tokens</th><th>Coste</th><th>Parte del total</th></tr></thead><tbody id="aiRows"></tbody></table></div>
<small class="muted">Coste estimado con las tarifas públicas de Anthropic (entrada, salida y caché) por modelo. El cupo diario por cliente se edita en su ficha.</small></div>
<div class="chartcard velai-only mt12" id="infraCard"><div class="aihead"><b>Infraestructura · Cloudflare (24 h)</b><span class="muted" id="infraNote"></span></div>
<div id="infraRows" class="mt6 muted">—</div>
<small class="muted">Consumo real leído de Cloudflare frente a los límites del plan gratuito. Superar un límite no cobra: degrada (los frenos y las cachés fallan «abriendo» y los leads siguen guardándose).</small></div>
</div>
<div id="viewLeads" hidden>
<div class="vhead"><div><h1>Leads</h1><p>Últimos 30 días</p></div><button class="btn alt" id="export" type="button">Exportar CSV</button></div>
<div id="escalations"></div>
<form class="filters" id="filters"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg><input name="q" class="q" placeholder="Buscar nombre, teléfono, sector…"></label><span class="sel"><select name="tenant" id="tenantFilter"><option value="">Todos los clientes</option></select></span><span class="sel"><select name="status"><option value="">Todos los estados</option><option>new</option><option>contacted</option><option>qualified</option><option>won</option><option>lost</option><option>spam</option></select></span><span class="sel"><select name="notification"><option value="">Todos los avisos</option><option>pending</option><option>sent</option><option>failed</option><option>skipped</option></select></span><input name="source" placeholder="Fuente"><input name="from" type="date" title="Desde"><input name="to" type="date" title="Hasta"><button class="btn">Filtrar</button><span id="resultCount"></span></form>
<div id="message"></div><div class="table"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Nombre</th><th>WhatsApp</th><th>Asunto</th><th>Fuente</th><th>Avisos</th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="legend"><span><i class="d-new"></i>nuevo</span><span><i class="d-contacted"></i>contactado</span><span><i class="d-qualified"></i>cualificado</span><span><i class="d-won"></i>ganado</span><span><i class="d-lost"></i>perdido</span></div>
<div class="pager"><button class="btn alt" id="more" hidden>Cargar más</button></div></div>
<div id="viewConversaciones" hidden>
<div class="vhead"><div><h1>Conversaciones</h1><p>Lo que se dijo — y responder sin salir del panel</p></div><div class="actions actions0"><span id="availState" class="flag off">—</span><button class="btn alt btnsm" id="availToggle" type="button">—</button><button class="btn alt" id="convExport" type="button">Exportar CSV</button></div></div>
<small class="muted" id="availNote"></small>
<form class="filters" id="convFilters">
<input type="hidden" name="channel" id="convChannel">
<span class="sel velai-only"><select name="tenant" id="convTenant"><option value="">Todos los clientes</option></select></span>
<input name="from" type="date" title="Desde"><input name="to" type="date" title="Hasta">
<label class="fchk"><input type="checkbox" name="lead" value="si">Solo las que dieron lead</label>
<label class="fchk"><input type="checkbox" name="sinResolver" value="1">Solo con preguntas sin respuesta</label>
<button class="btn">Filtrar</button><span id="convCount"></span>
</form>
<div id="convMessage"></div>
<div class="inbox">
<div class="inbox-l"><div class="chtabs" id="chTabs"></div><div class="inbox-list" id="convRows"></div></div>
<div class="inbox-r">
<div class="thread-empty" id="threadEmpty">Elige una conversación de la izquierda.</div>
<div class="thread" id="thread" hidden>
<div class="thread-h" id="threadHead"></div>
<div class="chatlog thread-log" id="threadLog"></div>
<div class="composer" id="composer"></div>
</div></div></div></div>
<div id="viewTenants" hidden>
<div class="vhead"><div><h1>Clientes</h1><p>Canal, contexto y estado de cada cliente</p></div><button class="btn" id="newTenant" type="button">Nuevo cliente</button></div>
<div class="table"><table><thead><tr><th>Nombre</th><th>Canal</th><th>Leads</th><th>Contexto</th><th>Configuración</th><th>Estado</th><th>Calendario</th></tr></thead><tbody id="tenantRows"></tbody></table></div></div>
<div id="viewCalendario" hidden>
<div class="vhead"><div><h1 id="calTitle">Calendario</h1><p>Citas agendadas por Vai en el Google Calendar del negocio</p></div><div class="actions actions0"><select id="calTenantSel" class="inpill velai-only"></select><button class="btn alt velai-only" id="calBack" type="button">← Volver a Clientes</button></div></div>
<div class="card" id="calConnCard" hidden><b>Conectar Google Calendar</b>
<p class="muted mt6">Aún no hay calendario conectado. Al pulsar «Conectar Google» se abre la pantalla de permiso de Google: entra con la cuenta de Google del negocio. Vai consultará sus huecos y agendará citas directamente en su calendario, desde el chat web y WhatsApp.</p>
<p class="muted mt6">Al conectar, Vai solo lee los tramos ocupados/libres del calendario elegido y crea los eventos de las citas; no lee el contenido del resto de eventos. Detalle del tratamiento: <a href="https://hirevai.com/privacidad/#google-calendar" target="_blank" rel="noopener">datos de Google Calendar</a> · <a href="https://hirevai.com/condiciones/#calendar" target="_blank" rel="noopener">condiciones del servicio (§5)</a>.</p>
<div id="calState" class="mt6 muted"></div>
<div class="actions actions0"><button class="btn" id="calConnect" type="button">Conectar Google</button></div></div>
<div id="calViewWrap" hidden>
<div class="card"><div id="calWho" class="muted"></div>
<div class="calnav mt6"><button class="btn alt btnsm" id="calToday" type="button">Hoy</button><button class="btn alt btnsm" id="calPrev" type="button">◀</button><b id="calMonthTitle">—</b><button class="btn alt btnsm" id="calNext" type="button">▶</button><span class="spacer"></span><button class="btn alt btnsm" id="calReconnect" type="button">Reconectar</button><button class="btn alt btnsm" id="calDisconnect" type="button">Desconectar</button></div>
<div class="calgrid" id="calGrid"></div>
<div id="calHint" class="mt6 muted"></div></div>
<div class="card mt12"><b>Configuración de citas</b>
<div class="grid mt6">
<div class="card"><b>Calendario (ID)</b><input id="calId" placeholder="primary"></div>
<div class="card"><b>Zona horaria</b><input id="calTz" placeholder="Europe/Madrid"></div>
<div class="card"><b>Duración (min)</b><input id="calSlot" type="number" min="10" max="240" placeholder="30"></div>
</div>
<div class="mt6"><b>Horario laboral</b><p class="muted">JSON por día (mon…sun); vacío = L-V 9:00-19:00.</p>
<textarea id="calHours" rows="3" placeholder='{"mon":[["09:00","14:00"],["16:00","20:00"]]}'></textarea></div>
<div class="actions actions0"><button class="btn" id="calSave" type="button">Guardar calendario</button></div></div>
</div>
</div>
<div id="viewConexiones" hidden>
<div class="vhead"><div><h1>Conexiones</h1><p>Canales de aviso y estado de WhatsApp del negocio</p></div><div class="actions actions0"><select id="cxTenantSel" class="inpill velai-only"></select></div></div>
<div class="card"><b class="tgh tgh-sm">Tus canales</b>
<p class="tgsub">Por d&oacute;nde te llegan conversaciones ahora mismo. Cada uno se configura en su apartado de abajo.</p>
<div class="chlist" id="cxChannels"></div></div>
<div class="card mt12">
<div class="tgw-top"><div class="grow"><b class="tgh">Recibe tus leads en Telegram</b>
<p class="tgsub">Una sola vez, 5–10 minutos. El asistente detecta lo que ya está hecho y guarda tu avance.</p></div>
<span class="velai-only" id="tgWlRow"><span id="tgWlState" class="flag off">desactivada</span> <button class="btn alt btnsm" id="tgWlToggle" type="button">Activar</button></span> <span class="tgchip" id="tgProgress">—</span></div>

<div class="tgrail">
<button class="tgnode" id="tgn1" type="button" data-tgo="tgs1"><span class="tgnum">1</span><span class="tgnlbl">Tu bot</span></button><i class="tgbar" id="tgbar1"></i>
<button class="tgnode" id="tgn2" type="button" data-tgo="tgs2"><span class="tgnum">2</span><span class="tgnlbl">El grupo</span></button><i class="tgbar" id="tgbar2"></i>
<button class="tgnode" id="tgn3" type="button" data-tgo="tgs3"><span class="tgnum">3</span><span class="tgnlbl">Conectar</span></button><i class="tgbar" id="tgbar3"></i>
<button class="tgnode" id="tgn4" type="button" data-tgo="tgs4"><span class="tgnum">4</span><span class="tgnlbl">Permisos</span></button><i class="tgbar" id="tgbar4"></i>
<button class="tgnode" id="tgn5" type="button" data-tgo="tgs5"><span class="tgnum">5</span><span class="tgnlbl">Temas</span></button>
</div>

<div class="tgpanel">
<div class="tgstep" id="tgs1b" hidden><div class="tgbody">
<div class="tgh2">Crea el bot de tu negocio</div>
<p class="tgsub">Así los avisos llegarán firmados por tu marca (p. ej. @MiNegocioBot).</p>
<div class="tgcards">
<div class="tgcard"><b>1 · Abre @BotFather</b><p>En Telegram, busca <b>@BotFather</b> — el que tiene la insignia azul de verificado.</p></div>
<div class="tgcard"><b>2 · Escríbele /newbot</b><p>Te pedirá un nombre visible («Mi Negocio Avisos») y un usuario que termine en <b>bot</b>.</p></div>
<div class="tgcard"><b>3 · Copia el token</b><p>BotFather te dará una línea larga de números y letras: pégala aquí abajo.</p></div>
</div>
<div id="tgBotState" class="muted mt6">—</div>
<div class="actions actions0"><input id="tgBotToken" type="password" autocomplete="new-password" placeholder="pega aquí el token de @BotFather" class="grow inpill"><button class="btn" id="tgBotSave" type="button">Guardar bot</button><button class="btn alt" id="tgBotDel" type="button" hidden>Quitar</button></div>
</div><div class="tgnav"><span></span><button class="btn alt" id="tgSkipBot" type="button">Prefiero usar el bot de Velai →</button></div></div>

<div class="tgstep" id="tgs2b" hidden><div class="tgbody">
<div class="tgh2">Crea el grupo de tu equipo</div>
<p class="tgsub">Ahí llegarán los avisos, para ti y para quien tú añadas.</p>
<div class="tgcards">
<div class="tgcard"><b>1 · Nuevo grupo</b><p>En Telegram: menú → <b>Nuevo grupo</b>.</p></div>
<div class="tgcard"><b>2 · Tu equipo</b><p>Añade a quien deba ver los leads (puedes añadir más luego).</p></div>
<div class="tgcard"><b>3 · Nombre claro</b><p>P. ej. <b>«Mi Negocio · Leads»</b>.</p></div>
</div>
</div><div class="tgnav"><button class="btn alt" id="tgBack2" type="button">← Anterior</button><button class="btn" id="tgs2ok" type="button">Ya tengo el grupo →</button></div></div>

<div class="tgstep" id="tgs3b" hidden><div class="tgbody">
<div class="tgh2">Conecta el grupo con Vai</div>
<p class="tgsub">Un toque desde el móvil y el bot queda dentro de tu grupo.</p>
<div id="tgState" class="muted mt6">—</div>
<div class="actions actions0"><button class="btn" id="tgLink" type="button">Generar enlace de conexión</button><button class="btn alt" id="tgUnlink" type="button" hidden>Desconectar</button></div>
<div id="tgLinkBox" class="note mt6" hidden>
<p class="mb6"><b>Abre este enlace desde el móvil</b> donde tienes Telegram: <a id="tgGroupUrl" href="#" target="_blank" rel="noopener"><b>conectar mi grupo</b></a> → elige el grupo del paso anterior. En el grupo aparecerá la confirmación «✅ Listo…» y este paso avanzará solo al recargar.</p>
<p class="muted mb6">¿No llega la confirmación? Escribe dentro del grupo: <code id="tgCmd"></code> · ¿Prefieres un chat directo contigo? <a id="tgDmUrl" href="#" target="_blank" rel="noopener">usa este enlace</a>. Caduca en 15 minutos.</p>
</div>
</div><div class="tgnav"><button class="btn alt" id="tgBack3" type="button">← Anterior</button><span></span></div></div>

<div class="tgstep" id="tgs4b" hidden><div class="tgbody">
<div class="tgh2">Activa los «Temas» y dale permiso al bot</div>
<p class="tgsub">Los Temas son las pestañas del grupo donde llegarán tus leads clasificados.</p>
<div class="tgcards two">
<div class="tgcard"><b>1 · Activa los Temas</b><p>Abre el grupo → toca su <b>nombre</b> (arriba) → <b>Editar</b> → interruptor <b>«Temas»</b>.</p></div>
<div class="tgcard"><b>2 · Bot administrador</b><p><b>Administradores</b> → añade el bot (el del paso 1, o el de Velai) → activa <b>«Gestionar temas»</b> → guarda.</p></div>
</div>
<p class="muted mt6">Si al crear un tema falta algo, te lo diremos con palabras claras.</p>
</div><div class="tgnav"><button class="btn alt" id="tgBack4" type="button">← Anterior</button><button class="btn" id="tgs4ok" type="button">Ya lo activé →</button></div></div>

<div class="tgstep" id="tgs5b" hidden><div class="tgbody">
<div class="tgh2">Crea los temas para clasificar tus leads</div>
<p class="tgsub">La <b>descripción</b> es lo que Vai usa para decidir qué lead va a cada tema. Lo que no encaje irá al chat General.</p>
<div class="actions actions0"><input id="tgTopicName" placeholder="Nombre, p. ej. Presupuestos" class="inpill"><input id="tgTopicDesc" placeholder="Descripción, p. ej. clientes que piden precio o cotización" class="grow inpill"><button class="btn" id="tgTopicAdd" type="button">Crear tema</button></div>
<div id="tgTopics" class="muted mt6">—</div>
</div><div class="tgnav"><button class="btn alt" id="tgBack5" type="button">← Anterior</button><button class="btn" id="tgFinish" type="button">Terminar →</button></div></div>

<div class="tgstep tgfin" id="tgsFinb" hidden><div class="tgbody tgfinbody">
<span class="tgfinico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>
<div class="tgh2 mt6">Todo listo</div>
<p class="tgsub" id="tgFinMsg">Los próximos leads llegarán al grupo, clasificados por temas.</p>
<div class="actions actions0"><button class="btn alt btnsm" id="tgMoreTopics" type="button">Añadir o editar temas</button></div>
</div></div>
</div></div>
<div class="card mt12"><b class="tgh tgh-sm">WhatsApp del negocio</b>
<p class="tgsub">El estado de tu número de WhatsApp con Vai. La conexión inicial la hacemos juntos en una sesión corta — te avisaremos.</p>
<div id="waState" class="mt6 muted">—</div>
<div class="actions actions0 velai-only"><button class="btn alt" id="waSync" type="button">Sincronizar desde Twilio</button><button class="btn alt" id="waProfile" type="button">Aplicar marca al perfil</button><span id="waSyncOut" class="muted"></span></div>
<small class="muted velai-only">«Aplicar marca al perfil» manda el logo, la descripción y la web de la ficha a WhatsApp: es la foto que ve el cliente final. El nombre visible NO se toca (cambiarlo exige revisión de Meta).</small></div>
<div class="card mt12"><b class="tgh tgh-sm">¿Dónde llegan tus leads?</b>
<p class="tgsub">Un lead siempre se guarda en el panel. Esto es quién recibe además un aviso al momento.</p>
<div class="chlist" id="cxAlerts"></div></div>
<div class="card mt12"><b class="tgh tgh-sm">Tu logo</b>
<p class="tgsub">La imagen de tu negocio. Elige a qué canales aplica: WhatsApp la recorta en círculo y pide 640×640, así que a veces conviene una distinta de la del chat web. Máximo 2 MB (PNG, JPG o WebP).</p>
<div class="actions actions0"><label class="chk2"><input type="checkbox" id="cxChWeb" checked> Chat de mi web</label><label class="chk2"><input type="checkbox" id="cxChWa" checked> Mi WhatsApp</label></div>
<div class="actions actions0"><span id="cxLogoPrev" class="cxlogo" title="Imagen del chat web">—</span><span id="cxLogoPrevWa" class="cxlogo" title="Imagen de WhatsApp">—</span><input type="file" id="cxLogoFile" accept="image/png,image/jpeg,image/webp" class="filein"><label class="btn alt" for="cxLogoFile">Elegir imagen</label><span id="cxLogoName" class="fname muted">ninguna elegida</span><button class="btn" id="cxLogoUp" type="button">Guardar logo</button><button class="btn alt" id="cxLogoApply" type="button" hidden>Aplicar a mi WhatsApp</button></div>
<small class="muted" id="cxLogoOut"></small></div>
<div class="card mt12"><b class="tgh tgh-sm">Números de aviso por WhatsApp</b>
<p class="tgsub">A qué WhatsApp del equipo llega el aviso de cada lead (además de Telegram). Varios números separados por coma, formato whatsapp:+34…</p>
<div class="actions actions0"><input id="nfTeam" placeholder="whatsapp:+34600111222,whatsapp:+34600333444" class="grow inpill"><input id="nfWa" placeholder="nº de errores (solo dígitos)" class="inpill"><button class="btn alt" id="nfSave" type="button">Guardar</button></div>
<small class="muted field-err" data-f="team_whatsapp"></small></div>
<div class="card mt12"><b class="tgh tgh-sm">Horario de atención humana</b>
<p class="tgsub">Vai atiende <b>24 horas al día, todos los días</b>. Esto solo decide <b>cuándo puede pasar una conversación a una persona</b> de tu equipo. Fuera de este horario no ofrece asesor: atiende él y te deja el lead.</p>
<div class="actions actions0"><label class="muted">Zona horaria <span class="sel"><select id="shTz">
<option value="Europe/Madrid">España peninsular (Europe/Madrid)</option>
<option value="Atlantic/Canary">Canarias (Atlantic/Canary)</option>
<option value="America/Bogota">Colombia (America/Bogota)</option>
<option value="America/Mexico_City">México (America/Mexico_City)</option>
<option value="America/Argentina/Buenos_Aires">Argentina (America/Argentina/Buenos_Aires)</option>
<option value="America/Santiago">Chile (America/Santiago)</option>
</select></span></label></div>
<div class="shgrid"><div class="shrow"><span class="shday">Lunes</span><span class="shpair"><input type="time" id="sh_mon_1a"><span class="shsep">a</span><input type="time" id="sh_mon_1b"></span><span class="shpair"><input type="time" id="sh_mon_2a"><span class="shsep">a</span><input type="time" id="sh_mon_2b"></span></div><div class="shrow"><span class="shday">Martes</span><span class="shpair"><input type="time" id="sh_tue_1a"><span class="shsep">a</span><input type="time" id="sh_tue_1b"></span><span class="shpair"><input type="time" id="sh_tue_2a"><span class="shsep">a</span><input type="time" id="sh_tue_2b"></span></div><div class="shrow"><span class="shday">Miércoles</span><span class="shpair"><input type="time" id="sh_wed_1a"><span class="shsep">a</span><input type="time" id="sh_wed_1b"></span><span class="shpair"><input type="time" id="sh_wed_2a"><span class="shsep">a</span><input type="time" id="sh_wed_2b"></span></div><div class="shrow"><span class="shday">Jueves</span><span class="shpair"><input type="time" id="sh_thu_1a"><span class="shsep">a</span><input type="time" id="sh_thu_1b"></span><span class="shpair"><input type="time" id="sh_thu_2a"><span class="shsep">a</span><input type="time" id="sh_thu_2b"></span></div><div class="shrow"><span class="shday">Viernes</span><span class="shpair"><input type="time" id="sh_fri_1a"><span class="shsep">a</span><input type="time" id="sh_fri_1b"></span><span class="shpair"><input type="time" id="sh_fri_2a"><span class="shsep">a</span><input type="time" id="sh_fri_2b"></span></div><div class="shrow"><span class="shday">Sábado</span><span class="shpair"><input type="time" id="sh_sat_1a"><span class="shsep">a</span><input type="time" id="sh_sat_1b"></span><span class="shpair"><input type="time" id="sh_sat_2a"><span class="shsep">a</span><input type="time" id="sh_sat_2b"></span></div><div class="shrow"><span class="shday">Domingo</span><span class="shpair"><input type="time" id="sh_sun_1a"><span class="shsep">a</span><input type="time" id="sh_sun_1b"></span><span class="shpair"><input type="time" id="sh_sun_2a"><span class="shsep">a</span><input type="time" id="sh_sun_2b"></span></div></div>
<p class="muted">Deja las horas en blanco para los días que no atendéis. El segundo tramo es para las jornadas partidas.</p>
<div class="actions actions0"><button class="btn" id="shSave" type="button">Guardar horario</button><button class="btn alt btnsm" id="shCopy" type="button">Copiar el lunes a L-V</button><span class="muted" id="shOut"></span></div></div>
<div class="card mt12"><b class="tgh tgh-sm">Informe semanal</b>
<p class="tgsub">Cada lunes por la mañana, un resumen de la semana en tu grupo de Telegram: conversaciones, leads, citas y las preguntas que Vai no supo contestar. Llega sin entrar al panel — y se apaga cuando quieras.</p>
<div class="actions actions0"><span id="wrState" class="flag off">—</span><button class="btn alt btnsm" id="wrToggle" type="button">—</button><button class="btn alt btnsm" id="wrTest" type="button">Enviar una prueba ahora</button></div>
<small class="muted" id="wrNote"></small>
<small class="muted" id="wrLast"></small></div>
<div class="card mt12 velai-only"><b>Webhook del bot (solo Velai, una vez)</b>
<p class="muted mt6">Registra el webhook de Telegram apuntando al worker. OJO: con el webhook activo, getUpdates deja de funcionar para ese bot.</p>
<div class="actions actions0"><button class="btn alt" id="tgSetup" type="button">Registrar webhook</button><span id="tgSetupOut" class="muted"></span></div></div>
</div>
<div id="viewCanales" hidden>
<div class="vhead"><div><h1>Canales</h1><p>Las direcciones que el worker atiende de verdad</p></div><span class="stpill ok" id="chOverall" hidden><i></i></span></div>
<div class="filters" id="chFilters"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg><input id="chQ" class="q" placeholder="Buscar n&uacute;mero, cliente o tipo&hellip;"></label><span class="sel"><select id="chTenant"><option value="">Todos los clientes</option></select></span><span class="sel"><select id="chState"><option value="">Todos los estados</option><option value="alert">Solo los que requieren atenci&oacute;n</option><option value="live">Atendidos</option></select></span><span id="chCount"></span></div>
<div id="chAlarm"></div>
<p class="muted mt12">Cada mensaje entrante se enruta por su direcci&oacute;n: el worker la busca en esta tabla (y en el canal primario de la ficha) y exige que el cliente est&eacute; activo. Si una direcci&oacute;n no sale aqu&iacute;, ese n&uacute;mero no lo atiende nadie &mdash; por muy verde que est&eacute; en Twilio. La web no aparece: entra por slug y funciona siempre.</p>
<div class="table mt6"><table><thead><tr><th>Direcci&oacute;n</th><th>Cliente</th><th>Tipo</th><th>Estado</th><th>Enrutado desde</th></tr></thead><tbody id="chRows"></tbody></table></div>
<div class="legend"><span><i class="lg-ok"></i>atendido</span><span><i class="lg-warn"></i>requiere atenci&oacute;n</span><span><i class="lg-bad"></i>no atendido</span></div>
</div>
<div id="viewConfig" hidden>
<div class="vhead"><div><h1>Configuración</h1><p>Admins de Velai y estado de las integraciones</p></div><span class="stpill ok" id="cfgOverall" hidden><i></i></span></div>
<div class="panelcard" id="adminsCard"><b>Admins de Velai (ven TODO)<span class="pt-count" id="adminsCount"></span></b>
<p class="muted mt6">Entran en admin.hirevai.com con código por correo (One-time PIN). El alta y la baja actualizan también la puerta de Cloudflare Access — sin CLI ni dashboard. Los marcados «raíz» viven en la configuración del worker y no se pueden quitar desde aquí (a propósito: nada del panel puede dejar a Velai fuera de su propio panel).</p>
<div id="adminsList" class="mt6 muted">—</div>
<div class="actions actions0"><input id="aEmail" type="email" placeholder="nuevo-admin@correo.com" class="grow inpill"><button class="btn alt" id="aAdd" type="button">Añadir admin</button></div></div>
<p class="muted mt12" id="configOnly" hidden>El estado de las integraciones y el token de Cloudflare son solo para admins raíz (los de la configuración del worker).</p>
<div class="panelcard mt12" id="configCard" hidden><b>Estado de las integraciones</b>
<p class="muted mt6">Lo que el worker comprueba al abrir esta vista. La KEK, la API key de Anthropic y las credenciales maestras de Twilio no se gestionan aquí a propósito: viven como secrets del worker.</p>
<div class="cfgtoken" id="cfgTokenCard">
<div class="cfg-h"><span class="tico key"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg></span><span class="cfg-t"><span class="cfg-name">Token de API de Cloudflare</span><span class="cfg-desc">Firma las sincronizaciones de Turnstile y las puertas de Access. Write-only: se valida contra Cloudflare ANTES de guardarse, se cifra con la KEK y nunca se vuelve a mostrar.</span></span><span class="chip" id="cfgOrigin">—</span><span class="stpill warn" id="cfgTokenState"><i></i>—</span></div>
<div class="cfg-rot"><input id="cfgToken" type="password" autocomplete="new-password" placeholder="nuevo token de API de Cloudflare" class="inpill"><button class="btn alt" id="cfgTokenSave" type="button">Validar y guardar</button><button class="btn alt" id="cfgTokenClear" type="button">Volver al secret del worker</button></div>
</div>
<div class="cfgtiles" id="configState"></div>
<div class="cfglegend"><span><i class="lg-ok"></i>operativo</span><span><i class="lg-warn"></i>requiere atención</span><span><i class="lg-bad"></i>error</span></div>
</div></div></main>
<div class="foot" id="foot">Panel de <b>Velai</b> · <span id="footYear"></span> · Todos los derechos reservados</div>
<dialog id="detail"><div class="modal-h"><strong id="detailTitle">Detalle del lead</strong><button class="btn alt" id="close">Cerrar</button></div><div class="modal-b" id="detailBody"></div></dialog>
<dialog id="tenantModal"><div class="modal-top"><div class="modal-h"><strong id="tenantTitle">Cliente</strong><div class="mh-r"><input id="tNote" placeholder="Nota del cambio (opcional)" class="inpill"><button class="btn" id="tenantSave" type="button">Guardar</button><button class="btn alt" id="tenantClose" type="button">Cerrar</button></div></div>
<nav class="ttabs" id="ttabs">
<button type="button" class="ttab is-on" data-tt="identidad">Identidad y canal<i class="dot"></i></button>
<button type="button" class="ttab" data-tt="contexto">Contexto<i class="dot"></i></button>
<button type="button" class="ttab" data-tt="marca">Marca del widget<i class="dot"></i></button>
<button type="button" class="ttab" data-tt="prov" id="ttabProv">Aprovisionamiento<i class="dot"></i></button>
<button type="button" class="ttab" data-tt="usuarios" id="ttabUsers">Usuarios<i class="dot"></i></button>
<button type="button" class="ttab" data-tt="historial" id="ttabHist">Historial</button>
</nav>
<div class="wizsteps" id="wizSteps" hidden></div></div><div class="modal-b">
<div id="tenantMsg"></div>
<section class="tpane" data-tp="identidad">
<div class="grid">
<div class="card"><b>Nombre</b><input id="tName" placeholder="Barbería López"><small class="muted field-err" data-f="name"></small></div>
<div class="card"><b>Slug</b><input id="tSlug" placeholder="barberia-lopez"><small class="muted field-err" data-f="slug"></small></div>
<div class="card cardwide"><b>Canales del cliente</b><div class="chlist" id="tChannels"></div><small class="muted">Se leen del enrutado real, no se escriben: cada canal se da de alta en Conexiones. La web funciona desde el primer d&iacute;a por el slug. <span class="field-err" data-f="channel_address"></span></small></div>
<div class="card"><b>Twilio From</b><input id="tFrom" placeholder="whatsapp:+34910000000"><small class="muted field-err" data-f="twilio_from"></small></div>
<div class="card"><b>Equipo WhatsApp (coma)</b><input id="tTeam" placeholder="whatsapp:+34600111222,whatsapp:+34600333444"><small class="muted field-err" data-f="team_whatsapp"></small></div>
<div class="card"><b>Telegram chat_id</b><input id="tChat" placeholder="-100123456789"><small class="muted field-err" data-f="telegram_chat_id"></small></div>
<div class="card"><b>Plantilla de aviso (SID)</b><input id="tTpl" placeholder="HX seguido de 32 hex"><small class="muted field-err" data-f="lead_template_sid"></small></div>
<div class="card"><b>Subcuenta Twilio</b><input id="tSub" placeholder="AC seguido de 32 hex"><small class="muted field-err" data-f="twilio_subaccount_sid"></small></div>
<div class="card"><b>WABA del cliente</b><input id="tWaba" placeholder="solo dígitos, 10-20"><small class="muted field-err" data-f="waba_id"></small></div>
<div class="card"><b>Auth token de la subcuenta</b><input id="tToken" type="password" autocomplete="new-password" placeholder="solo para cambiarlo"><small class="muted" id="tTokenState"></small><small class="muted field-err" data-f="twilio_auth_token"></small></div>
<div class="card"><b>Socio en Meta</b><select id="tPartner"><option>pendiente</option><option>concedido</option><option>revocado</option></select></div>
<div class="card"><b>Estado</b><label><input type="checkbox" id="tActive" checked> Activo (enruta y atiende)</label></div>
</div></section>
<section class="tpane" data-tp="contexto" hidden>
<div class="card"><b>Contexto del negocio (system prompt) · <span id="tCount" class="muted"></span></b>
<div id="tDup" hidden class="mb6"><label class="muted">Duplicar de… <select id="tDupSel"><option value="">— empezar de cero —</option></select></label></div>
<textarea id="tPrompt" rows="14" class="promptbox"></textarea>
<small class="muted field-err" data-f="system_prompt"></small></div>
<div class="card mt12"><b>Probar el borrador (no guarda nada)</b>
<div class="note mt6"><input id="tTestMsg" placeholder="Mensaje de prueba, p. ej. «hola, ¿tenéis hueco mañana?»" class="grow"><button class="btn alt" id="tenantPreview" type="button">Probar</button></div>
<article id="tPreviewOut" class="muted prewrap"></article></div>
<div class="card mt12"><b>Consumo de IA de este cliente</b>
<p class="muted mt6">El <b>saldo mensual</b> es lo que el cliente ve en SU panel, y no corta nada: es un contador. El <b>cupo diario</b> sí corta (429) y existe contra abuso — avisa a Velai al 80%. Vacíos = los valores por defecto del worker.</p>
<p class="muted">Ojo: el contexto de arriba viaja en CADA turno, así que un prompt largo consume saldo en cada mensaje. Medido el 2026-08-26: GOgestión gasta 4.872 tokens por llamada y Diálogos 3.148 — la diferencia es el tamaño del prompt, no el tráfico.</p>
<div class="actions actions0">
<label class="muted">Saldo mensual (tokens) <input id="tAiMonth" type="number" min="10000" step="100000" placeholder="5000000" class="inpill w150"></label>
<label class="muted">Cupo diario (llamadas) <input id="tAiDay" type="number" min="1" step="50" placeholder="1500" class="inpill w150"></label>
</div>
<small class="muted field-err" data-f="ai_monthly_tokens"></small>
<small class="muted field-err" data-f="ai_daily_limit"></small></div>
</section>
<section class="tpane" data-tp="marca" hidden>
<div class="card"><b>Marca del widget (chat en la web del cliente)</b>
<p class="muted mt6">Lo que ve el visitante: logo, nombre, saludo, colores. Vacío = marca de Velai (hirevai.com no cambia). Se sirve por <code>/widget/boot</code> y se aplica sin deploy (caché 5 min).</p>
<div class="marca">
<div class="grid">
<div class="card"><b>Nombre del bot</b><input id="tBotName" placeholder="Zoe"><small class="muted field-err" data-f="bot_name"></small></div>
<div class="card"><b>Nombre de marca</b><input id="tBrandName" placeholder="Zoe Travel Spain"><small class="muted field-err" data-f="brand_name"></small></div>
<div class="card"><b>Logo del negocio</b><input id="tLogo" placeholder="https://… o sube una imagen aquí abajo"><div class="note mt6"><input type="file" id="tLogoFile" accept="image/png,image/jpeg,image/webp" class="filein"><label class="btn alt btnsm" for="tLogoFile">Elegir imagen</label><span id="tLogoName" class="fname muted">ninguna elegida</span><button class="btn btnsm" id="tLogoUp" type="button">Guardar logo</button><span id="tLogoOut" class="muted"></span></div><small class="muted">Se guarda en nuestro almacenamiento y sirve para el widget y para la <b class="tgh">foto de perfil de WhatsApp</b>. Cuadrada, 640×640 o más, máx. 2 MB (PNG/JPG/WebP).</small><small class="muted field-err" data-f="logo_url"></small></div>
<div class="card"><b>Colores (#rrggbb · el 2º opcional, degradado)</b><div class="note mt6"><input id="tColor1" placeholder="#1a4fd0" class="w150"><input id="tColor2" placeholder="#f57a1f" class="w150"></div><small class="muted field-err" data-f="brand_color"></small><small class="muted field-err" data-f="brand_color_2"></small></div>
<div class="card"><b>Saludo (ES)</b><textarea id="tGreeting" rows="2" placeholder="¡Hola! Soy Zoe 🐱 ¿A dónde sueñas viajar?"></textarea><small class="muted field-err" data-f="greeting"></small></div>
<div class="card"><b>Saludo (EN, opcional)</b><textarea id="tGreetingEn" rows="2" placeholder="Hi! I'm Zoe 🐱 Where do you dream of travelling?"></textarea><small class="muted field-err" data-f="greeting_en"></small></div>
<div class="card"><b>Sugerencias (hasta 3, una por línea)</b><textarea id="tChips" rows="3" placeholder="Vuelos a Colombia&#10;Paquetes con hotel"></textarea><small class="muted field-err" data-f="chips_json"></small></div>
<div class="card"><b>Placeholder del input</b><input id="tPlaceholder" placeholder="Escribe tu mensaje..."><small class="muted field-err" data-f="placeholder"></small></div>
<div class="card"><b>WhatsApp de contacto (wa.me, solo dígitos)</b><input id="tWa" placeholder="34644280183"><small class="muted field-err" data-f="wa_number"></small></div>
<div class="card"><b>Tema del chat</b><select id="tTheme"><option value="">auto (según el visitante)</option><option value="light">light</option><option value="dark">dark</option></select></div>
<div class="card"><b>Dominios de la web (https, uno por línea, máx. 6)</b><textarea id="tOrigins" rows="2" placeholder="https://… (apex y su www, uno por línea)"></textarea><small class="muted">Entran en la allowlist de CORS al Guardar (sin deploy). Después pulsa Sincronizar Turnstile.</small><small class="muted field-err" data-f="web_origins"></small></div>
</div>
<aside class="marcaprev"><b class="muted">Previsualización</b><div id="brandPrev"></div>
<div class="actions actions0"><button class="btn alt" id="tSyncDomains" type="button">Sincronizar Turnstile</button></div>
<small class="muted">Reescribe los hostnames del widget de Turnstile desde D1 (idempotente: también reconcilia).</small></aside>
</div></div></section>
<section class="tpane" data-tp="prov" hidden>
<div class="card" id="tProv" hidden><b>Aprovisionamiento Twilio (automático)</b>
<div id="tProvState" class="muted preline"></div>
<pre id="tTplRaw" class="rawout" hidden></pre>
<div class="actions actions0">
<button class="btn alt" id="pSub" type="button">1· Crear o adoptar subcuenta</button>
<button class="btn alt" id="pTpl" type="button">2· Plantilla → aprobación</button>
<button class="btn alt" id="pTplChk" type="button">Comprobar plantilla ahora</button>
<button class="btn alt" id="pTplRe" type="button">Reenviar a aprobación</button>
<input id="pPhone" placeholder="+34910000000" class="w150">
<button class="btn alt" id="pSender" type="button">3· Crear sender</button>
<input id="pCode" placeholder="OTP" class="w80">
<button class="btn alt" id="pVerify" type="button">4· Verificar OTP</button>
</div></div></section>
<section class="tpane" data-tp="usuarios" hidden>
<div class="card" id="tUsersCard" hidden><b>Usuarios del panel</b>
<p class="muted mt6">Correos con acceso a los leads de ESTE cliente (entran con OTP en admin.hirevai.com). Alta y baja surten efecto inmediato.</p>
<div id="tUsersList" class="mt6 muted">—</div>
<div class="actions actions0"><input id="uEmail" type="email" placeholder="gestora@cliente.com" class="grow inpill"><button class="btn alt" id="uAdd" type="button">Añadir</button></div>
<small class="muted field-err" data-f="panel_email"></small></div></section>
<section class="tpane" data-tp="historial" hidden>
<div class="timeline"><div id="tVersions" class="muted">—</div></div></section>
<div class="wizbar" id="wizBar" hidden><button class="btn alt" id="wizBack" type="button">Atrás</button><span class="muted" id="wizHint">El borrador se guarda al pasar de paso, sin activar nada hasta el final.</span><button class="btn" id="wizNext" type="button">Guardar y continuar</button></div>
</div></dialog>
<dialog id="calDayDlg"><div class="modal-h"><strong id="calDayTitle">Citas del día</strong><button class="btn alt" id="calDayClose" type="button">Cerrar</button></div><div class="modal-b caldaylist" id="calDayBody"></div></dialog>
<div id="toasts" popover="manual"></div>
<script nonce="__NONCE__">var __name=(t,v)=>Object.defineProperty(t,"name",{value:v,configurable:true});(${panelApp.toString()})();</script></body></html>`;

export const ADMIN_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
