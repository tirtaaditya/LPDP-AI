/*
==============================================================================
  Add openai_api_key to settings (stored in DB, not .env)
==============================================================================
*/

USE [db_lpdp_ai];
GO

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_api_key')
BEGIN
  INSERT INTO dbo.settings ([key], [value])
  VALUES (N'openai_api_key', N'');
  PRINT 'Inserted settings.openai_api_key (empty — set via Admin UI)';
END
ELSE
  PRINT 'settings.openai_api_key already exists';
GO

SELECT [key],
       CASE
         WHEN [key] = N'openai_api_key' AND LEN([value]) > 0
           THEN LEFT([value], 7) + N'…' + RIGHT([value], 4)
         WHEN [key] = N'openai_api_key'
           THEN N'(empty)'
         ELSE LEFT([value], 80)
       END AS value_preview,
       updated_at
FROM dbo.settings
WHERE [key] IN (N'openai_api_key', N'openai_model')
ORDER BY [key];
GO
