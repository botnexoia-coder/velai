# Catálogo de demos

Los demos públicos de Velai viven aislados dentro de `site/demo/`. El índice está en `/demo/` y cada experiencia usa su propia carpeta:

```text
site/demo/
├── index.html
├── manifest.json
└── <slug>/
    ├── index.html
    └── assets propios
```

## Añadir un demo

1. Exporta la experiencia completa a `site/demo/<slug>/`. Debe funcionar como una unidad autocontenida y no escribir ni reemplazar recursos globales de `site/assets/`.
2. Añade una entrada única a `site/demo/manifest.json` con `id`, `slug`, `title`, `eyebrow`, `description`, `status`, `path`, `image`, `accent` y `updatedAt`. La imagen es opcional, pero debe estar dentro de `/demo/`.
3. Usa una ruta con el formato `/demo/<slug>/` y establece `status` como `active`.
4. Ejecuta `npm run check` antes de publicar.

## Estados

- `active`: aparece en el catálogo y se puede abrir.
- `paused`: aparece marcado como “En pausa”, pero no permite entrar.
- `archived`: se conserva en el registro, pero no aparece en el catálogo.

Para desactivar o reactivar una experiencia solo hay que cambiar su estado en `manifest.json`.

## Mover o renombrar

1. Mueve la carpeta a `site/demo/<nuevo-slug>/`.
2. Actualiza `slug` y `path` en `manifest.json`.
3. Busca enlaces absolutos al slug anterior dentro del demo y vuelve a exportarlo si los hubiera.
4. Ejecuta `npm run check` para comprobar que la nueva ruta y todos los recursos existen.

## QuieroDIGI

Su código fuente vive en el proyecto hermano `quierodigi-propuesta`. Para actualizar la copia publicada, desde ese proyecto ejecuta:

```sh
npm run export:velai-demo -- /ruta/al/repositorio/velai/site/demo/quierodigi
```

Después valida el repositorio Velai con `npm run check`. El demo no comparte el widget general de Velai porque contiene su propio asistente Digo.
