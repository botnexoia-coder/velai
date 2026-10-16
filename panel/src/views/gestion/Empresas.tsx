import { useState } from 'react';
import { ErrorBox, FormModal, Notice, str, useGestion, useGuardar } from './shared';
interface Empresa{id:string;nombre:string}
export function CompanyField({name='proveedor',label='Proveedor',value,required=false}:{name?:string;label?:string;value?:string|null;required?:boolean}){
 const query=useGestion<{items:Empresa[]}>('terceros'),save=useGuardar();
 const [selected,setSelected]=useState(value||''),[adding,setAdding]=useState(false);
 const companies=query.data?.items||[];
 const chosen=companies.find(c=>c.nombre.toLocaleLowerCase('es')===selected.toLocaleLowerCase('es'))?.nombre||selected;
 return <div className="g-buyers"><label>{label}<select name={name} value={chosen} required={required} onChange={e=>setSelected(e.target.value)}><option value="">Seleccionar empresa</option>{chosen&&!companies.some(c=>c.nombre===chosen)?<option value={chosen}>{chosen}</option>:null}{companies.map(c=><option key={c.id} value={c.nombre}>{c.nombre}</option>)}</select></label><button type="button" className="btn alt" onClick={()=>setAdding(true)}>Añadir empresa al catálogo</button><small>Elige una empresa existente. Si falta, añádela una sola vez al catálogo.</small><ErrorBox error={query.error}/>{adding?<FormModal title="Añadir empresa al catálogo" close={()=>setAdding(false)} fields={[{name:'nombre',label:'Nombre de la empresa',required:true}]} submit={async(d,id)=>{const result=await save.mutateAsync({path:'terceros',body:{id,nombre:str(d,'nombre')}}) as {item:Empresa};setSelected(result.item.nombre);}}><Notice>Se añade un proveedor o cliente externo. No crea otra entidad emisora, gasto ni pago.</Notice></FormModal>:null}</div>;
}
