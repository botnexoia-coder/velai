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
it('conserva nombres antiguos y permite retirar un segundo comprador sin perder el principal',async()=>{
 const user=userEvent.setup();
 render(<form aria-label="Compra"><BuyerField value="Persona anterior y Sebas"/></form>);
 expect(screen.getByRole('combobox',{name:'Quién compra'})).toHaveValue('Persona anterior');
 expect(screen.getByRole('combobox',{name:'Otra persona (2)'})).toHaveValue('Sebastián Valderrama');
 await user.click(screen.getByRole('button',{name:'Quitar persona 2'}));
 const data=new FormData(screen.getByRole('form',{name:'Compra'}) as HTMLFormElement);
 expect(data.get('comprador')).toBe('Persona anterior');
 expect(within(screen.getByRole('combobox')).getByRole('option',{name:'Persona anterior'})).toBeInTheDocument();
});
