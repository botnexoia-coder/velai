-- Precio autoritativo del evento y fotografía económica de cada reserva.
-- Los campos son opcionales para mantener compatibles los eventos y reservas anteriores.
ALTER TABLE tenant_events ADD COLUMN individual_price_cents INTEGER;
ALTER TABLE tenant_events ADD COLUMN couple_price_cents INTEGER;
ALTER TABLE tenant_events ADD COLUMN advance_discount_percent INTEGER;
ALTER TABLE tenant_events ADD COLUMN advance_individual_price_cents INTEGER;
ALTER TABLE tenant_events ADD COLUMN advance_couple_price_cents INTEGER;
ALTER TABLE tenant_events ADD COLUMN promotion_label TEXT;
ALTER TABLE tenant_events ADD COLUMN promotion_terms TEXT;
ALTER TABLE tenant_events ADD COLUMN payment_method TEXT;
ALTER TABLE tenant_events ADD COLUMN payment_destination TEXT;
ALTER TABLE tenant_events ADD COLUMN payment_recipient TEXT;

ALTER TABLE event_reservations ADD COLUMN individual_tickets INTEGER;
ALTER TABLE event_reservations ADD COLUMN couple_tickets INTEGER;
ALTER TABLE event_reservations ADD COLUMN quoted_total_cents INTEGER;
ALTER TABLE event_reservations ADD COLUMN currency TEXT;
ALTER TABLE event_reservations ADD COLUMN promotion_applied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_reservations ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pending';

-- Promoción aprobada por el organizador: solo para reserva pagada anticipadamente
-- mediante NAYA. Los importes históricos quedan intactos porque no se recalculan.
UPDATE tenant_events SET
  individual_price_cents=3000,
  couple_price_cents=5000,
  advance_discount_percent=10,
  advance_individual_price_cents=2700,
  advance_couple_price_cents=4500,
  promotion_label='Reserva anticipada con NAYA',
  promotion_terms='10 % de descuento con pago anticipado verificado. Si la confirmación no llega, mostrar en la entrada el comprobante y la conversación de WhatsApp',
  payment_method='bizum',
  payment_destination='641805822',
  payment_recipient='Jonathan GP',
  updated_at=datetime('now')
WHERE tenant_id='653aaff5-8b17-4d71-a181-aa4b3c9f688d'
  AND slug='noche-solteros-2026-10-30';
