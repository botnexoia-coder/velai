// Comprueba la simetría: el centro de la banda debe caer sobre la bisectriz de la esquina.
import { chromium } from '/home/juanes/projects/velai/panel/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const OUT='/tmp/claude-1000/-home-juanes-projects-velai/1c63095f-f322-4c92-bfa0-b82ac1602c4b/scratchpad';
const b=await chromium.launch();
for(const f of ['Main.dc.html','Movil.dc.html']){
  const src=readFileSync(f,'utf8');
  const estilo=src.match(/<style>([\s\S]*?)<\/style>/)[1];
  let cuerpo=src.split('<helmet>')[1].split('</helmet>')[1].split('</x-dc>')[0]
    .replace('{{tokens}}','--l1:#b83e08;--l2:#662a16;--acc:#ff914f;--srf:#f7f4ef;--card:#fff;--text:#172033;--muted:#5b6472;--line:rgba(0,0,0,.08);--input:#ece8e1');
  const t=`${OUT}/sello-${f}.html`; writeFileSync(t,`<!doctype html><meta charset="utf-8"><style>${estilo}</style>${cuerpo}`);
  const p=await b.newPage({viewport:{width:1100,height:1250}});
  await p.goto('file://'+t,{waitUntil:'load'}); await p.waitForTimeout(300);
  const m=await p.evaluate(()=>{
    const caja=[...document.querySelectorAll('div')].find(d=>d.textContent.trim()==='Tecnología Velai' && d.children.length===0);
    const cuad=caja.parentElement, c=cuad.getBoundingClientRect(), r=caja.getBoundingClientRect();
    const S=c.width, cx=(r.left+r.right)/2-c.left, cy=(r.top+r.bottom)/2-c.top;
    return {S:Math.round(S),cx:+cx.toFixed(1),cy:+cy.toFixed(1),suma:+(cx+cy).toFixed(1)};
  });
  console.log(`${f.padEnd(16)} cuadro ${m.S}px · centro de la banda (${m.cx}, ${m.cy}) · x+y=${m.suma} ${Math.abs(m.suma-m.S)<1.5?'= S  ✓ centrada':'≠ S  ✗ descentrada'}`);
  await p.close();
}
await b.close();
