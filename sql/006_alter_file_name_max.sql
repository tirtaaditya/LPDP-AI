/*
  Fix: file_name column too short for file_urls JSON
*/

USE [db_lpdp_ai];
GO

ALTER TABLE dbo.ai_extract_logs ALTER COLUMN file_name NVARCHAR(MAX) NULL;
GO

PRINT 'Altered ai_extract_logs.file_name -> NVARCHAR(MAX)';
GO
