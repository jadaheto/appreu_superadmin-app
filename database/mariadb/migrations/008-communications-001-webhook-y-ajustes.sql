-- communications-001: soporte del webhook de estados de WhatsApp, autenticación hacia n8n,
-- cifrado SMTP explícito y límites de tasa de envíos masivos. MariaDB 10.11, idempotente.

-- Búsqueda de mensajes por `wamid` al recibir recibos de entrega de Meta.
CREATE INDEX IF NOT EXISTS idx_wa_message_id ON whatsapp_log (wa_message_id);

-- Campana de notificaciones: no leídas por usuario.
CREATE INDEX IF NOT EXISTS idx_user_read ON notifications (user_id, is_read);

-- Claves nuevas de configuración (vacías = valor por defecto o integración deshabilitada).
-- Corrige además el bug #22 del legacy (migrate_marketing_ai.* insertaba en columnas inexistentes).
INSERT IGNORE INTO settings (`key`, `value`, `description`) VALUES
  ('n8n_marketing_url', '', 'URL del webhook n8n del generador de Marketing IA'),
  ('n8n_auth_token', '', 'Token Bearer enviado a los webhooks n8n (opcional)'),
  ('whatsapp_app_secret', '', 'App Secret de Meta para validar X-Hub-Signature-256 del webhook'),
  ('whatsapp_webhook_verify_token', '', 'Token de verificación del webhook de WhatsApp (hub.verify_token)'),
  ('smtp_general_encryption', '', 'Cifrado SMTP general: ssl, starttls o none (vacío: ssl en 465, starttls en otro puerto)'),
  ('email_batch_size', '10', 'Correos por lote en envíos masivos'),
  ('email_batch_pause_ms', '2000', 'Pausa en milisegundos entre lotes de correo'),
  ('whatsapp_batch_size', '20', 'Mensajes de WhatsApp por lote en envíos masivos'),
  ('whatsapp_batch_pause_ms', '1000', 'Pausa en milisegundos entre lotes de WhatsApp');
