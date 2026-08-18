-- Marca por cliente para el widget web unificado (PR B del plan de widget de clientes).
-- El chat en la web de un cliente debe mostrar SU logo, SU nombre y SU saludo: sustituir
-- su chat propio por uno con la marca de Velai sería una regresión visible. Estas columnas
-- se sirven por GET /widget/boot (público, solo lectura) y se editan desde el panel.
-- Vacías = el widget usa la marca de Velai (hirevai.com sigue idéntico).
ALTER TABLE tenants ADD COLUMN bot_name TEXT;        -- 'Zoe', 'Faby' — cabecera y aria-labels
ALTER TABLE tenants ADD COLUMN brand_name TEXT;      -- 'Zoe Travel Spain' → cabecera 'Zoe · Zoe Travel Spain'
ALTER TABLE tenants ADD COLUMN logo_url TEXT;        -- https obligatorio; sin logo, inicial sobre brand_color
ALTER TABLE tenants ADD COLUMN brand_color TEXT;     -- #rrggbb — burbuja, cabecera, acentos
ALTER TABLE tenants ADD COLUMN brand_color_2 TEXT;   -- #rrggbb — segundo color (degradado); opcional
ALTER TABLE tenants ADD COLUMN greeting TEXT;        -- saludo de arranque (ES)
ALTER TABLE tenants ADD COLUMN greeting_en TEXT;     -- saludo de arranque (EN); vacío = se usa el ES
ALTER TABLE tenants ADD COLUMN chips_json TEXT;      -- JSON array de hasta 3 sugerencias
ALTER TABLE tenants ADD COLUMN placeholder TEXT;     -- placeholder del input
ALTER TABLE tenants ADD COLUMN wa_number TEXT;       -- dígitos wa.me del cliente (mensajes de error del widget)
ALTER TABLE tenants ADD COLUMN theme TEXT;           -- 'auto' | 'light' | 'dark' (vacío = auto)
