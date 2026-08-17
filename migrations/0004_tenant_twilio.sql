-- Un cliente = una subcuenta de Twilio + la WABA del propio cliente. Twilio solo admite
-- 1 WABA por cuenta o subcuenta (error 63102), así que la subcuenta es el contenedor.
-- El auth token de cada subcuenta se guarda CIFRADO (AES-GCM, KEK en un secret del Worker).
ALTER TABLE tenants ADD COLUMN twilio_subaccount_sid TEXT;
ALTER TABLE tenants ADD COLUMN waba_id TEXT;
ALTER TABLE tenants ADD COLUMN twilio_auth_token_enc TEXT;
ALTER TABLE tenants ADD COLUMN meta_partner_status TEXT NOT NULL DEFAULT 'pendiente';
-- SQLite permite varias filas NULL en un índice único: los tenants sin subcuenta
-- (Velai, los solo-web, los prospectos) no chocan entre sí.
CREATE UNIQUE INDEX tenants_subaccount_idx ON tenants(twilio_subaccount_sid);
