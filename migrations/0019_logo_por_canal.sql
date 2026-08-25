-- Imagen por canal (pedido de Juan): hasta ahora logo_url servía para el widget web Y
-- para la foto de WhatsApp, y no siempre conviene la misma (WhatsApp la recorta en
-- círculo y exige 640x640; el widget luce mejor con el logotipo completo).
-- logo_url sigue siendo la del chat de la web; esta es la de WhatsApp.
ALTER TABLE tenants ADD COLUMN logo_wa_url TEXT;
