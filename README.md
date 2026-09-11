# AI LPDP — JSON Extraction API

Express.js + OpenAI + **SQL Server** (`db_lpdp_ai`).

## Production deploy (setelah git pull)

**Ya — biasanya perlu `npm install`** setelah pull, terutama jika `package.json` / `package-lock.json` berubah. Script di bawah sudah otomatis.

### Linux / Ubuntu (PM2)

```bash
cd /opt/lpdp-ai   # sesuaikan path
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### Windows Server (PM2)

```powershell
cd "C:\path\to\AI LPDP"
.\scripts\deploy.ps1
```

Opsi: `-SkipPull`, `-SkipInstall`, `-Branch main` (PS) / `--skip-pull` `--skip-install` `--branch main` (bash).

Migrate DB jalan otomatis saat app start. File SQL di `sql/` hanya jika ada migrasi manual khusus.


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

- **Manual Book:** [`docs/MANUAL_BOOK.md`](./docs/MANUAL_BOOK.md) (gambar UI: [`docs/images/`](./docs/images/))
- **SIT:** [`docs/SIT.md`](./docs/SIT.md)
- **UAT:** [`docs/UAT.md`](./docs/UAT.md)
- API docs: [`docs/API.md`](./docs/API.md)
- Staff Assistant flow (SA/PM): [`docs/LPDP_STAFF_ASSISTANT_FLOW.md`](./docs/LPDP_STAFF_ASSISTANT_FLOW.md)
- Postman collection **AI LPDP**: [`docs/AI_LPDP.postman_collection.json`](./docs/AI_LPDP.postman_collection.json)
- Postman environment (local): [`docs/AI_LPDP.postman_environment.json`](./docs/AI_LPDP.postman_environment.json)
- Postman environment (prod): [`docs/AI_LPDP.postman_environment.production.json`](./docs/AI_LPDP.postman_environment.production.json)
- Blueprint: `BLUEPRINT.md`
- PM tracker: `PROJECT_TRACKER.md`
