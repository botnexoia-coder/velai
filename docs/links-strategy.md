# Estrategia de Enlaces (On-Page) — Velai

> Documento operativo para el bloque "Enlaces" del checker SEO.
> Cubre **enlaces internos**, **enlaces externos**, **uso de `rel=`** y **anchor text**.

Los checkers SEO (sitechecker, SE Ranking, SEMrush) evalúan **3 cosas** en este bloque:

1. **Cantidad y balance** de enlaces internos vs externos.
2. **Calidad del destino** de los externos (autoridad, relevancia temática).
3. **Tratamiento técnico**: `rel=` correctos, `target="_blank"` seguro, anchor text descriptivo.

Lo que NO mide aquí (eso va en otro bloque): backlinks externos hacia ti.

---

## 1. Enlaces internos

### Objetivo
- **Cada página: ≥5 enlaces internos contextuales** (en el body, no solo en nav/footer).
- **El nav y footer no cuentan tanto** para el checker — busca enlaces DENTRO del contenido (párrafos, FAQs, CTAs in-line).

### Patrones probados que funcionan
- **Sub-páginas relacionadas**: en home, dentro de párrafos o FAQs, enlaza a posts del blog cuando el tema profundiza un punto.
  - Ejemplo: FAQ "¿Funciona con mi WhatsApp Business?" → enlace a `blog/como-automatizar-reservas-whatsapp-restaurante/`.
- **Cross-linking entre posts**: cada post enlaza a 2-3 posts hermanos del blog. La sección "Sigue leyendo" cuenta, pero es mejor un enlace inline dentro del párrafo (el checker valora más los inline).
- **Páginas pilar ↔ posts**: si tienes una "guía completa" larga, los posts cortos enlazan a ella y viceversa.

### Anchor text
- ✅ Descriptivo y único por destino: "guía completa para automatizar reservas en WhatsApp"
- ❌ Genérico: "haz click aquí" / "más info" / "leer más"
- ⚠️ No repitas EL MISMO anchor text apuntando a destinos distintos — eso confunde a Google y los checkers SEO lo flagean como "anchor text duplicado".

### Reglas `rel=` para internos
- Internos: **no necesitas `rel`**.
- Si abres en pestaña nueva (raro en internos): `rel="noopener noreferrer"` por seguridad.

---

## 2. Enlaces externos

### Objetivo
- **Cada post de blog: 2-4 enlaces externos contextuales follow** a fuentes de autoridad.
- **Home: 0-2 enlaces externos** (mantén el foco en conversión).

### Por qué importan los externos
Para los checkers SEO y para Google, **enlazar a fuentes de autoridad refuerza E-E-A-T** (Expertise / Experience / Authoritativeness / Trustworthiness). Es contraintuitivo: enlazar "fuera" SUBE tu autoridad si las fuentes son sólidas.

### Tipos de fuentes que cuentan como autoridad

| Tipo | Ejemplos | DR aprox. |
|---|---|---|
| Wikipedia | `es.wikipedia.org/wiki/...` | 96 |
| Sitios oficiales gov/edu | `aepd.es`, `boe.es`, `europa.eu` | 90+ |
| Documentación oficial de productos | `business.whatsapp.com`, `developers.google.com`, `docs.stripe.com` | 90+ |
| Medios reconocidos | El País, BBC, Reuters | 80+ |
| Estándares (RFC, W3C) | `w3.org`, `ietf.org` | 90+ |

### Qué NO enlazar como "autoridad"
- Blogs de competidores (no quieres pasarles juice).
- SEO/marketing blogs random.
- Sitios con DR < 30.
- Sitios afiliados o sponsored sin marcar correctamente.

### Reglas `rel=` para externos

| Caso | rel a usar | Por qué |
|---|---|---|
| Fuente de autoridad citada | `rel="noopener"` (follow implícito) | Pasas autoridad. Suma a tu E-E-A-T. |
| Sitios afiliados / partners de pago | `rel="noopener noreferrer sponsored"` | Google exige `sponsored` desde 2019. |
| Sitios cuestionables / user-generated | `rel="noopener noreferrer ugc"` | UGC = User-Generated Content. |
| RRSS propias (WhatsApp, LinkedIn) | `rel="noopener noreferrer"` | No pasa juice innecesario, pero no es nofollow puro. |
| Link a algo que NO quieres respaldar | `rel="noopener noreferrer nofollow"` | Cita pero no recomienda. |

**Siempre añade `target="_blank" rel="noopener noreferrer"` en externos**: es buena práctica de seguridad (evita tab-nabbing) y los checkers SEO lo validan.

### Pattern a evitar
- ❌ `<a href="https://externa.com" target="_blank">` sin `rel=` → vulnerabilidad de seguridad.
- ❌ Mucho enlace externo en home / landing → diluye conversión.
- ❌ TODO con nofollow → patrón antinatural, Google lo detecta.

---

## 3. Estado actual de Velai (mayo 2026)

### Home (`index.html`)

| Concepto | Estado | Acción |
|---|---|---|
| Enlaces internos contextuales | 3 (en FAQ) | ✅ Añadidos en este sprint |
| Enlaces externos | 1 (wa.me) | OK, ya tiene `rel="noopener noreferrer"` |
| Anchors `#sección` (nav, footer) | 7 | Ignorados por el checker (mismo URL) |
| Anchor text duplicados | Diversificados | ✅ Footer dice "Página principal", "Más artículos" |

### Posts del blog (3 archivos)

Cada post tiene ahora:
- **5+ enlaces internos**: cross-linking entre posts + link a home + link al blog index.
- **2 enlaces externos follow** a fuentes de autoridad:
  - `business.whatsapp.com/products/business-platform` (Meta — documentación oficial)
  - `es.wikipedia.org/wiki/...` o `aepd.es` (Wikipedia / autoridad estatal)
- **Share bar** con 5 botones (X, LinkedIn, WhatsApp, email, copy).

---

## 4. Próximas mejoras opcionales

### A. Páginas pilar
Si en el futuro se crea una "Guía completa de IA conversacional para PYMEs" como página pilar de 4000+ palabras, todos los posts del blog enlazarían a ella, y ella enlazaría hacia los posts. Eso multiplica la autoridad interna.

### B. Glossary / Diccionario
Una página `/glosario/` con definiciones de términos del sector (WhatsApp Business API, BSP, LLM, NLU, etc.). Cada definición enlaza desde varios posts. Es un patrón clásico SEO.

### C. Caso de éxito por sector
`/casos/restaurantes/`, `/casos/clinicas/`, `/casos/inmobiliarias/`. Cada caso enlaza al post relevante del blog y viceversa.

### D. Página "Sobre nosotros"
Falta una página `/sobre/` con bios de los fundadores. Esto es importante para E-E-A-T (los authors de los `BlogPosting` deberían apuntar a una persona con `url` a su perfil).

---

## 5. Checklist al publicar contenido nuevo

Cuando se publique un nuevo post del blog o landing:

- [ ] **3-5 enlaces internos contextuales** dentro del body (inline, no en sidebar).
- [ ] **2-3 enlaces externos follow** a fuentes de autoridad (Wikipedia, sitios oficiales, docs).
- [ ] **Cross-linking**: el nuevo post enlaza a 2 hermanos, y los 2 hermanos se editan para enlazar al nuevo.
- [ ] **Sitemap.xml actualizado** con la nueva URL.
- [ ] **Anchor text descriptivo y único** — no "más info".
- [ ] **`target="_blank" rel="noopener noreferrer"`** en TODOS los enlaces externos.
- [ ] **`BreadcrumbList` schema** apuntando al nuevo path.

---

*Última actualización: 2026-05-18*
