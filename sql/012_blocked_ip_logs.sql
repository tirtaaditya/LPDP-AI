/*
  012_blocked_ip_logs.sql
  Riwayat IP yang ditolak whitelist (setiap attempt = 1 row).
*/
IF OBJECT_ID(N'dbo.blocked_ip_logs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.blocked_ip_logs (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ip NVARCHAR(64) NOT NULL,
    user_id INT NULL,
    username NVARCHAR(100) NULL,
    method NVARCHAR(16) NULL,
    path NVARCHAR(500) NULL,
    user_agent NVARCHAR(500) NULL,
    reason NVARCHAR(500) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_blocked_ip_created DEFAULT (SYSUTCDATETIME())
  );
  CREATE INDEX IX_blocked_ip_logs_ip_created ON dbo.blocked_ip_logs (ip, created_at DESC);
  CREATE INDEX IX_blocked_ip_logs_created ON dbo.blocked_ip_logs (created_at DESC);
  PRINT 'Created dbo.blocked_ip_logs';
END
ELSE
  PRINT 'Skip dbo.blocked_ip_logs (already exists)';
GO
