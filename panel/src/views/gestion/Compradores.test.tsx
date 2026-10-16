import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect,it } from 'vitest';
import { buyerLabel, buyerNames, BuyerField } from './Compradores';

it('unifica alias y orden de compras conjuntas, sin repetir a una persona',()=>{
 expect(buyerLabel('Sebas')).toBe('Sebastián Valderrama');
 expect(buyerLabel('Estiven y Sebas')).toBe('Estiven Rojas y Sebastián Valderrama');
 expect(buyerLabel('Sebas y Estiven')).toBe(buyerLabel('Estiven y Sebas'));
 expect(buyerNames('Sebas y Sebastián Valderrama')).toEqual(['Sebastián Valderrama']);
 expect(buyerLabel(null)).toBe('Comprador pendiente');
});
it('un nombre libre antiguo se informa pero no se ofrece como opción del selector',async()=>{
 const user=userEvent.setup();
 render(<form aria-label="Compra"><BuyerField value="Persona anterior y Sebas" cat={{socios:[{nombre:'Sebastián Valderrama',email:'sebas@qa.test'}],entidades:[],cuentas:[],negocios:[]}}/></form>);
 const first=screen.getByRole('combobox',{name:'Quién compra'});
 expect(first).toHaveValue('');
 expect(within(first).queryByRole('option',{name:'Persona anterior'})).not.toBeInTheDocument();
 expect(screen.getByText(/El nombre anterior no está en el catálogo/)).toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Otra persona (2)'})).toHaveValue('Sebastián Valderrama');
 await user.click(screen.getByRole('button',{name:'Quitar persona 2'}));
 const data=new FormData(screen.getByRole('form',{name:'Compra'}) as HTMLFormElement);
 expect(data.get('comprador')).toBe('');
});
