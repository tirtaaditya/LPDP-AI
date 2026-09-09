const sql = require('mssql');
const bcrypt = require('bcryptjs');
const config = require('../config');

let poolPromise;

async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      server: config.db.server,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      options: config.db.options,
      pool: config.db.pool,
    })
      .connect()
      .then((pool) => {
        console.log(
          `[db] Connected to SQL Server ${config.db.server}/${config.db.database}`
        );
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        console.error('[db] Connection failed:', err.message);
        throw err;
      });
  }
  return poolPromise;
}

async function migrate() {
  const pool = await getPool();

  await pool.request().query(`
    IF OBJECT_ID('dbo.users', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        username NVARCHAR(100) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        role NVARCHAR(20) NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_users_active DEFAULT 1,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_users_created DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL CONSTRAINT DF_users_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_users_role CHECK (role IN ('admin', 'api'))
      );
    END;

    IF OBJECT_ID('dbo.settings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.settings (
        [key] NVARCHAR(100) NOT NULL PRIMARY KEY,
        [value] NVARCHAR(MAX) NOT NULL,
        updated_at DATETIME2 NOT NULL CONSTRAINT DF_settings_updated DEFAULT SYSUTCDATETIME()
      );
    END;

    IF OBJECT_ID('dbo.request_logs', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.request_logs (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        request_id NVARCHAR(64) NULL,
        method NVARCHAR(16) NULL,
        [path] NVARCHAR(500) NULL,
        status_code INT NULL,
        ip NVARCHAR(64) NULL,
        duration_ms INT NULL,
        message NVARCHAR(1000) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_logs_created DEFAULT SYSUTCDATETIME()
      );
    END;
  `);

  // Recreate whitelist + tokens with user_id if old schema (no user_id)
  const wlCols = await pool.request().query(`
    SELECT COL_LENGTH('dbo.whitelist_ips', 'user_id') AS user_id_len
  `);
  const hasWhitelist = await pool.request().query(`
    SELECT OBJECT_ID('dbo.whitelist_ips', 'U') AS oid
  `);

  if (!hasWhitelist.recordset[0].oid) {
    await pool.request().query(`
      CREATE TABLE dbo.whitelist_ips (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        ip NVARCHAR(64) NOT NULL,
        label NVARCHAR(200) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_whitelist_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_whitelist_user_ip UNIQUE (user_id, ip),
        CONSTRAINT FK_whitelist_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
      );
    `);
  } else if (wlCols.recordset[0].user_id_len == null) {
    await pool.request().query(`
      IF OBJECT_ID('dbo.whitelist_ips', 'U') IS NOT NULL DROP TABLE dbo.whitelist_ips;
      CREATE TABLE dbo.whitelist_ips (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        ip NVARCHAR(64) NOT NULL,
        label NVARCHAR(200) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_whitelist_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_whitelist_user_ip UNIQUE (user_id, ip),
        CONSTRAINT FK_whitelist_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
      );
    `);
  }

  const tokenCols = await pool.request().query(`
    SELECT COL_LENGTH('dbo.api_tokens', 'user_id') AS user_id_len
  `);
  const hasTokens = await pool.request().query(`
    SELECT OBJECT_ID('dbo.api_tokens', 'U') AS oid
  `);

  if (!hasTokens.recordset[0].oid) {
    await pool.request().query(`
      CREATE TABLE dbo.api_tokens (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        name NVARCHAR(200) NOT NULL,
        token_hash NVARCHAR(128) NOT NULL UNIQUE,
        token_prefix NVARCHAR(32) NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_tokens_active DEFAULT 1,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_tokens_created DEFAULT SYSUTCDATETIME(),
        revoked_at DATETIME2 NULL,
        CONSTRAINT FK_tokens_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
      );
    `);
  } else if (tokenCols.recordset[0].user_id_len == null) {
    await pool.request().query(`
      IF OBJECT_ID('dbo.api_tokens', 'U') IS NOT NULL DROP TABLE dbo.api_tokens;
      CREATE TABLE dbo.api_tokens (
        id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        name NVARCHAR(200) NOT NULL,
        token_hash NVARCHAR(128) NOT NULL UNIQUE,
        token_prefix NVARCHAR(32) NOT NULL,
        is_active BIT NOT NULL CONSTRAINT DF_tokens_active DEFAULT 1,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_tokens_created DEFAULT SYSUTCDATETIME(),
        revoked_at DATETIME2 NULL,
        CONSTRAINT FK_tokens_user FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
      );
    `);
  }

  await pool.request().query(`
    IF OBJECT_ID('dbo.ai_extract_logs', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ai_extract_logs (
        id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        request_id NVARCHAR(64) NULL,
        user_id INT NULL,
        username NVARCHAR(100) NULL,
        auth_type NVARCHAR(20) NULL,
        token_id INT NULL,
        token_name NVARCHAR(200) NULL,
        token_prefix NVARCHAR(32) NULL,
        prompt NVARCHAR(MAX) NULL,
        schema_hint NVARCHAR(MAX) NULL,
        has_file BIT NOT NULL CONSTRAINT DF_ai_logs_has_file DEFAULT 0,
        file_name NVARCHAR(MAX) NULL,
        file_size INT NULL,
        file_text NVARCHAR(MAX) NULL,
        ai_response NVARCHAR(MAX) NULL,
        response_status NVARCHAR(20) NULL,
        http_status INT NULL,
        model NVARCHAR(100) NULL,
        prompt_tokens INT NULL,
        completion_tokens INT NULL,
        total_tokens INT NULL,
        ip NVARCHAR(64) NULL,
        duration_ms INT NULL,
        error_message NVARCHAR(1000) NULL,
        created_at DATETIME2 NOT NULL CONSTRAINT DF_ai_logs_created DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_ai_extract_logs_created ON dbo.ai_extract_logs (created_at DESC);
    END
    ELSE
    BEGIN
      ALTER TABLE dbo.ai_extract_logs ALTER COLUMN file_name NVARCHAR(MAX) NULL;
    END;
  `);
}

async function seed() {
  const defaults = {
    ai_provider: 'openai',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    ollama_base_url: 'http://10.44.200.73:11434',
    ollama_model: 'gpt-oss:latest',
    ollama_api_key: 'lpdp_bb39f26a93594792b289e397e04402aa',
    temperature: '0.2',
    max_tokens: '2000',
    system_prompt:
      'You are a data extraction assistant. Always respond with valid JSON only. Prefer shape: {"status":"success","data":{...}}. If extraction fails, use {"status":"error","data":null,"message":"..."}. Do not wrap in markdown.',
    max_upload_mb: String(config.maxUploadMb),
    allowed_file_types: 'pdf,docx,txt,jpg,jpeg,png,webp',
    ip_whitelist_enabled: 'false',
  };

  const pool = await getPool();
  for (const [key, value] of Object.entries(defaults)) {
    await pool
      .request()
      .input('key', sql.NVarChar(100), key)
      .input('value', sql.NVarChar(sql.MAX), value)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.settings WHERE [key] = @key)
          INSERT INTO dbo.settings ([key], [value]) VALUES (@key, @value);
      `);
  }

  // Seed default users into DB (not from .env)
  const seedUsers = [
    { username: 'admin', password: 'Admin@LPDP2026', role: 'admin' },
    { username: 'api_user', password: 'Api@LPDP2026', role: 'api' },
  ];

  for (const u of seedUsers) {
    const existing = await findUserByUsername(u.username);
    if (!existing) {
      await createUser(u.username, u.password, u.role);
      console.log(`[db] Seeded user '${u.username}' role=${u.role}`);
    }
  }
}

async function initDb() {
  await getPool();
  await migrate();
  await seed();
}

async function getSetting(key, fallback = null) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('key', sql.NVarChar(100), key)
    .query('SELECT [value] FROM dbo.settings WHERE [key] = @key');
  return result.recordset[0]?.value ?? fallback;
}

async function getAllSettings() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query('SELECT [key], [value], updated_at FROM dbo.settings ORDER BY [key]');
  return Object.fromEntries(result.recordset.map((r) => [r.key, r.value]));
}

async function setSetting(key, value) {
  const pool = await getPool();
  await pool
    .request()
    .input('key', sql.NVarChar(100), key)
    .input('value', sql.NVarChar(sql.MAX), String(value))
    .query(`
      MERGE dbo.settings AS t
      USING (SELECT @key AS [key], @value AS [value]) AS s
      ON t.[key] = s.[key]
      WHEN MATCHED THEN UPDATE SET [value] = s.[value], updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT ([key], [value]) VALUES (s.[key], s.[value]);
    `);
}

async function findUserByUsername(username) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('username', sql.NVarChar(100), username)
    .query(`
      SELECT TOP 1 id, username, password_hash, role, is_active, created_at, updated_at
      FROM dbo.users WHERE username = @username
    `);
  return result.recordset[0] || null;
}

async function findUserById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1 id, username, password_hash, role, is_active, created_at, updated_at
      FROM dbo.users WHERE id = @id
    `);
  return result.recordset[0] || null;
}

async function listUsers() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, username, role, is_active, created_at, updated_at
    FROM dbo.users
    ORDER BY role, username
  `);
  return result.recordset;
}

async function listApiUsers() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, username, role, is_active, created_at
    FROM dbo.users
    WHERE role = 'api'
    ORDER BY username
  `);
  return result.recordset;
}

async function createUser(username, password, role) {
  if (!['admin', 'api'].includes(role)) {
    throw new Error('role must be admin or api');
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  const pool = await getPool();
  const result = await pool
    .request()
    .input('username', sql.NVarChar(100), username.trim())
    .input('password_hash', sql.NVarChar(255), passwordHash)
    .input('role', sql.NVarChar(20), role)
    .query(`
      INSERT INTO dbo.users (username, password_hash, role, is_active)
      OUTPUT INSERTED.id, INSERTED.username, INSERTED.role, INSERTED.is_active
      VALUES (@username, @password_hash, @role, 1)
    `);
  return result.recordset[0];
}

async function updateUserPassword(id, password) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('password_hash', sql.NVarChar(255), passwordHash)
    .query(`
      UPDATE dbo.users
      SET password_hash = @password_hash, updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
}

async function setUserActive(id, isActive) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('is_active', sql.Bit, isActive ? 1 : 0)
    .query(`
      UPDATE dbo.users
      SET is_active = @is_active, updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
}

async function updateUser(id, { username, role, is_active }) {
  if (role && !['admin', 'api'].includes(role)) {
    throw new Error('role must be admin or api');
  }
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('username', sql.NVarChar(100), username.trim())
    .input('role', sql.NVarChar(20), role)
    .input('is_active', sql.Bit, is_active ? 1 : 0)
    .query(`
      UPDATE dbo.users
      SET username = @username,
          role = @role,
          is_active = @is_active,
          updated_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
}

async function deleteUser(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .query('DELETE FROM dbo.users WHERE id = @id');
}

async function getWhitelistById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT w.id, w.user_id, w.ip, w.label, w.created_at, u.username
      FROM dbo.whitelist_ips w
      INNER JOIN dbo.users u ON u.id = w.user_id
      WHERE w.id = @id
    `);
  return result.recordset[0] || null;
}

async function updateWhitelistIp(id, userId, ip, label = '') {
  const user = await findUserById(userId);
  if (!user || user.role !== 'api') {
    throw new Error('Whitelist only applies to API users');
  }
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('user_id', sql.Int, userId)
    .input('ip', sql.NVarChar(64), ip.trim())
    .input('label', sql.NVarChar(200), label || null)
    .query(`
      UPDATE dbo.whitelist_ips
      SET user_id = @user_id, ip = @ip, label = @label
      WHERE id = @id
    `);
}

async function deleteApiToken(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .query('DELETE FROM dbo.api_tokens WHERE id = @id');
}

async function getDashboardCounts() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.users) AS users_count,
      (SELECT COUNT(*) FROM dbo.users WHERE role = 'api' AND is_active = 1) AS api_users_count,
      (SELECT COUNT(*) FROM dbo.whitelist_ips) AS whitelist_count,
      (SELECT COUNT(*) FROM dbo.api_tokens WHERE is_active = 1) AS tokens_count
  `);
  return result.recordset[0];
}

async function verifyUserCredentials(username, password, expectedRole = null) {
  const user = await findUserByUsername(username);
  if (!user || !user.is_active) return null;
  if (expectedRole && user.role !== expectedRole) return null;
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return null;
  return user;
}

async function listWhitelistIps(userId = null) {
  const pool = await getPool();
  if (userId) {
    const result = await pool
      .request()
      .input('user_id', sql.Int, userId)
      .query(`
        SELECT w.id, w.user_id, w.ip, w.label, w.created_at, u.username
        FROM dbo.whitelist_ips w
        INNER JOIN dbo.users u ON u.id = w.user_id
        WHERE w.user_id = @user_id
        ORDER BY w.id DESC
      `);
    return result.recordset;
  }
  const result = await pool.request().query(`
    SELECT w.id, w.user_id, w.ip, w.label, w.created_at, u.username
    FROM dbo.whitelist_ips w
    INNER JOIN dbo.users u ON u.id = w.user_id
    ORDER BY u.username, w.id DESC
  `);
  return result.recordset;
}

async function addWhitelistIp(userId, ip, label = '') {
  const user = await findUserById(userId);
  if (!user || user.role !== 'api') {
    throw new Error('Whitelist only applies to API users');
  }
  const pool = await getPool();
  await pool
    .request()
    .input('user_id', sql.Int, userId)
    .input('ip', sql.NVarChar(64), ip.trim())
    .input('label', sql.NVarChar(200), label || null)
    .query('INSERT INTO dbo.whitelist_ips (user_id, ip, label) VALUES (@user_id, @ip, @label)');
}

async function removeWhitelistIp(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .query('DELETE FROM dbo.whitelist_ips WHERE id = @id');
}

/**
 * Per API user whitelist:
 * - If global ip_whitelist_enabled = false → allow all
 * - If user has no IP rows → allow all for that user
 * - Else IP must match one of the user's whitelist rows
 * - ::1 / localhost treated as 127.0.0.1
 */
function normalizeIp(ip) {
  if (!ip) return '';
  let value = String(ip).trim().toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value === '::1' || value === '0:0:0:0:0:0:0:1' || value === 'localhost') {
    return '127.0.0.1';
  }
  return value;
}

async function isIpAllowed(ip, userId) {
  const enabled = (await getSetting('ip_whitelist_enabled', 'false')) === 'true';
  if (!enabled) return true;
  if (!userId) return false;

  const rows = await listWhitelistIps(userId);
  if (rows.length === 0) return true;

  const client = normalizeIp(ip);
  return rows.some((r) => normalizeIp(r.ip) === client);
}

async function listApiTokens() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT t.id, t.user_id, t.name, t.token_prefix, t.is_active, t.created_at, t.revoked_at, u.username
    FROM dbo.api_tokens t
    INNER JOIN dbo.users u ON u.id = t.user_id
    ORDER BY t.id DESC
  `);
  return result.recordset;
}

async function createApiToken(userId, name, tokenHash, tokenPrefix) {
  const user = await findUserById(userId);
  if (!user || user.role !== 'api') {
    throw new Error('Tokens only for API users');
  }
  const pool = await getPool();
  const result = await pool
    .request()
    .input('user_id', sql.Int, userId)
    .input('name', sql.NVarChar(200), name)
    .input('token_hash', sql.NVarChar(128), tokenHash)
    .input('token_prefix', sql.NVarChar(32), tokenPrefix)
    .query(`
      INSERT INTO dbo.api_tokens (user_id, name, token_hash, token_prefix, is_active)
      OUTPUT INSERTED.id
      VALUES (@user_id, @name, @token_hash, @token_prefix, 1)
    `);
  return result.recordset[0].id;
}

async function revokeApiToken(id) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      UPDATE dbo.api_tokens
      SET is_active = 0, revoked_at = SYSUTCDATETIME()
      WHERE id = @id
    `);
}

async function findActiveTokenByHash(tokenHash) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('token_hash', sql.NVarChar(128), tokenHash)
    .query(`
      SELECT TOP 1 t.*, u.username, u.role, u.is_active AS user_active
      FROM dbo.api_tokens t
      INNER JOIN dbo.users u ON u.id = t.user_id
      WHERE t.token_hash = @token_hash AND t.is_active = 1 AND u.is_active = 1
    `);
  return result.recordset[0] || null;
}

async function logRequest({ requestId, method, pathName, statusCode, ip, durationMs, message }) {
  const pool = await getPool();
  await pool
    .request()
    .input('request_id', sql.NVarChar(64), requestId || null)
    .input('method', sql.NVarChar(16), method || null)
    .input('path', sql.NVarChar(500), pathName || null)
    .input('status_code', sql.Int, statusCode ?? null)
    .input('ip', sql.NVarChar(64), ip || null)
    .input('duration_ms', sql.Int, durationMs ?? null)
    .input('message', sql.NVarChar(1000), message || null)
    .query(`
      INSERT INTO dbo.request_logs
        (request_id, method, [path], status_code, ip, duration_ms, message)
      VALUES
        (@request_id, @method, @path, @status_code, @ip, @duration_ms, @message)
    `);
}

function truncateText(value, max = 80000) {
  if (value == null) return null;
  const s = String(value);
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...[truncated ${s.length - max} chars]`;
}

async function createExtractLog(entry) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('request_id', sql.NVarChar(64), entry.requestId || null)
    .input('user_id', sql.Int, entry.userId ?? null)
    .input('username', sql.NVarChar(100), entry.username || null)
    .input('auth_type', sql.NVarChar(20), entry.authType || null)
    .input('token_id', sql.Int, entry.tokenId ?? null)
    .input('token_name', sql.NVarChar(200), entry.tokenName || null)
    .input('token_prefix', sql.NVarChar(32), entry.tokenPrefix || null)
    .input('prompt', sql.NVarChar(sql.MAX), truncateText(entry.prompt))
    .input('schema_hint', sql.NVarChar(sql.MAX), truncateText(entry.schemaHint, 10000))
    .input('has_file', sql.Bit, entry.hasFile ? 1 : 0)
    .input('file_name', sql.NVarChar(sql.MAX), entry.fileName || null)
    .input('file_size', sql.Int, entry.fileSize ?? null)
    .input('file_text', sql.NVarChar(sql.MAX), truncateText(entry.fileText))
    .input('ai_response', sql.NVarChar(sql.MAX), truncateText(entry.aiResponse))
    .input('response_status', sql.NVarChar(20), entry.responseStatus || null)
    .input('http_status', sql.Int, entry.httpStatus ?? null)
    .input('model', sql.NVarChar(100), entry.model || null)
    .input('prompt_tokens', sql.Int, entry.promptTokens ?? null)
    .input('completion_tokens', sql.Int, entry.completionTokens ?? null)
    .input('total_tokens', sql.Int, entry.totalTokens ?? null)
    .input('ip', sql.NVarChar(64), entry.ip || null)
    .input('duration_ms', sql.Int, entry.durationMs ?? null)
    .input('error_message', sql.NVarChar(1000), entry.errorMessage || null)
    .query(`
      INSERT INTO dbo.ai_extract_logs (
        request_id, user_id, username, auth_type, token_id, token_name, token_prefix,
        prompt, schema_hint, has_file, file_name, file_size, file_text,
        ai_response, response_status, http_status, model,
        prompt_tokens, completion_tokens, total_tokens,
        ip, duration_ms, error_message
      )
      OUTPUT INSERTED.id
      VALUES (
        @request_id, @user_id, @username, @auth_type, @token_id, @token_name, @token_prefix,
        @prompt, @schema_hint, @has_file, @file_name, @file_size, @file_text,
        @ai_response, @response_status, @http_status, @model,
        @prompt_tokens, @completion_tokens, @total_tokens,
        @ip, @duration_ms, @error_message
      )
    `);
  return result.recordset[0].id;
}

async function listExtractLogs({
  limit = 50,
  offset = 0,
  search = '',
  orderColumn = 'id',
  orderDir = 'DESC',
} = {}) {
  const pool = await getPool();
  const allowedOrder = {
    id: 'id',
    created_at: 'created_at',
    username: 'username',
    response_status: 'response_status',
    model: 'model',
    total_tokens: 'total_tokens',
    file_name: 'file_name',
  };
  const col = allowedOrder[orderColumn] || 'id';
  const dir = String(orderDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const q = String(search || '').trim();

  const request = pool
    .request()
    .input('limit', sql.Int, limit)
    .input('offset', sql.Int, offset)
    .input('search', sql.NVarChar(200), q ? `%${q}%` : null);

  const where = q
    ? `WHERE (
         username LIKE @search
         OR token_name LIKE @search
         OR token_prefix LIKE @search
         OR file_name LIKE @search
         OR response_status LIKE @search
         OR model LIKE @search
         OR CAST(id AS NVARCHAR(30)) LIKE @search
         OR LEFT(prompt, 200) LIKE @search
       )`
    : '';

  const result = await request.query(`
    SELECT id, request_id, user_id, username, auth_type, token_id, token_name, token_prefix,
           has_file, file_name, response_status, http_status, model, total_tokens,
           ip, duration_ms, created_at,
           LEFT(prompt, 120) AS prompt_preview
    FROM dbo.ai_extract_logs
    ${where}
    ORDER BY ${col} ${dir}
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);
  return result.recordset;
}

async function getExtractLogById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.BigInt, id)
    .query('SELECT TOP 1 * FROM dbo.ai_extract_logs WHERE id = @id');
  return result.recordset[0] || null;
}

async function countExtractLogs(search = '') {
  const pool = await getPool();
  const q = String(search || '').trim();
  if (!q) {
    const result = await pool.request().query('SELECT COUNT(*) AS total FROM dbo.ai_extract_logs');
    return result.recordset[0].total;
  }
  const result = await pool
    .request()
    .input('search', sql.NVarChar(200), `%${q}%`)
    .query(`
      SELECT COUNT(*) AS total
      FROM dbo.ai_extract_logs
      WHERE (
        username LIKE @search
        OR token_name LIKE @search
        OR token_prefix LIKE @search
        OR file_name LIKE @search
        OR response_status LIKE @search
        OR model LIKE @search
        OR CAST(id AS NVARCHAR(30)) LIKE @search
        OR LEFT(prompt, 200) LIKE @search
      )
    `);
  return result.recordset[0].total;
}

async function close() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = {
  sql,
  getPool,
  initDb,
  migrate,
  seed,
  getSetting,
  getAllSettings,
  setSetting,
  findUserByUsername,
  findUserById,
  listUsers,
  listApiUsers,
  createUser,
  updateUserPassword,
  setUserActive,
  updateUser,
  deleteUser,
  verifyUserCredentials,
  listWhitelistIps,
  getWhitelistById,
  addWhitelistIp,
  updateWhitelistIp,
  removeWhitelistIp,
  isIpAllowed,
  listApiTokens,
  createApiToken,
  revokeApiToken,
  deleteApiToken,
  findActiveTokenByHash,
  getDashboardCounts,
  logRequest,
  createExtractLog,
  listExtractLogs,
  getExtractLogById,
  countExtractLogs,
  close,
};
