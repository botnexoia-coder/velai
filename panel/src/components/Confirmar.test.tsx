// Los diálogos propios que sustituyen a window.confirm/prompt (pedido de Juan: nada de
// diálogos comunes del navegador). El test estructural del final es el que evita que la
// migración se deshaga sola: un window.confirm nuevo pone la suite en rojo.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ConfirmarHost, confirmar, pedirTexto } from './Confirmar';

afterEach(cleanup);

describe('confirmar()', () => {
  it('resuelve true al aceptar y false al cancelar, con el botón rojo solo en peligro', async () => {
    render(<ConfirmarHost />);

    const p1 = confirmar({ titulo: '¿Borrar este lead?', cuerpo: 'No hay papelera.', accion: 'Borrar', peligro: true });
    const borrar = await screen.findByRole('button', { name: 'Borrar' });
    expect(borrar.className).toContain('bad'); // destructiva = rojo
    fireEvent.click(borrar);
    await expect(p1).resolves.toBe(true);

    const p2 = confirmar({ titulo: '¿Dar acceso?', accion: 'Dar acceso' });
    const dar = await screen.findByRole('button', { name: 'Dar acceso' });
    expect(dar.className).not.toContain('bad'); // normal = naranja de marca
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(p2).resolves.toBe(false);
  });

  it('Escape (evento cancel del dialog) resuelve false: la promesa nunca queda colgada', async () => {
    const { container } = render(<ConfirmarHost />);
    const p = confirmar({ titulo: '¿Seguro?' });
    await screen.findByText('¿Seguro?');
    fireEvent(container.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
    await expect(p).resolves.toBe(false);
  });

  it('dos peticiones seguidas no se pisan: cola, no valor único', async () => {
    render(<ConfirmarHost />);
    const p1 = confirmar({ titulo: 'Primera', accion: 'Sí' });
    const p2 = confirmar({ titulo: 'Segunda', accion: 'Sí' });
    fireEvent.click(await screen.findByRole('button', { name: 'Sí' }));
    await expect(p1).resolves.toBe(true);
    // La segunda aparece al resolverse la primera, con su propia promesa.
    await screen.findByText('Segunda');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(p2).resolves.toBe(false);
  });
});

describe('pedirTexto()', () => {
  it('devuelve el texto recortado al aceptar y null al cancelar (cancelar NO es cadena vacía)', async () => {
    render(<ConfirmarHost />);

    const p1 = pedirTexto({ titulo: 'Descripción del tema', inicial: 'clientes que piden precio', accion: 'Guardar' });
    const input = await screen.findByPlaceholderText('');
    expect((input as HTMLInputElement).value).toBe('clientes que piden precio'); // pre-rellenado
    fireEvent.change(input, { target: { value: '  urgencias  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await expect(p1).resolves.toBe('urgencias');

    // Cancelar devuelve null, no '': con el prompt nativo esa confusión BORRABA la
    // descripción existente del tema (el ?? '' seguía mutando).
    const p2 = pedirTexto({ titulo: 'Otra' });
    await screen.findByText('Otra');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(p2).resolves.toBe(null);
  });
});

describe('sin host montado', () => {
  it('cae al diálogo nativo — feo pero nunca un false silencioso que deje botones muertos', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await expect(confirmar({ titulo: '¿Seguro?', cuerpo: 'Detalle.' })).resolves.toBe(true);
      expect(spy).toHaveBeenCalledWith('¿Seguro?\n\nDetalle.');
    } finally { spy.mockRestore(); }
  });
});

describe('estructural', () => {
  it('ningún fichero del panel usa los diálogos comunes del navegador', () => {
    // Barrido real del código fuente: si alguien vuelve a escribir window.confirm/prompt/
    // alert fuera del fallback de Confirmar.tsx, esto se pone rojo con el fichero y listo.
    const src = join(__dirname, '..');
    const malos: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
        if (name === 'Confirmar.tsx') continue; // el único sitio legítimo: el fallback
        const texto = readFileSync(full, 'utf8');
        for (const patron of ['window.confirm(', 'window.prompt(', 'window.alert(', 'alert(']) {
          // «alert(» a secas se busca con frontera para no cazar «checkAlerts(» y similares.
          const re = patron === 'alert(' ? /(?<![A-Za-z_.])alert\(/ : null;
          if (re ? re.test(texto) : texto.includes(patron)) malos.push(`${full.slice(src.length)}: ${patron}`);
        }
      }
    };
    walk(src);
    expect(malos).toEqual([]);
  });
});
