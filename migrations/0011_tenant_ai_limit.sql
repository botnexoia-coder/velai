-- Presupuesto de IA POR TENANT (SPRINT-BLINDAJE): tope diario de llamadas al modelo
-- de un cliente concreto. NULL = usa el default del entorno (AI_TENANT_DAILY_LIMIT,
-- hoy 300). Permite estrangular a UN cliente con tráfico anómalo sin deploy: la caché
-- de tenants en KV (5 min) aplica el cambio casi al momento. Se edita por SQL/consola;
-- exponerlo en el panel queda fuera de este sprint.
ALTER TABLE tenants ADD COLUMN ai_daily_limit INTEGER;
