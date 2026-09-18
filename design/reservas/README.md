# Rediseño de la página de reservas

Fuente del diseño aprobado el 2026-09-15 (lienzo: <https://claude.ai/artifact/Gq9xKdTGH999aUUEEN8q9a>).
Lo implementado vive en `worker/reserva-page.js`; esto es el material con el que se decidió.

```
node gen-flujo.mjs && node gen-resto.mjs && node gen-marca-alt.mjs   # regenera los tableros
node _mirar.mjs        # los pinta y avisa si alguno se sale de su marco
node _sello.mjs        # comprobación geométrica del distintivo
```

Los tableros (`*.dc.html`), las tipografías embebidas y el lienzo empaquetado NO se
commitean: se regeneran desde `_base.mjs` y `site/fonts/`.

Decisiones que gobiernan el diseño, para no reabrirlas sin motivo:

- **La marca sale del aprovisionamiento del chat** (`brand_color`, `brand_color_2`,
  `accent_color`, `logo_url`, `theme`), con la misma derivación del acento que el widget.
  No hay configuración de marca propia de reservas y no debe haberla.
- **Color con cuentagotas**: degradado solo en el botón principal, día elegido en plano,
  hora elegida en tinte. Es lo que separa la pantalla del aspecto saturado anterior.
- **Sin cinta diagonal en la esquina**: es el gesto de Calendly. El distintivo «Tecnología
  Velai» va integrado en la cabecera (y al pie en móvil).
- **Una sola columna** para día y hora: el móvil es la misma maqueta, no otra.
