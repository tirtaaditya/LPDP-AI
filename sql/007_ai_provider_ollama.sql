/*
  Add AI provider settings (OpenAI / Ollama)
*/

USE [db_lpdp_ai];
GO

MERGE dbo.settings AS t
USING (VALUES
  (N'ai_provider',       N'openai'),
  (N'ollama_base_url',   N'http://10.44.200.73:11434'),
  (N'ollama_model',      N'gpt-oss:latest'),
  (N'ollama_api_key',    N'lpdp_bb39f26a93594792b289e397e04402aa')
) AS s ([key], [value])
ON t.[key] = s.[key]
WHEN NOT MATCHED THEN
  INSERT ([key], [value]) VALUES (s.[key], s.[value]);
GO

-- Optional: set active provider to ollama
-- UPDATE dbo.settings SET [value] = N'ollama', updated_at = SYSUTCDATETIME() WHERE [key] = N'ai_provider';

SELECT [key],
       CASE
         WHEN [key] LIKE N'%api_key' AND LEN([value]) > 0
           THEN LEFT([value], 4) + N'…' + RIGHT([value], 4)
         ELSE LEFT([value], 120)
       END AS value_preview
FROM dbo.settings
WHERE [key] IN (N'ai_provider', N'openai_model', N'ollama_base_url', N'ollama_model', N'ollama_api_key', N'openai_api_key')
ORDER BY [key];
GO
