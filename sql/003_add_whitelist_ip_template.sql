/*
==============================================================================
  Helper: tambah IP whitelist untuk user role=api
==============================================================================
*/

USE [db_lpdp_ai];
GO

DECLARE @api_username NVARCHAR(100) = N'api_user';
DECLARE @ip           NVARCHAR(64)  = N'10.44.200.10';
DECLARE @label        NVARCHAR(200) = N'Office';

DECLARE @user_id INT = (
  SELECT id FROM dbo.users WHERE username = @api_username AND role = N'api' AND is_active = 1
);

IF @user_id IS NULL
BEGIN
  RAISERROR('API user not found / not active', 16, 1);
  RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.whitelist_ips WHERE user_id = @user_id AND ip = @ip)
BEGIN
  PRINT 'IP already whitelisted for this user';
  RETURN;
END

INSERT INTO dbo.whitelist_ips (user_id, ip, label)
VALUES (@user_id, @ip, @label);

-- Aktifkan flag global whitelist (opsional)
UPDATE dbo.settings
SET [value] = N'true', updated_at = SYSUTCDATETIME()
WHERE [key] = N'ip_whitelist_enabled';

PRINT 'Whitelist IP added for ' + @api_username + ' -> ' + @ip;
GO
