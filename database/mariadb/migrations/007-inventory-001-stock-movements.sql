-- Contexto: inventory (inventario)
-- Migración idempotente (MariaDB 10.11).
--  * Kardex: historial de movimientos de stock (antes el ajuste sólo sobrescribía el saldo y perdía el motivo).
--  * Elimina el índice único duplicado sobre inventory_items.sku (bug 27).

CREATE TABLE IF NOT EXISTS `inventory_movements` (
  `id` BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_id` INT(10) UNSIGNED NOT NULL,
  `type` ENUM('inicial','entrada','salida','ajuste') NOT NULL,
  `quantity` INT(11) NOT NULL COMMENT 'Variación con signo (+ entra, - sale)',
  `balance_after` INT(11) NOT NULL COMMENT 'Stock resultante tras el movimiento',
  `unit_cost` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `reason` VARCHAR(255) NULL DEFAULT NULL,
  `reference_type` VARCHAR(50) NULL DEFAULT NULL,
  `reference_id` VARCHAR(50) NULL DEFAULT NULL,
  `user_id` INT(10) UNSIGNED NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  PRIMARY KEY (`id`),
  KEY `idx_movement_item_date` (`item_id`, `created_at`),
  KEY `idx_movement_user` (`user_id`),
  CONSTRAINT `inventory_movements_item_fk` FOREIGN KEY (`item_id`) REFERENCES `inventory_items` (`id`),
  CONSTRAINT `inventory_movements_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `inventory_items` DROP INDEX IF EXISTS `idx_sku`;

-- Saldo inicial del kardex para los ítems existentes con stock.
INSERT INTO `inventory_movements` (`item_id`, `type`, `quantity`, `balance_after`, `unit_cost`, `reason`)
SELECT i.`id`, 'inicial', i.`stock_quantity`, i.`stock_quantity`, i.`unit_cost`, 'Saldo migrado del sistema anterior'
FROM `inventory_items` i
WHERE i.`stock_quantity` <> 0
  AND NOT EXISTS (SELECT 1 FROM `inventory_movements` m WHERE m.`item_id` = i.`id`);
