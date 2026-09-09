# AI LPDP — JSON Extraction API

Express.js + OpenAI + **SQL Server** (`db_lpdp_ai`).

## Setup

```bash
npm install
copy .env.example .env
# edit .env → set DB_* credentials
# OpenAI API key diisi lewat Admin → Settings (bukan .env)
npm run init-db
npm start
```

Server: `http://localhost:3000`  
Admin: `http://localhost:3000/admin/login`

## Users (in database, not `.env`)

Table: `dbo.users` — roles `admin` | `api`.

Seeded on first boot (password hashed with bcrypt):

| Role | Username | Password (default seed) |
|------|----------|-------------------------|
| `admin` | `admin` | `Admin@LPDP2026` |
| `api` | `api_user` | `Api@LPDP2026` |

- **admin** → login `/admin`
- **api** → login `/api/v1/auth/login` + per-user IP whitelist + optional static tokens

Manage users / whitelist / tokens from Admin UI after login.

## SQL scripts (jalankan manual di SSMS)

Folder: [`sql/`](./sql/)

| File | Kegunaan |
|------|----------|
| `001_init_db_lpdp_ai.sql` | **Wajib** — create tables + seed settings + seed users |
| `002_add_user_template.sql` | Template tambah user admin/api |
| `003_add_whitelist_ip_template.sql` | Template tambah IP whitelist per API user |

Setelah `001` sukses, app bisa `npm start` (migrate otomatis akan skip object yang sudah ada).

## API quick test

```bash
# 1) Login
curl -X POST http://localhost:3000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"api_user\",\"password\":\"Api@LPDP2026\"}"

# 2) Extract (prompt + optional file_urls)
curl -X POST http://localhost:3000/api/v1/extract ^
  -H "Authorization: Bearer <TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"Ekstrak metadata makalah\",\"file_urls\":[\"https://example.com/a.pdf\",\"https://example.com/b.docx\"]}"
```

Backend mendownload file dari URL (max 10). Tidak perlu upload multipart.

Response contract:

```json
{
  "status": "success",
  "data": { }
}
```

## Docs

- API docs: [`docs/API.md`](./docs/API.md)
- Postman collection **AI LPDP**: [`docs/AI_LPDP.postman_collection.json`](./docs/AI_LPDP.postman_collection.json)
- Postman environment: [`docs/AI_LPDP.postman_environment.json`](./docs/AI_LPDP.postman_environment.json)
- Blueprint: `BLUEPRINT.md`
- PM tracker: `PROJECT_TRACKER.md`
