-- Seed OpenAI image generation settings (safe to re-run)

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_image_model')
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'openai_image_model', N'dall-e-3');

IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = N'openai_image_size')
  INSERT INTO dbo.settings ([key], [value]) VALUES (N'openai_image_size', N'1024x1024');
GO
