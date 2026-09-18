# Rediseño del Calendario / Reservas online del panel

Fuente del diseño aprobado el 2026-09-16 (lienzo: <https://claude.ai/artifact/FJMCKa3T23LZa1481khnk2>).
Lo implementado vive en `panel/src/views/Calendario.tsx`, `panel/src/views/ReservasOnline.tsx`
y `panel/src/styles/panel.css`; esto es el material con el que se decidió.

```
node gen-main.mjs && node gen-mas.mjs   # regenera los tableros
node _mirar.mjs                         # los pinta y avisa si alguno se sale de su marco
```

Los tableros (`*.dc.html`), las tipografías embebidas y el lienzo empaquetado NO se
commitean: se regeneran desde `_base.mjs` y `site/fonts/`.

Decisiones que gobiernan el rediseño:

- **Una vista con tres pestañas** (Agenda · Reservas online · Ajustes), no dos pantallas
  con un botón «← Calendario» que parece navegación rota.
- **Tokens del panel, sin inventar valores**: todo sale de `panel/src/styles/panel.css`
  (Cabinet Grotesk 900 + Satoshi, naranja #FF6B1A, superficies claras, radios 16/10), y la
  barra lateral se dibuja con sus tokens OSCUROS porque la navegación va oscura siempre.
- **Lo que falta, a la vista**: la lista de requisitos junto al enlace existe porque activar
  la página sin dominio autorizado o sin servicios fallaba en silencio.
- **Sin emoji en los chips de cita**: punto de color, como el resto del panel.
