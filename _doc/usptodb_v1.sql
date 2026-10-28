/*
 Navicat Premium Data Transfer

 Source Server         : local (docker)
 Source Server Type    : MySQL
 Source Server Version : 110206 (11.2.6-MariaDB-ubu2204)
 Source Host           : 127.0.0.1:3306
 Source Schema         : usptodb

 Target Server Type    : MySQL
 Target Server Version : 110206 (11.2.6-MariaDB-ubu2204)
 File Encoding         : 65001

 Date: 19/09/2026 15:53:21
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for accounts
-- ----------------------------
DROP TABLE IF EXISTS `accounts`;
CREATE TABLE `accounts` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(191) NOT NULL,
  `password` varchar(512) NOT NULL,
  `priority` smallint(6) NOT NULL DEFAULT 100,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_used_at` datetime DEFAULT NULL,
  `success_login_count` int(10) unsigned NOT NULL DEFAULT 0,
  `failed_login_count` int(10) unsigned NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `2fa_secret` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_accounts_username` (`username`),
  KEY `idx_accounts_priority_active` (`is_active`,`priority`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Records of accounts
-- ----------------------------
BEGIN;
INSERT INTO `accounts` (`id`, `username`, `password`, `priority`, `is_active`, `last_used_at`, `success_login_count`, `failed_login_count`, `created_at`, `updated_at`, `2fa_secret`) VALUES (1, 'ingen.nice@gmail.com', 'Ya_ali^madd#110', 100, 1, '2026-09-19 07:56:59', 14, 3, '2026-09-17 12:11:38', '2026-09-19 07:56:59', 'otpauth://totp/MyUSPTO:ingen.nice%40gmail.com?secret=YMUGUPDEMRKTNDYO&issuer=MyUSPTO');
COMMIT;

-- ----------------------------
-- Table structure for files
-- ----------------------------
DROP TABLE IF EXISTS `files`;
CREATE TABLE `files` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `url_id` int(10) unsigned NOT NULL,
  `file_name` varchar(512) NOT NULL,
  `expected_size_bytes` bigint(20) unsigned DEFAULT NULL,
  `actual_size_bytes` bigint(20) unsigned DEFAULT NULL,
  `downloaded_path` varchar(1024) DEFAULT NULL,
  `status` enum('registered','downloading','downloaded','verified_healthy','size_mismatch','failed') NOT NULL DEFAULT 'registered',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_files_url_filename` (`url_id`,`file_name`),
  KEY `idx_files_status` (`status`),
  CONSTRAINT `fk_files_url` FOREIGN KEY (`url_id`) REFERENCES `urls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=73 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Records of files
-- ----------------------------
BEGIN;
COMMIT;

-- ----------------------------
-- Table structure for url_event_logs
-- ----------------------------
DROP TABLE IF EXISTS `url_event_logs`;
CREATE TABLE `url_event_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `url_id` int(10) unsigned DEFAULT NULL,
  `file_id` int(10) unsigned DEFAULT NULL,
  `level` enum('info','warning','error') NOT NULL DEFAULT 'info',
  `step` varchar(128) NOT NULL,
  `message` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_logs_file` (`file_id`),
  KEY `idx_logs_url_created` (`url_id`,`created_at`),
  CONSTRAINT `fk_logs_file` FOREIGN KEY (`file_id`) REFERENCES `files` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_logs_url` FOREIGN KEY (`url_id`) REFERENCES `urls` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=53 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Records of url_event_logs
-- ----------------------------
BEGIN;
COMMIT;

-- ----------------------------
-- Table structure for urls
-- ----------------------------
DROP TABLE IF EXISTS `urls`;
CREATE TABLE `urls` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `db_type` varchar(64) NOT NULL,
  `date_from` date NOT NULL,
  `date_to` date NOT NULL,
  `url` text NOT NULL,
  `status` enum('draft','scanning','processing','downloaded','verified','failure') NOT NULL DEFAULT 'draft',
  `extensions_to_download` varchar(255) NOT NULL,
  `exclude_pattern_regex` varchar(512) DEFAULT NULL,
  `files_found_count` int(10) unsigned NOT NULL DEFAULT 0,
  `downloaded_files_count` int(10) unsigned NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `processing_started_at` datetime DEFAULT NULL,
  `download_finished_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_urls_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------
-- Records of urls
-- ----------------------------
BEGIN;
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (1, 'ptgrmp2', '2023-01-01', '2023-01-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-01-01&fileDataToDate=2023-01-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 6, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 08:05:14');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (2, 'ptgrmp2', '2023-02-01', '2023-02-28', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-02-01&fileDataToDate=2023-02-28', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 4, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 08:04:53');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (3, 'ptgrmp2', '2023-03-01', '2023-03-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-03-01&fileDataToDate=2023-03-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (4, 'ptgrmp2', '2023-04-01', '2023-04-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-04-01&fileDataToDate=2023-04-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (5, 'ptgrmp2', '2023-05-01', '2023-05-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-05-01&fileDataToDate=2023-05-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (6, 'ptgrmp2', '2023-06-01', '2023-06-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-06-01&fileDataToDate=2023-06-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (7, 'ptgrmp2', '2023-07-01', '2023-07-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-07-01&fileDataToDate=2023-07-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (8, 'ptgrmp2', '2023-08-01', '2023-08-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-08-01&fileDataToDate=2023-08-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (9, 'ptgrmp2', '2023-09-01', '2023-09-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-09-01&fileDataToDate=2023-09-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (10, 'ptgrmp2', '2023-10-01', '2023-10-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-10-01&fileDataToDate=2023-10-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (11, 'ptgrmp2', '2023-11-01', '2023-11-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-11-01&fileDataToDate=2023-11-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (12, 'ptgrmp2', '2023-12-01', '2023-12-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2023-12-01&fileDataToDate=2023-12-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (13, 'ptgrmp2', '2024-01-01', '2024-01-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-01-01&fileDataToDate=2025-01-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (14, 'ptgrmp2', '2024-02-01', '2024-02-28', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-02-01&fileDataToDate=2025-02-28', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (15, 'ptgrmp2', '2024-03-01', '2024-03-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-03-01&fileDataToDate=2025-03-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (16, 'ptgrmp2', '2024-04-01', '2024-04-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-04-01&fileDataToDate=2025-04-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (17, 'ptgrmp2', '2024-05-01', '2024-05-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-05-01&fileDataToDate=2025-05-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (18, 'ptgrmp2', '2024-06-01', '2024-06-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-06-01&fileDataToDate=2025-06-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (19, 'ptgrmp2', '2024-07-01', '2024-07-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-07-01&fileDataToDate=2025-07-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (20, 'ptgrmp2', '2024-08-01', '2024-08-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-08-01&fileDataToDate=2025-08-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (21, 'ptgrmp2', '2024-09-01', '2024-09-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-09-01&fileDataToDate=2025-09-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (22, 'ptgrmp2', '2024-10-01', '2024-10-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-10-01&fileDataToDate=2025-10-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (23, 'ptgrmp2', '2024-11-01', '2024-11-30', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-11-01&fileDataToDate=2025-11-30', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
INSERT INTO `urls` (`id`, `db_type`, `date_from`, `date_to`, `url`, `status`, `extensions_to_download`, `exclude_pattern_regex`, `files_found_count`, `downloaded_files_count`, `created_at`, `processing_started_at`, `download_finished_at`, `updated_at`) VALUES (24, 'ptgrmp2', '2024-12-01', '2024-12-31', 'https://data.uspto.gov/bulkdata/datasets/ptgrmp2?fileDataFromDate=2025-12-01&fileDataToDate=2025-12-31', 'draft', 'pdf,zip', 'maint_|M\\d+(?=\\.tar$)', 0, 0, '2026-09-18 07:41:14', '2026-09-18 09:34:20', '2026-09-18 21:34:27', '2026-09-19 07:51:48');
COMMIT;

SET FOREIGN_KEY_CHECKS = 1;
