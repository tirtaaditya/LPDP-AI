-- Separate password salt column (per-user random salt stored in DB)
-- Run against your LPDP AI database (e.g. db_lpdp_ai)

IF COL_LENGTH('dbo.users', 'password_salt') IS NULL
BEGIN
  ALTER TABLE dbo.users ADD password_salt NVARCHAR(128) NULL;
END
GO

-- Catatan migrasi:
-- 1) User lama (password_salt NULL) TETAP bisa login (mode legacy).
-- 2) Saat login sukses, app otomatis isi password_salt + rehash.
-- 3) Seed user default (admin / api_user) di-migrate otomatis saat app start
--    jika password masih default.
-- Tidak perlu UPDATE manual di sini (salt harus digenerate app, bukan SQL acak).
