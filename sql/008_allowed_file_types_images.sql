-- Optional: expand allowed file types (incl. images)
-- Safe to re-run.

IF EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'allowed_file_types')
BEGIN
  UPDATE dbo.settings
  SET [value] = N'pdf,docx,txt,jpg,jpeg,png,webp',
      updated_at = SYSUTCDATETIME()
  WHERE [key] = N'allowed_file_types'
    AND (
      [value] IS NULL
      OR LTRIM(RTRIM([value])) = N''
      OR [value] = N'pdf,docx,txt'
    );
END
ELSE
BEGIN
  INSERT INTO dbo.settings ([key], [value])
  VALUES (N'allowed_file_types', N'pdf,docx,txt,jpg,jpeg,png,webp');
END
GO
