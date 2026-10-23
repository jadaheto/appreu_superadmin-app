-- finance-001 · Consecutivo de recibos de caja por (prefijo, año) con bloqueo de fila.
-- Reemplaza el uso de settings.receipt_sequence leído sin bloqueo (bugs B1, B2, B3 del análisis 04).
-- El contador de cada año se inicializa bajo demanda con el mayor número ya emitido
-- (`{prefijo}-{año}-NNNNNN`), por lo que los recibos existentes conservan su numeración.
-- Idempotente (MariaDB 10.11).

CREATE TABLE IF NOT EXISTS `finance_receipt_sequences` (
  `prefix` varchar(10) NOT NULL,
  `year` smallint(5) unsigned NOT NULL,
  `last_number` int(10) unsigned NOT NULL DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`prefix`, `year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
