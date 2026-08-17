# Timermayu Webhook Debug

Receptor temporal, sin dependencias externas, para probar los webhooks de 3i.

- Receptor: `POST /webhooks/3i`
- Panel protegido: `GET /debug/webhooks`
- Salud: `GET /health`

El panel permite guardar el `whsec_...` una sola vez y consultar las últimas 100 solicitudes. Los cuerpos se conservan en el volumen privado `webhook_data`. La firma se valida sobre `event_id.timestamp.raw_body`, con tolerancia de cinco minutos, y los eventos repetidos se identifican por `Webhook-Id`.
