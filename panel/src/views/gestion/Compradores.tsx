import { useState } from 'react';
import type { Catalogos } from './shared';

// Compatibilidad con nombres ya guardados. Las nuevas compras usan las opciones
// del catálogo de socios; seleccionar varias personas no duplica el importe.
const canonical:Record<string,string>={
 sebas:'Sebastián Valderrama', 'sebastian valderrama':'Sebastián Valderrama',
 estiven:'Estiven Rojas', 'estiven rojas':'Estiven Rojas',
 juan:'Juan Esteban García', 'juan esteban garcia':'Juan Esteban García',
};
export function buyerNames(value?:string|null):string[]{
 const names=(value||'').split(/\s+y\s+|\s*;\s*/).map(s=>s.trim()).filter(Boolean).map(s=>canonical[s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()]||s);
 return [...new Set(names)].sort((a,b)=>a.localeCompare(b,'es'));
}
export const buyerLabel=(value?:string|null)=>buyerNames(value).join(' y ')||'Comprador pendiente';
export function BuyerField({cat,value,label='Quién compra',required=false}:{cat?:Catalogos;value?:string|null;label?:string;required?:boolean}){
 const initial=buyerNames(value);
 const [selected,setSelected]=useState<string[]>(initial.length?initial:['']);
 const people=[...new Set([...(cat?.socios||[]).filter(s=>!s.nombre.includes('@')).flatMap(s=>buyerNames(s.nombre)),...initial])].sort((a,b)=>a.localeCompare(b,'es'));
 return <div className="g-buyers"><input type="hidden" name="comprador" value={buyerNames(selected.filter(Boolean).join(' y ')).join(' y ')}/>{selected.map((name,i)=><div className="g-buyer-row" key={i}><label>{i===0?label:`Otra persona (${i+1})`}<select value={name} required={required&&i===0} onChange={e=>setSelected(current=>current.map((s,j)=>j===i?e.target.value:s))}><option value="">Seleccionar persona</option>{people.filter(p=>p===name||!selected.includes(p)).map(p=><option key={p} value={p}>{p}</option>)}</select></label>{i>0?<button type="button" className="btn alt" aria-label={`Quitar persona ${i+1}`} onClick={()=>setSelected(current=>current.filter((_,j)=>j!==i))}>Quitar</button>:null}</div>)}{selected.length<people.length?<button type="button" className="btn alt" onClick={()=>setSelected(current=>[...current,''])} disabled={selected.some(s=>!s)}>Añadir otra persona</button>:null}<small>Si compraron juntos, selecciona a cada persona. La compra se cuenta una sola vez; esto no reparte el pago.</small></div>;
}
