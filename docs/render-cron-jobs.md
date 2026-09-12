# Manifiesto Render Cron BetterP (retirado)

Render Cron dejó de ser una superficie operativa de BetterP. Este nombre de
archivo se conserva únicamente para no romper referencias históricas.

La autoridad vigente está en:

- `backend/billing/saas_automation_manifest.py`;
- `ops/vultr/betterp.saas.cron`;
- `ops/vultr/compose.saas-scheduler.yaml`;
- `scripts/vultr_saas_cron_manifest.py`;
- `Backoffice > Salud > Crons`.

No deben recrearse keepalive ni jobs de Vende Fácil, inbox, cobranza o Renta
Fácil como requisito de BetterP Commerce. La publicación programada de Marketing
y la confirmación de TikTok son excepciones activas y viven únicamente en el
scheduler de Vultr.
