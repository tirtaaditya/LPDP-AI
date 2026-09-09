/*
==============================================================================
  AI extract logs — prompt, file, AI response, token/user
  Jalankan di SSMS terhadap db_lpdp_ai
==============================================================================
*/

USE [db_lpdp_ai];
GO

IF OBJECT_ID(N'dbo.ai_extract_logs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ai_extract_logs (
    id              BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    request_id      NVARCHAR(64) NULL,
    user_id         INT NULL,
    username        NVARCHAR(100) NULL,
    auth_type       NVARCHAR(20) NULL,          -- jwt | static
    token_id        INT NULL,
    token_name      NVARCHAR(200) NULL,
    token_prefix    NVARCHAR(32) NULL,
    prompt          NVARCHAR(MAX) NULL,
    schema_hint     NVARCHAR(MAX) NULL,
    has_file        BIT NOT NULL CONSTRAINT DF_ai_logs_has_file DEFAULT (0),
    file_name       NVARCHAR(255) NULL,
    file_size       INT NULL,
    file_text       NVARCHAR(MAX) NULL,        -- extracted text (may be truncated)
    ai_response     NVARCHAR(MAX) NULL,        -- raw / normalized JSON response
    response_status NVARCHAR(20) NULL,         -- success | error
    http_status     INT NULL,
    model           NVARCHAR(100) NULL,
    prompt_tokens   INT NULL,
    completion_tokens INT NULL,
    total_tokens    INT NULL,
    ip              NVARCHAR(64) NULL,
    duration_ms     INT NULL,
    error_message   NVARCHAR(1000) NULL,
    created_at      DATETIME2 NOT NULL CONSTRAINT DF_ai_logs_created DEFAULT (SYSUTCDATETIME())
  );

  CREATE INDEX IX_ai_extract_logs_created ON dbo.ai_extract_logs (created_at DESC);
  CREATE INDEX IX_ai_extract_logs_user ON dbo.ai_extract_logs (user_id, created_at DESC);

  PRINT 'Created dbo.ai_extract_logs';
END
ELSE
  PRINT 'Skip dbo.ai_extract_logs (already exists)';
GO

SELECT TOP 5 * FROM dbo.ai_extract_logs ORDER BY id DESC;
GO
