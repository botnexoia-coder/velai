// El tooltip propio: sale con hover Y con foco (el title del navegador nunca sale con
// teclado), pinta filas clave/valor sin HTML y se cierra con Escape.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TipHost } from './Tip';

function setup(attrs: Record<string, string>) {
  const utils = render(
    <>
      <button type="button" {...attrs}>
        disparador
      </button>
      <TipHost />
    </>,
  );
  return { ...utils, trigger: screen.getByRole('button', { name: 'disparador' }) };
}

describe('tooltip propio (data-tip)', () => {
  it('aparece al recibir FOCO, no solo con el ratón', () => {
    const { trigger } = setup({ 'data-tip': 'Explica algo' });
    const tip = document.getElementById('tip')!;
    expect(tip).not.toBeVisible();
    fireEvent.focusIn(trigger);
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent('Explica algo');
    // Accesibilidad: el globo describe al elemento mientras está abierto.
    expect(trigger).toHaveAttribute('aria-describedby', 'tip');
  });

  it('se esconde al perder el foco y con Escape', () => {
    const { trigger } = setup({ 'data-tip': 'Explica algo' });
    const tip = document.getElementById('tip')!;
    fireEvent.focusIn(trigger);
    expect(tip).toBeVisible();
    fireEvent.focusOut(trigger);
    expect(tip).not.toBeVisible();
    expect(trigger).not.toHaveAttribute('aria-describedby');

    fireEvent.focusIn(trigger);
    expect(tip).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tip).not.toBeVisible();
  });

  it('filas clave/valor (data-tip-rows) con el texto como título', () => {
    const { trigger } = setup({
      'data-tip': 'lunes, 31 de agosto',
      'data-tip-rows': 'Leads:7|whatsapp:4|web:3',
    });
    fireEvent.focusIn(trigger);
    const tip = document.getElementById('tip')!;
    expect(tip.querySelector('b')).toHaveTextContent('lunes, 31 de agosto');
    const rows = tip.querySelectorAll('.tipk');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('whatsapp');
    expect(rows[1]).toHaveTextContent('4');
  });

  it('el contenido va por textContent: un dato con HTML no se interpreta', () => {
    const { trigger } = setup({ 'data-tip': '<img src=x onerror=alert(1)>' });
    fireEvent.focusIn(trigger);
    const tip = document.getElementById('tip')!;
    expect(tip.querySelector('img')).toBeNull();
    expect(tip.textContent).toContain('<img');
  });
});
