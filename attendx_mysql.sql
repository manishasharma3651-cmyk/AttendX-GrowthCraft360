-- ============================================================
--  AttendX — MySQL Database Schema + Sample Data
--  Import karne ke liye:
--    1. MySQL mein ek database banao: CREATE DATABASE attendx;
--    2. Phir import karo: mysql -u root -p attendx < attendx_mysql.sql
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ── USERS TABLE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`        VARCHAR(20)  NOT NULL,
  `name`      VARCHAR(100) NOT NULL,
  `username`  VARCHAR(50)  NOT NULL,
  `password`  VARCHAR(255) NOT NULL,
  `role`      ENUM('admin','employee') NOT NULL DEFAULT 'employee',
  `dept`      VARCHAR(50)  DEFAULT NULL,
  `salary`    DECIMAL(12,2) DEFAULT 0.00,
  `email`     VARCHAR(100) DEFAULT NULL,
  `join_date`    DATE         DEFAULT NULL,
  `bank_ac_no`   VARCHAR(20)  DEFAULT NULL COMMENT 'Bank Account Number',
  `bank_name`    VARCHAR(100) DEFAULT NULL COMMENT 'Bank Name',
  `bank_branch`  VARCHAR(100) DEFAULT NULL COMMENT 'Branch Name',
  `bank_ifsc`    VARCHAR(20)  DEFAULT NULL COMMENT 'IFSC Code',
  `aadhar_no`    VARCHAR(12)  DEFAULT NULL COMMENT 'Aadhaar Number',
  `pan_no`       VARCHAR(10)  DEFAULT NULL COMMENT 'PAN Card Number',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── ATTENDANCE TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `attendance` (
  `id`          VARCHAR(20)  NOT NULL,
  `user_id`     VARCHAR(20)  NOT NULL,
  `date`        DATE         NOT NULL,
  `check_in`    TIME         DEFAULT NULL,
  `check_out`   TIME         DEFAULT NULL,
  `lunch_in`    TIME         DEFAULT NULL,
  `lunch_out`   TIME         DEFAULT NULL,
  `break_mins`  INT          DEFAULT 0,
  `net_mins`    INT          DEFAULT 0,
  `is_late`          TINYINT(1)   DEFAULT 0   COMMENT '1 if check-in >= 11:00',
  `is_half_day`      TINYINT(1)   DEFAULT 0   COMMENT '1 if check-in >= 12:00',
  `checkin_location`  VARCHAR(300) DEFAULT NULL COMMENT 'Check-in location address',
  `checkout_location` VARCHAR(300) DEFAULT NULL COMMENT 'Check-out location address',
  `lunch_in_location`  VARCHAR(300) DEFAULT NULL COMMENT 'Lunch-in location address',
  `lunch_out_location` VARCHAR(300) DEFAULT NULL COMMENT 'Lunch-out location address',
  PRIMARY KEY (`id`),
  KEY `idx_user_date` (`user_id`, `date`),
  CONSTRAINT `fk_att_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── LEAVES TABLE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `leaves` (
  `id`          VARCHAR(20)  NOT NULL,
  `user_id`     VARCHAR(20)  NOT NULL,
  `type`        ENUM('paid','unpaid','sick','casual') NOT NULL DEFAULT 'paid',
  `from_date`   DATE         NOT NULL,
  `to_date`     DATE         NOT NULL,
  `days`        INT          DEFAULT 1,
  `reason`      TEXT         DEFAULT NULL,
  `applied_on`  DATE         DEFAULT NULL,
  `status`      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  PRIMARY KEY (`id`),
  KEY `idx_leave_user` (`user_id`),
  CONSTRAINT `fk_leave_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
--  SAMPLE DATA
--  Note: Passwords are bcrypt hashed (plain: admin123 / pass123 / manisha01)
--  For production, re-hash using Python: bcrypt.hashpw(pwd.encode(), bcrypt.gensalt())
-- ============================================================

INSERT INTO `users` (`id`,`name`,`username`,`password`,`role`,`dept`,`salary`,`email`,`join_date`) VALUES
('u1','Admin User','admin','$2b$12$PLACEHOLDER_HASH_ADMIN','admin','Management',80000.00,'admin@attendx.com','2022-01-01'),
('u2','John Sharma','john','$2b$12$PLACEHOLDER_HASH_JOHN','employee','Engineering',55000.00,'john@attendx.com','2023-03-15'),
('u3','Priya Patel','priya','$2b$12$PLACEHOLDER_HASH_PRIYA','employee','Design',48000.00,'priya@attendx.com','2023-06-01'),
('u4','Rahul Gupta','rahul','$2b$12$PLACEHOLDER_HASH_RAHUL','employee','Marketing',42000.00,'rahul@attendx.com','2023-09-10'),
('u5','Anjali Singh','anjali','$2b$12$PLACEHOLDER_HASH_ANJALI','employee','HR',45000.00,'anjali@attendx.com','2022-11-20'),
('u6','Manisha Sharma','manisha','$2b$12$PLACEHOLDER_HASH_MANISHA','employee','Engineering',25000.00,'manishasharma3651@gmail.com','2026-04-17');

INSERT INTO `attendance` (`id`,`user_id`,`date`,`check_in`,`check_out`,`lunch_in`,`lunch_out`,`break_mins`,`net_mins`,`is_late`,`is_half_day`) VALUES
('att001','u2',CURDATE() - INTERVAL 5 DAY,'09:00:00','18:00:00','13:00:00','13:40:00',40,500,0,0),
('att002','u3',CURDATE() - INTERVAL 5 DAY,'08:45:00','17:30:00','12:55:00','13:30:00',35,475,0,0),
('att003','u4',CURDATE() - INTERVAL 5 DAY,'11:10:00','17:00:00','13:15:00','13:50:00',35,310,1,0),
('att004','u5',CURDATE() - INTERVAL 5 DAY,'12:05:00','17:00:00','14:00:00','14:35:00',35,240,1,1),
('att005','u2',CURDATE() - INTERVAL 4 DAY,'09:05:00','18:05:00','13:10:00','13:45:00',35,505,0,0),
('att006','u3',CURDATE() - INTERVAL 4 DAY,'08:50:00','17:20:00','13:00:00','13:40:00',40,470,0,0),
('att007','u4',CURDATE() - INTERVAL 3 DAY,'09:00:00','17:30:00','13:00:00','13:30:00',30,480,0,0),
('att008','u5',CURDATE() - INTERVAL 3 DAY,'09:00:00','17:00:00','13:00:00','13:35:00',35,445,0,0),
('att009','u2',CURDATE() - INTERVAL 2 DAY,'09:10:00','18:10:00','13:00:00','13:45:00',45,500,0,0),
('att010','u3',CURDATE() - INTERVAL 2 DAY,'08:55:00','17:25:00','13:00:00','13:30:00',30,480,0,0),
('att011','u4',CURDATE() - INTERVAL 1 DAY,'11:30:00','17:30:00','13:30:00','14:00:00',30,300,1,0),
('att012','u5',CURDATE() - INTERVAL 1 DAY,'08:45:00','17:00:00','13:00:00','13:40:00',40,455,0,0);

INSERT INTO `leaves` (`id`,`user_id`,`type`,`from_date`,`to_date`,`days`,`reason`,`applied_on`,`status`) VALUES
('lv001','u2','paid','2024-12-20','2024-12-22',3,'Family trip','2024-12-15','approved'),
('lv002','u3','sick','2025-01-05','2025-01-06',2,'Not feeling well','2025-01-05','approved'),
('lv003','u4','unpaid','2025-02-10','2025-02-10',1,'Personal work','2025-02-08','rejected'),
('lv004','u5','casual','2025-03-15','2025-03-15',1,'Personal errand','2025-03-14','pending');

-- ============================================================
--  NOTE: Backend (app.py) ko MySQL se connect karne ke liye
--  pip install flask flask-cors pyjwt bcrypt PyMySQL
--  aur app.py mein get_db() function ko neeche wale se replace karo:
--
--  import pymysql
--  DB_CONFIG = {
--    'host': 'localhost',
--    'user': 'root',
--    'password': 'your_password',
--    'db': 'attendx',
--    'charset': 'utf8mb4',
--    'cursorclass': pymysql.cursors.DictCursor
--  }
--  def get_db():
--      return pymysql.connect(**DB_CONFIG)
--
--  SQLite se MySQL migrate karte waqt ? ko %s se replace karna hoga
--  sabhi SQL queries mein.
-- ============================================================

-- ── DOCUMENTS TABLE ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `documents` (
  `id`          VARCHAR(20)   NOT NULL,
  `user_id`     VARCHAR(20)   NOT NULL,
  `doc_type`    ENUM('aadhar','pan','marksheet','passbook') NOT NULL,
  `file_data`   LONGTEXT      NOT NULL COMMENT 'Base64 encoded file',
  `file_name`   VARCHAR(200)  DEFAULT NULL,
  `file_type`   VARCHAR(50)   DEFAULT NULL,
  `uploaded_at` DATE          DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_doc` (`user_id`, `doc_type`),
  KEY `idx_doc_user` (`user_id`),
  CONSTRAINT `fk_doc_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ── UPGRADE: Add bank/KYC columns if upgrading from old schema ──
-- (Safe to run even if columns already exist — MySQL 8.0+ with IF NOT EXISTS)
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `bank_ac_no`  VARCHAR(20)  DEFAULT NULL COMMENT 'Bank Account Number',
  ADD COLUMN IF NOT EXISTS `bank_name`   VARCHAR(100) DEFAULT NULL COMMENT 'Bank Name',
  ADD COLUMN IF NOT EXISTS `bank_branch` VARCHAR(100) DEFAULT NULL COMMENT 'Branch Name',
  ADD COLUMN IF NOT EXISTS `bank_ifsc`   VARCHAR(20)  DEFAULT NULL COMMENT 'IFSC Code',
  ADD COLUMN IF NOT EXISTS `aadhar_no`   VARCHAR(12)  DEFAULT NULL COMMENT 'Aadhaar Number',
  ADD COLUMN IF NOT EXISTS `pan_no`      VARCHAR(10)  DEFAULT NULL COMMENT 'PAN Card Number';


-- ── UPGRADE: Add location columns to attendance if upgrading from old schema ──
ALTER TABLE `attendance`
  ADD COLUMN IF NOT EXISTS `checkin_location`  VARCHAR(300) DEFAULT NULL COMMENT 'Check-in location address',
  ADD COLUMN IF NOT EXISTS `checkout_location` VARCHAR(300) DEFAULT NULL COMMENT 'Check-out location address',
  ADD COLUMN IF NOT EXISTS `lunch_in_location`  VARCHAR(300) DEFAULT NULL COMMENT 'Lunch-in location address',
  ADD COLUMN IF NOT EXISTS `lunch_out_location` VARCHAR(300) DEFAULT NULL COMMENT 'Lunch-out location address';
