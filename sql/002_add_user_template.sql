/*
==============================================================================
  Helper: tambah user baru (admin atau api)
  Ganti @username / @password_hash / @role sebelum execute.

  Cara buat password_hash (di project folder):
    node -e "console.log(require('bcryptjs').hashSync('PASSWORD_BARU', 10))"
==============================================================================
*/

USE [db_lpdp_ai];
GO

DECLARE @username      NVARCHAR(100) = N'api_partner1';
DECLARE @password_hash NVARCHAR(255) = N'PASTE_BCRYPT_HASH_HERE';
DECLARE @role          NVARCHAR(20)  = N'api';  -- 'admin' atau 'api'

IF @role NOT IN (N'admin', N'api')
BEGIN
  RAISERROR('role must be admin or api', 16, 1);
  RETURN;
END

IF EXISTS (SELECT 1 FROM dbo.users WHERE username = @username)
BEGIN
  PRINT 'User already exists: ' + @username;
  RETURN;
END

INSERT INTO dbo.users (username, password_hash, role, is_active)
VALUES (@username, @password_hash, @role, 1);

PRINT 'Created user: ' + @username + ' role=' + @role;
GO
