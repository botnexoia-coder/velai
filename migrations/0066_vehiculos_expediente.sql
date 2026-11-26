-- Aditiva: compatible con el Worker anterior; no modifica dinero ni archivos.
ALTER TABLE g_vehiculos ADD COLUMN matricula_tipo TEXT NOT NULL DEFAULT 'desconocida' CHECK (matricula_tipo IN ('desconocida','provisional','definitiva'));
ALTER TABLE g_vehiculos ADD COLUMN matricula_pais TEXT CHECK (matricula_pais IS NULL OR (length(matricula_pais)=2 AND matricula_pais GLOB '[A-Z][A-Z]'));
CREATE TABLE g_vehiculo_matriculas (
 id TEXT PRIMARY KEY, vehiculo_id TEXT NOT NULL REFERENCES g_vehiculos(id), matricula TEXT NOT NULL,
 matricula_tipo TEXT NOT NULL, matricula_pais TEXT, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL
);
CREATE INDEX idx_vehiculo_matriculas ON g_vehiculo_matriculas(vehiculo_id,changed_at,id);
ALTER TABLE g_documentos ADD COLUMN categoria_documental TEXT CHECK (categoria_documental IS NULL OR categoria_documental IN ('permiso_circulacion','ficha_tecnica','itv','seguro','mantenimiento','multa','gps','compraventa','otros','foto'));
ALTER TABLE g_documentos ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1 CHECK (metadata_version>0);
ALTER TABLE g_documentos ADD COLUMN estado_revision TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_revision IN ('pendiente','revisado','sustituido'));
ALTER TABLE g_documentos ADD COLUMN revisado_por TEXT;
ALTER TABLE g_documentos ADD COLUMN revisado_at TEXT;
ALTER TABLE g_documentos ADD COLUMN fecha_inicio TEXT;
ALTER TABLE g_documentos ADD COLUMN nota TEXT;
ALTER TABLE g_documentos ADD COLUMN kilometros INTEGER CHECK (kilometros IS NULL OR kilometros>=0);
ALTER TABLE g_documentos ADD COLUMN ultima_revision_por TEXT;
ALTER TABLE g_documentos ADD COLUMN ultima_revision_at TEXT;
