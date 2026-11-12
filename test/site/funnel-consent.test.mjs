import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../../site/assets/funnel.js',import.meta.url),'utf8');
function fixture(saved,options={}){
  const nodes=new Map(), scripts=[], writes=[], listeners={}, store=new Map(saved?[['velai-consent-v2',JSON.stringify(saved)]]:[]),session=new Map();let reloads=0;if(options.legacy)store.set('velai-consent','granted');
  class El{
    constructor(tag){this.tagName=tag;this.dataset={};this.style={};this.children=[];this.classList={add(){},remove(){}};}
    set id(v){this._id=v;nodes.set(v,this);}get id(){return this._id;}
    setAttribute(k,v){this[k]=v;}getAttribute(k){return this[k];}hasAttribute(k){return k in this;}
    set innerHTML(v){this.html=v;this.buttons=[...v.matchAll(/data-action="(\w+)"/g)].map(m=>{let b=new El('button');b.dataset.action=m[1];return b;});this.inputs={};for(const m of v.matchAll(/name="(analytics|advertising)" ([^>]*)/g)){this.inputs[m[1]]={checked:m[2].includes('checked'),focus(){}};}}
    querySelectorAll(q){if(q==='[data-action]')return this.buttons||[];if(q==='a,input,button')return [...Object.values(this.inputs||{}),...(this.buttons||[])];return [];}
    querySelector(q){if(q==='input,button')return Object.values(this.inputs||{})[0]||this.buttons[0];return this.inputs?.[q.match(/name=(\w+)/)?.[1]];}
    appendChild(e){this.children.push(e);if(e.tagName==='script')scripts.push(e.src);return e;}addEventListener(k,v){this[k]=v;}focus(){}remove(){nodes.delete(this.id);}
  }
  let cookie='_ga=x; _fbp=y';
  const document={readyState:'loading',referrer:'https://example.org/post?email=secret@example.org',activeElement:null,documentElement:{lang:'es'},head:new El('head'),body:new El('body'),createElement:t=>new El(t),getElementById:id=>nodes.get(id),querySelector:()=>null,querySelectorAll:()=>[],getElementsByTagName:()=>[{parentNode:{insertBefore:e=>scripts.push(e.src)}}],addEventListener:(k,f)=>listeners[k]=f};
  Object.defineProperty(document,'cookie',{get:()=>cookie,set:v=>writes.push(v)});
  const location={origin:'https://hirevai.com',hostname:'hirevai.com',pathname:'/',search:options.search||'',reload(){reloads++;}};
  const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>{if(options.storageBlocked)throw Error('blocked');store.set(k,v)},removeItem:k=>store.delete(k)};
  const window={location,VELAI_TRACK:{ga4:'G-8HC3SQ0T0Q',ads:'AW-18250158066',adsLabel:'label',pixel:'1928880717825520'},addEventListener:(k,f)=>listeners[k]=f};
  const context={window,document,location,localStorage:storage,sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},URL,URLSearchParams,Promise,setTimeout,clearTimeout,console};
  vm.runInNewContext(code,context);listeners.DOMContentLoaded();
  function choose(analytics,advertising){nodes.get('velai-consent')?.remove();window.VELAI_openConsent();const el=nodes.get('velai-consent');el.inputs.analytics.checked=analytics;el.inputs.advertising.checked=advertising;el.buttons.find(b=>b.dataset.action==='save').onclick();}
  return {window,scripts,writes,store,choose,get reloads(){return reloads;},events:()=>window.dataLayer.filter(x=>x[0]==='event').map(x=>[x[1],JSON.parse(JSON.stringify(x[2]))])};
}
test('fresh consent does not load vendors or queue measurement',()=>{const f=fixture();assert.deepEqual(f.scripts,[]);f.window.velaiTrack('lead_submit',{telefono:'+34612345678'});assert.equal(f.events().length,0);assert.equal(f.window.VELAI_measurementPreferences().analytics,false);});
test('analytics category loads GA once, no Ads or pixel; safe attribution and event parameters',()=>{const f=fixture(null,{search:'?utm_source=instagram&utm_campaign=summer-2026&email=secret@example.org&fbclid=abcDEF'});f.choose(true,false);f.choose(true,false);assert.equal(f.scripts.filter(x=>x.includes('gtag')).length,1);assert.equal(f.scripts.filter(x=>x.includes('facebook')).length,0);f.window.velaiTrack('lead_submit',{sector:'restaurantes',telefono:'123456789',mensaje:'secret',code:'private error'});const e=f.events().at(-1);assert.equal(e[0],'lead_submit');assert.equal(e[1].send_to,'G-8HC3SQ0T0Q');assert.equal(e[1].sector,'restaurantes');assert.equal(e[1].telefono,undefined);assert.equal(e[1].mensaje,undefined);assert.equal(e[1].code,undefined);assert.equal(e[1].page_referrer,'https://example.org/post');assert.match(e[1].page_location,/utm_source=instagram/);assert.doesNotMatch(e[1].page_location,/email|fbclid/);assert.equal(f.events().filter(x=>x[0]==='conversion').length,0);});
test('advertising alone loads Ads and Meta without GA config; conversions use Ads destination',()=>{const f=fixture();f.choose(false,true);assert.equal(f.scripts.some(x=>x.includes('id=AW-18250158066')),true);assert.equal(f.scripts.some(x=>x.includes('G-8HC3SQ0T0Q')),false);assert.equal(f.scripts.some(x=>x.includes('fbevents')),true);f.window.velaiTrack('whatsapp_click',{});assert.equal(f.events().filter(x=>x[0]==='whatsapp_click').length,0);assert.equal(f.events().at(-1)[0],'conversion');assert.equal(f.events().at(-1)[1].send_to,'AW-18250158066/label');});
test('revocation denies Google, revokes Meta, clears cookies and reloads once; new calls blocked',()=>{const f=fixture({version:2,analytics:true,advertising:true});f.choose(false,false);assert.equal(f.reloads,1);assert.ok(f.writes.some(x=>x.startsWith('_ga=;')));assert.ok(f.writes.some(x=>x.startsWith('_fbp=;')));const count=f.events().length;f.window.velaiTrack('lead_submit',{});assert.equal(f.events().length,count);assert.equal(f.window['ga-disable-G-8HC3SQ0T0Q'],true);});
test('unknown events and free-form error text never enter providers',()=>{const f=fixture({version:2,analytics:true,advertising:false});f.window.velaiTrack('customer_secret',{email:'a@b.com'});f.window.velaiTrack('chat_error',{msg:'private conversation',code:'secret'});const e=f.events().at(-1);assert.equal(e[0],'chat_error');assert.equal(e[1].msg,undefined);assert.equal(e[1].code,undefined);assert.equal(f.events().some(x=>x[0]==='customer_secret'),false);});
test('privacy refusal with blocked storage stays denied in memory',()=>{const f=fixture({version:2,analytics:true,advertising:true},{storageBlocked:true});f.choose(false,false);assert.equal(f.reloads,0);assert.equal(f.window.VELAI_measurementPreferences().analytics,false);assert.equal(f.window.VELAI_measurementPreferences().advertising,false);});

test('old all-or-nothing permission does not authorize v2 categories',()=>{const f=fixture(null,{legacy:true});assert.equal(f.scripts.length,0);assert.equal(f.window.VELAI_measurementPreferences().analytics,false);assert.equal(f.window.VELAI_measurementPreferences().advertising,false);});
