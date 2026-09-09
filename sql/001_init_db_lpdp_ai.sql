/*
==============================================================================
  AI LPDP — SQL Server schema + seed
  Database : db_lpdp_ai
  Server   : 10.44.200.72 (sesuaikan)

  Cara jalankan (SSMS / Azure Data Studio):
  1. Connect ke SQL Server
  2. Pastikan database db_lpdp_ai sudah ada (atau uncomment CREATE DATABASE)
  3. Execute seluruh script ini

  Seed users (password di-hash bcrypt):
    admin     / Admin@LPDP2026   role = admin
    api_user  / Api@LPDP2026     role = api
==============================================================================
*/

USE [db_lpdp_ai];
GO

/* Uncomment jika database belum ada:
IF DB_ID(N'db_lpdp_ai') IS NULL
BEGIN
  CREATE DATABASE [db_lpdp_ai];
END
GO
USE [db_lpdp_ai];
GO
*/

SET NOCOUNT ON;
GO

/* -------------------------------------------------------------------------- */
/* 1) users — role: admin | api                                               */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    username      NVARCHAR(100) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    role          NVARCHAR(20)  NOT NULL,
    is_active     BIT NOT NULL CONSTRAINT DF_users_active DEFAULT (1),
    created_at    DATETIME2 NOT NULL CONSTRAINT DF_users_created DEFAULT (SYSUTCDATETIME()),
    updated_at    DATETIME2 NOT NULL CONSTRAINT DF_users_updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_users_username UNIQUE (username),
    CONSTRAINT CK_users_role CHECK (role IN (N'admin', N'api'))
  );
  PRINT 'Created dbo.users';
END
ELSE
  PRINT 'Skip dbo.users (already exists)';
GO

/* -------------------------------------------------------------------------- */
/* 2) settings                                                                */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.settings (
    [key]      NVARCHAR(100) NOT NULL PRIMARY KEY,
    [value]    NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_settings_updated DEFAULT (SYSUTCDATETIME())
  );
  PRINT 'Created dbo.settings';
END
ELSE
  PRINT 'Skip dbo.settings (already exists)';
GO

/* -------------------------------------------------------------------------- */
/* 3) whitelist_ips — per API user (user_id → users.id role=api)              */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.whitelist_ips', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.whitelist_ips (
    id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    user_id    INT NOT NULL,
    ip         NVARCHAR(64) NOT NULL,
    label      NVARCHAR(200) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_whitelist_created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_whitelist_user_ip UNIQUE (user_id, ip),
    CONSTRAINT FK_whitelist_user FOREIGN KEY (user_id)
      REFERENCES dbo.users(id) ON DELETE CASCADE
  );
  PRINT 'Created dbo.whitelist_ips';
END
ELSE
  PRINT 'Skip dbo.whitelist_ips (already exists)';
GO

/* -------------------------------------------------------------------------- */
/* 4) api_tokens — per API user                                               */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.api_tokens', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.api_tokens (
    id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    user_id      INT NOT NULL,
    name         NVARCHAR(200) NOT NULL,
    token_hash   NVARCHAR(128) NOT NULL,
    token_prefix NVARCHAR(32) NOT NULL,
    is_active    BIT NOT NULL CONSTRAINT DF_tokens_active DEFAULT (1),
    created_at   DATETIME2 NOT NULL CONSTRAINT DF_tokens_created DEFAULT (SYSUTCDATETIME()),
    revoked_at   DATETIME2 NULL,
    CONSTRAINT UQ_api_tokens_hash UNIQUE (token_hash),
    CONSTRAINT FK_tokens_user FOREIGN KEY (user_id)
      REFERENCES dbo.users(id) ON DELETE CASCADE
  );
  PRINT 'Created dbo.api_tokens';
END
ELSE
  PRINT 'Skip dbo.api_tokens (already exists)';
GO

/* -------------------------------------------------------------------------- */
/* 5) request_logs                                                            */
/* -------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.request_logs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.request_logs (
    id           BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    request_id   NVARCHAR(64) NULL,
    method       NVARCHAR(16) NULL,
    [path]       NVARCHAR(500) NULL,
    status_code  INT NULL,
    ip           NVARCHAR(64) NULL,
    duration_ms  INT NULL,
    message      NVARCHAR(1000) NULL,
    created_at   DATETIME2 NOT NULL CONSTRAINT DF_logs_created DEFAULT (SYSUTCDATETIME())
  );
  PRINT 'Created dbo.request_logs';
END
ELSE
  PRINT 'Skip dbo.request_logs (already exists)';
GO

/* -------------------------------------------------------------------------- */
/* 6) Seed settings                                                           */
/* -------------------------------------------------------------------------- */
MERGE dbo.settings AS t
USING (VALUES
  (N'openai_api_key',        N''),
  (N'openai_model',          N'gpt-4o-mini'),
  (N'temperature',           N'0.2'),
  (N'max_tokens',            N'2000'),
  (N'system_prompt',         N'You are a data extraction assistant. Always respond with valid JSON only. Prefer shape: {"status":"success","data":{...}}. If extraction fails, use {"status":"error","data":null,"message":"..."}. Do not wrap in markdown.'),
  (N'max_upload_mb',         N'10'),
  (N'allowed_file_types',    N'pdf,docx,txt'),
  (N'ip_whitelist_enabled',  N'false')
) AS s ([key], [value])
ON t.[key] = s.[key]
WHEN NOT MATCHED THEN
  INSERT ([key], [value]) VALUES (s.[key], s.[value]);
PRINT 'Seeded dbo.settings';
GO

/* -------------------------------------------------------------------------- */
/* 7) Seed users                                                              */
/*     password_hash = bcrypt (cost 10)                                       */
/*     admin    -> Admin@LPDP2026                                             */
/*     api_user -> Api@LPDP2026                                               */
/* -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE username = N'admin')
BEGIN
  INSERT INTO dbo.users (username, password_hash, role, is_active)
  VALUES (
    N'admin',
    N'$2a$10$IHjm0psnMNMaHbLwevBCZuGu.X6Kxdf8Ds59wCu9yASzO1mkyaW/y',
    N'admin',
    1
  );
  PRINT 'Seeded user admin (role=admin)';
END
ELSE
  PRINT 'Skip user admin (already exists)';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE username = N'api_user')
BEGIN
  INSERT INTO dbo.users (username, password_hash, role, is_active)
  VALUES (
    N'api_user',
    N'$2a$10$Z/wiGOlfOd8tc6sQDfhNNuAnzkSYEKLhGMW9Nbj8kkasTOimg1bP.',
    N'api',
    1
  );
  PRINT 'Seeded user api_user (role=api)';
END
ELSE
  PRINT 'Skip user api_user (already exists)';
GO

/* -------------------------------------------------------------------------- */
/* 8) (Opsional) contoh whitelist IP untuk api_user                           */
/*     Uncomment & sesuaikan IP jika ingin langsung aktif.                    */
/*     Jangan lupa set settings.ip_whitelist_enabled = 'true' di Admin UI.    */
/* -------------------------------------------------------------------------- */
/*
DECLARE @apiUserId INT = (SELECT id FROM dbo.users WHERE username = N'api_user' AND role = N'api');

IF @apiUserId IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM dbo.whitelist_ips WHERE user_id = @apiUserId AND ip = N'10.44.200.10'
)
BEGIN
  INSERT INTO dbo.whitelist_ips (user_id, ip, label)
  VALUES (@apiUserId, N'10.44.200.10', N'Office example');
  PRINT 'Seeded example whitelist IP for api_user';
END
*/

/* -------------------------------------------------------------------------- */
/* 9) Verify                                                                  */
/* -------------------------------------------------------------------------- */
SELECT 'users' AS [table_name], COUNT(*) AS [rows] FROM dbo.users
UNION ALL SELECT 'settings', COUNT(*) FROM dbo.settings
UNION ALL SELECT 'whitelist_ips', COUNT(*) FROM dbo.whitelist_ips
UNION ALL SELECT 'api_tokens', COUNT(*) FROM dbo.api_tokens
UNION ALL SELECT 'request_logs', COUNT(*) FROM dbo.request_logs;

SELECT id, username, role, is_active, created_at
FROM dbo.users
ORDER BY role, username;

PRINT '=== DONE: db_lpdp_ai schema + seed ===';
GO
