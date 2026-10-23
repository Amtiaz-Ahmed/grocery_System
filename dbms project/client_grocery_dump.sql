-- Grocery Store database export with current application data.
-- Retired login and customer-cart tables are intentionally omitted.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
CREATE DATABASE IF NOT EXISTS `grocery_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `grocery_db`;

CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `category_name_unique` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `categories` (`id`, `name`) VALUES
  (1, 'Packaging'),
  (2, 'Shoppers');

CREATE TABLE `customers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `phone_number` varchar(15) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `customers` (`id`, `name`, `phone_number`, `created_at`) VALUES
  (1, 'User-262590', 'N/A', '2026-10-21 15:57:42.000'),
  (2, 'User-285028', 'N/A', '2026-10-21 15:58:05.000'),
  (3, 'User-915757', 'N/A', '2026-10-21 16:08:35.000');

CREATE TABLE `inventory_units` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_unit_name_unique` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=679 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `inventory_units` (`id`, `name`) VALUES
  (24, '1 kg'),
  (20, '1 liter'),
  (21, '1.5 liter'),
  (22, '2 liter'),
  (18, '300 ml'),
  (23, '500 g'),
  (19, '500 ml'),
  (14, 'bottle'),
  (11, 'box'),
  (13, 'bunch'),
  (15, 'can'),
  (16, 'cup'),
  (12, 'dozen'),
  (9, 'each'),
  (2, 'g'),
  (1, 'kg'),
  (8, 'l'),
  (4, 'lb'),
  (5, 'liter'),
  (6, 'litre'),
  (7, 'ml'),
  (3, 'oz'),
  (10, 'pack'),
  (17, 'packet'),
  (277, 'piece');

CREATE TABLE `order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `unit_price` decimal(10,3) NOT NULL,
  `unit` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `order_items` (`id`, `order_id`, `product_id`, `quantity`, `unit_price`, `unit`) VALUES
  (1, 1, 15, 500, 0.51, 'g'),
  (2, 2, 15, 200, 0.51, 'g'),
  (3, 3, 18, 12, 150, 'piece');

CREATE TABLE `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cust_id` int(11) NOT NULL,
  `admin_id` int(10) DEFAULT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `order_date` timestamp NOT NULL DEFAULT current_timestamp(),
  `buyer_name` varchar(100) DEFAULT 'Walk-in',
  `buyer_phone` varchar(15) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `cust_id` (`cust_id`),
  CONSTRAINT `orders_cust_fk` FOREIGN KEY (`cust_id`) REFERENCES `customers` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `orders` (`id`, `cust_id`, `admin_id`, `total_amount`, `order_date`, `buyer_name`, `buyer_phone`) VALUES
  (1, 1, 101, 255, '2026-10-21 15:57:42.000', 'User-262590', NULL),
  (2, 2, 101, 102, '2026-10-21 15:58:05.000', 'User-285028', NULL),
  (3, 3, 101, 1800, '2026-10-21 16:08:35.000', 'User-915757', NULL);

CREATE TABLE `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `price` decimal(10,3) NOT NULL,
  `unit` varchar(11) NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `stock` int(11) DEFAULT 100,
  `low_stock_threshold` decimal(10,2) NOT NULL DEFAULT 10.00,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `products` (`id`, `name`, `price`, `unit`, `category`, `stock`, `low_stock_threshold`) VALUES
  (1, '7x9 Suffyan', 0.512, 'g', 'Packaging', 25000, 10),
  (2, '8x11 Suffyan', 0.5, 'g', 'Packaging', 25000, 10),
  (3, '10x14 Suffyan', 0.5, 'g', 'Packaging', 25000, 10),
  (4, '12x16 Suffyan', 0.5, 'g', 'Packaging', 25000, 10),
  (5, '14x18 Suffyan', 0.5, 'g', 'Packaging', 25000, 10),
  (6, '10x14 Thank You', 0.395, 'g', 'Packaging', 25000, 10),
  (7, '12x16 Thank You', 0.395, 'g', 'Packaging', 25000, 10),
  (8, '14x18 Thank You', 0.395, 'g', 'Packaging', 25000, 10),
  (9, '17x23 Thank You', 0.395, 'g', 'Packaging', 25000, 10),
  (10, '5x6 HD', 0.51, 'g', 'Packaging', 25000, 10),
  (11, '5x7 HD', 0.51, 'g', 'Packaging', 25000, 10),
  (12, '6x8 HD', 0.51, 'g', 'Packaging', 25000, 10),
  (13, '7x10 HD', 0.51, 'g', 'Packaging', 25000, 10),
  (14, '8x12 HD', 0.51, 'g', 'Packaging', 25000, 10),
  (15, '10x12 HD', 0.51, 'g', 'Shoppers', 24300, 10),
  (16, '10x14 HD', 0.51, 'g', 'Packaging', 25000, 10),
  (18, 'cups', 150, 'piece', 'Packaging', 1988, 10);

CREATE TABLE `stock_audit` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `change_qty` decimal(10,2) NOT NULL,
  `stock_after` decimal(10,2) NOT NULL,
  `reason` enum('sale','restock','adjustment','new_product','edit') NOT NULL,
  `reference_id` int(11) DEFAULT NULL,
  `admin_id` int(10) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `stock_audit` (`id`, `product_id`, `change_qty`, `stock_after`, `reason`, `reference_id`, `admin_id`, `note`, `created_at`) VALUES
  (1, 15, -500, 24500, 'sale', 1, 101, 'Order #1', '2026-10-21 15:57:42.000'),
  (2, 15, -200, 24300, 'sale', 2, 101, 'Order #2', '2026-10-21 15:58:05.000'),
  (3, 17, 1, 1, 'new_product', NULL, NULL, 'Initial stock', '2026-10-21 16:05:49.000'),
  (4, 18, 2000, 2000, 'new_product', NULL, 101, 'Initial stock', '2026-10-21 16:08:13.000'),
  (5, 18, -12, 1988, 'sale', 3, 101, 'Order #3', '2026-10-21 16:08:35.000'),
  (6, 19, 12, 12, 'new_product', NULL, NULL, 'Initial stock', '2026-10-21 17:32:19.000'),
  (7, 19, 8, 20, 'edit', NULL, NULL, 'Product stock adjusted in edit', '2026-10-21 17:32:19.000'),
  (8, 19, 3, 23, 'restock', NULL, NULL, 'QA restock', '2026-10-21 17:32:19.000');

SET FOREIGN_KEY_CHECKS = 1;
