import { chromium } from '/home/juanes/projects/velai/panel/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const OUT='/tmp/claude-1000/-home-juanes-projects-velai/1c63095f-f322-4c92-bfa0-b82ac1602c4b/scratchpad';
const canvas=JSON.parse(readFileSync('canvas.json','utf8'));
const b=await chromium.launch(); const problemas=[];
for(const ab of canvas.artboards){
  const src=readFileSync(ab.file,'utf8');
  const estilo=src.match(/<style>([\s\S]*?)<\/style>/)[1];
  let cuerpo=src.split('<helmet>')[1].split('</helmet>')[1].split('</x-dc>')[0];
  // resolver el hueco de tokens de las palancas de marca con los valores por defecto
  cuerpo=cuerpo.replace('{{tokens}}','--l1:#b83e08;--l2:#662a16;--acc:#ff914f;--srf:#f7f4ef;--card:#fff;--text:#172033;--muted:#5b6472;--line:rgba(0,0,0,.08);--input:#ece8e1');
  const f=`${OUT}/ab-${ab.file.replace('.dc.html','')}.html`;
  writeFileSync(f,`<!doctype html><meta charset="utf-8"><style>${estilo}</style>${cuerpo}`);
  const p=await b.newPage({viewport:{width:ab.w,height:ab.h}});
  await p.goto('file://'+f,{waitUntil:'load'}); await p.waitForTimeout(350);
  const m=await p.evaluate(()=>{const r=document.querySelector('.root').getBoundingClientRect();return {alto:Math.ceil(r.height),ancho:Math.ceil(r.width)};});
  await p.screenshot({path:`${OUT}/ab-${ab.file.replace('.dc.html','')}.png`,fullPage:true});
  const desbordaY=m.alto>ab.h+2, desbordaX=m.ancho>ab.w+2;
  console.log(`${ab.file.padEnd(22)} marco ${ab.w}×${ab.h} · contenido ${m.ancho}×${m.alto}${desbordaY||desbordaX?'   ⚠ SE SALE':'   ok'}`);
  if(desbordaY||desbordaX) problemas.push(ab.file);
  await p.close();
}
await b.close();
console.log(problemas.length?'\nrevisar: '+problemas.join(', '):'\ntodos caben');
