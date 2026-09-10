-- Token pricing settings + cost columns on AI logs
-- Run against your LPDP AI database (e.g. db_lpdp_ai)

-- Pricing (per 1M tokens, OpenAI-style). Adjust in Admin → Settings.
IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_price_prompt_per_1m_usd')
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'openai_price_prompt_per_1m_usd', N'0.15');

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_price_completion_per_1m_usd')
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'openai_price_completion_per_1m_usd', N'0.60');

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'usd_to_idr')
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'usd_to_idr', N'16000');

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_image_price_usd')
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'openai_image_price_usd', N'0.04');
GO

IF COL_LENGTH('dbo.ai_extract_logs', 'cost_usd') IS NULL
  ALTER TABLE dbo.ai_extract_logs ADD cost_usd DECIMAL(18, 8) NULL;

IF COL_LENGTH('dbo.ai_extract_logs', 'cost_idr') IS NULL
  ALTER TABLE dbo.ai_extract_logs ADD cost_idr DECIMAL(18, 2) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_ai_extract_logs_user_created'
    AND object_id = OBJECT_ID(N'dbo.ai_extract_logs')
)
BEGIN
  CREATE INDEX IX_ai_extract_logs_user_created
    ON dbo.ai_extract_logs (created_at DESC, username)
    INCLUDE (prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_idr, response_status);
END
GO
