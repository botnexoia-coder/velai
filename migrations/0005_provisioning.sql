-- Estado del aprovisionamiento automático de Twilio desde el panel. Nada aquí es
-- secreto: los tokens siguen cifrados en twilio_auth_token_enc.
ALTER TABLE tenants ADD COLUMN lead_template_status TEXT;  -- null|'pending'|'approved'|'rejected'
ALTER TABLE tenants ADD COLUMN sender_sid TEXT;            -- XE… del sender de WhatsApp
ALTER TABLE tenants ADD COLUMN sender_status TEXT;         -- CREATING|PENDING_VERIFICATION|VERIFYING|ONLINE|…
ALTER TABLE tenants ADD COLUMN provisioned_at TEXT;
