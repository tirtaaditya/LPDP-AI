-- Update default image model away from dall-e-3 (often unavailable)

IF EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_image_model')
BEGIN
  UPDATE dbo.settings
  SET [value] = N'gpt-image-1', updated_at = SYSUTCDATETIME()
  WHERE [key] = N'openai_image_model'
    AND ([value] IS NULL OR LTRIM(RTRIM([value])) IN (N'', N'dall-e-3'));
END
ELSE
BEGIN
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'openai_image_model', N'gpt-image-1');
END

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_image_size')
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'openai_image_size', N'1024x1024');
GO
