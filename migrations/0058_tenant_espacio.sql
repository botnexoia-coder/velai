-- Espacio de Velai por cliente (OLA-ESPACIOS.md). Hasta ahora el selector «Espacio» del
-- panel tenía dos clientes escritos en el código y Velai nunca podía atender dentro.
-- espacio_velai   = el cliente aparece en el selector Espacio de los admins de Velai.
-- espacio_atender = dentro de ese espacio, Velai puede tomar el control y responder.
-- Solo empresas propias o con acuerdo firmado; se activa desde la ficha del cliente.
ALTER TABLE tenants ADD COLUMN espacio_velai INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN espacio_atender INTEGER NOT NULL DEFAULT 0;

-- Los dos espacios que ya existían (Diálogos y Naya) son empresas propias: siguen en el
-- selector y además pasan a poder atenderse. El resto queda a 0, exactamente como hoy.
UPDATE tenants SET espacio_velai = 1, espacio_atender = 1 WHERE slug IN ('dialogos', 'colegiale-sevilla');
