# Blueprint: AI JSON Extraction API

**Stack:** Node.js + Express.js + OpenAI API  
**Response format:** JSON `{ status, data }`  
**Admin:** IP whitelist, API tokens, settings (model, dll.)

> **Security note:** Jangan simpan `OPENAI_API_KEY` di file ini atau di git. Simpan hanya di `.env`.  
> Key yang pernah di-paste di chat dianggap bocor → revoke & buat key baru di OpenAI dashboard.

---

## 1. Goal / Tujuan

Aplikasi web berbasis Express.js yang:

1. Menerima **prompt** + **file (opsional)**
2. Memanggil **OpenAI API**
3. Mengembalikan hasil dalam bentuk **JSON** dengan struktur tetap:

```json
{
  "status": "success",
  "data": { }
}
```

atau

```json
{
  "status": "error",
  "data": null,
  "message": "alasan error"
}
```

### Contoh use case

**Prompt:** tarik data makalah dalam bentuk JSON: judul makalah, nama pembuat, penerbit, instansi.

**Response:**

```json
{
  "status": "success",
  "data": {
    "judul_makalah": "...",
    "nama_pembuat": "...",
    "penerbit": "...",
    "instansi": "..."
  }
}
```

---

## 2. High-level Architecture

```
Client / Integrator
        │  Bearer Token + cek IP whitelist
        ▼
┌────────────────────────┐
│  Express API           │  POST /api/v1/extract
│  - auth middleware     │  multipart: prompt + file?
│  - IP whitelist        │
│  - rate limit          │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  AI Service            │  OpenAI SDK
│  - build messages      │  + ekstrak teks dari file
│  - force JSON output   │  response_format: json_object
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│  Admin Web UI          │  /admin
│  - login               │
│  - tokens / IP /       │
│    settings            │
└───────────┬────────────┘
            │
            ▼
     SQLite / PostgreSQL
```

---

## 3. Users & Credentials (database)

Users **tidak di-hardcode di `.env`**. Disimpan di SQL Server:

**Table `dbo.users`**

| Column | Notes |
|--------|--------|
| `username` | unique |
| `password_hash` | bcrypt |
| `role` | `admin` atau `api` |
| `is_active` | 1/0 |

| Role | Digunakan untuk | Whitelist IP |
|------|-----------------|--------------|
| `admin` | Login web `/admin` | Tidak |
| `api` | Login API → JWT / static token | Ya — per user di `dbo.whitelist_ips.user_id` |

**Seed default (first boot):**

| Role | Username | Password |
|------|----------|----------|
| admin | `admin` | `Admin@LPDP2026` |
| api | `api_user` | `Api@LPDP2026` |

Kelola user / ganti password / whitelist lewat Admin UI.

**Alur auth API:**

1. `POST /api/v1/auth/login` (user role=`api` dari DB)  
2. Dapat `access_token`  
3. `Authorization: Bearer <token>` ke extract  
4. Jika IP whitelist ON → cek IP milik user API tersebut

### 3.3 Environment (tanpa username app)

```env
OPENAI_API_KEY=your_openai_api_key_here
JWT_SECRET=change_this_to_a_long_random_secret
JWT_EXPIRES_IN=1d
ADMIN_SESSION_SECRET=change_this_admin_session_secret
DB_SERVER=10.44.200.72
DB_USER=sa
DB_PASSWORD=...
DB_DATABASE=db_lpdp_ai
PORT=3000
```

---

## 4. Folder Structure

```
/
├── BLUEPRINT.md
├── .env.example
├── .gitignore
├── package.json
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   └── index.js
│   ├── middleware/
│   │   ├── auth.js              # JWT / Bearer token
│   │   ├── ipWhitelist.js
│   │   ├── rateLimit.js
│   │   └── errorHandler.js
│   ├── routes/
│   │   ├── api.routes.js        # /api/v1/*
│   │   └── admin.routes.js      # /admin/*
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── extract.controller.js
│   │   └── admin.controller.js
│   ├── services/
│   │   ├── openai.service.js
│   │   ├── file.service.js      # pdf/docx/txt → text
│   │   └── auth.service.js
│   ├── models/
│   │   ├── User.js              # admin + api user
│   │   ├── ApiToken.js          # optional static tokens
│   │   ├── WhitelistIp.js
│   │   └── Setting.js
│   └── views/ atau public/      # Admin UI sederhana
└── uploads/                     # temporary (auto-delete)
```

---

## 5. API Endpoints

### 5.1 Auth

| Method | Path                 | Auth | Deskripsi                          |
|--------|----------------------|------|------------------------------------|
| POST   | `/api/v1/auth/login` | No   | Login API user → dapat JWT token   |

### 5.2 Extract (core)

| Method | Path               | Auth         | Deskripsi                                      |
|--------|--------------------|--------------|------------------------------------------------|
| POST   | `/api/v1/extract`  | Bearer token | Prompt + optional file → JSON `{ status, data }` |

**Body (multipart/form-data):**

| Field          | Type   | Required | Notes                                      |
|----------------|--------|----------|--------------------------------------------|
| `prompt`       | string | yes      | Instruksi + bentuk JSON yang diinginkan    |
| `file`         | file   | no       | pdf / docx / txt / (opsional image)        |
| `schema_hint`  | string | no       | Hint field JSON yang wajib ada             |

**Success:**

```json
{
  "status": "success",
  "data": {
    "judul_makalah": "Contoh Judul",
    "nama_pembuat": "Budi Santoso",
    "penerbit": "Jurnal XYZ",
    "instansi": "Universitas ABC"
  }
}
```

**Error:**

```json
{
  "status": "error",
  "data": null,
  "message": "Unauthorized / IP not allowed / OpenAI failed / ..."
}
```

### 5.3 Admin (session / admin auth)

| Method | Path                        | Deskripsi                    |
|--------|-----------------------------|--------------------------------|
| GET    | `/admin/login`              | Halaman login admin            |
| POST   | `/admin/login`              | Proses login admin             |
| GET    | `/admin`                    | Dashboard                      |
| CRUD   | `/admin/tokens`             | Kelola API token (opsional)    |
| CRUD   | `/admin/whitelist-ip`       | Kelola IP yang diizinkan       |
| GET/PUT| `/admin/settings`           | Model, temperature, dll.       |

---

## 6. Admin Features

| Feature            | Behavior                                                                 |
|--------------------|--------------------------------------------------------------------------|
| **Login**          | Username + password admin (lihat section 3.1)                            |
| **API Tokens**     | Buat / revoke / label; simpan hash; plaintext hanya sekali saat create   |
| **IP Whitelist**   | Daftar IP yang boleh akses API; kosong = allow all (bisa dikonfigurasi)  |
| **Settings**       | `openai_model`, `temperature`, `max_tokens`, system prompt default, max upload size, allowed file types |
| **Users**          | Admin user + API user (username/password)                                |

### Settings default (disarankan)

| Key                 | Default value                                      |
|---------------------|----------------------------------------------------|
| `openai_model`      | `gpt-4o-mini`                                      |
| `temperature`       | `0.2`                                              |
| `max_tokens`        | `2000`                                             |
| `system_prompt`     | Jawab HANYA JSON valid. Format: `{ "status", "data" }` |
| `max_upload_mb`     | `10`                                               |
| `allowed_file_types`| `pdf,docx,txt`                                     |
| `ip_whitelist_enabled` | `true`                                          |

---

## 7. Prompting Strategy (OpenAI)

1. **System message:** paksa output JSON saja, struktur `status` + `data`.
2. **User message:** prompt dari client + (jika ada) isi teks file.
3. Pakai OpenAI parameter:

```js
response_format: { type: "json_object" }
```

4. Server parse JSON dari model, wrap ulang ke contract API jika perlu.
5. Jika model gagal / JSON invalid → `status: "error"`.

---

## 8. Security Checklist

- [ ] `OPENAI_API_KEY` hanya di `.env`, tidak di git / markdown
- [ ] Revoke key yang pernah bocor di chat
- [ ] Hash password admin & API user (bcrypt)
- [ ] Hash static API tokens (jika dipakai)
- [ ] JWT secret kuat & unik
- [ ] IP whitelist + rate limit per IP/token
- [ ] Validasi tipe & ukuran file
- [ ] Hapus file upload setelah diproses
- [ ] Helmet, CORS terbatas, error message aman

---

## 9. Tech Stack

| Layer        | Choice                                      |
|--------------|---------------------------------------------|
| Runtime      | Node.js                                     |
| Framework    | Express.js                                  |
| AI           | OpenAI Node SDK                             |
| Upload       | multer                                      |
| File parse   | pdf-parse, mammoth                          |
| DB           | **SQL Server** (`db_lpdp_ai` @ `DB_SERVER`) via `mssql` |
| Auth         | JWT + bcrypt                                |
| Admin UI     | EJS / HTML sederhana (bisa React nanti)     |
| Hardening    | dotenv, helmet, express-rate-limit          |

---

## 10. Phased Build Plan

| Phase | Scope |
|-------|--------|
| **1** | Express skeleton + `.env` + login API + extract (prompt only → JSON) |
| **2** | File upload + ekstraksi teks |
| **3** | JWT auth + IP whitelist middleware |
| **4** | Admin UI: login, tokens, IP, settings |
| **5** | Rate limit, logging, hardening production |

> **PM tracker (timeline + checklist status):** lihat [`PROJECT_TRACKER.md`](./PROJECT_TRACKER.md) — update di situ untuk tahu sedang di proses mana.

---

## 11. Quick Test Flow (setelah implementasi)

1. Login API:

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"api_user\",\"password\":\"Api@LPDP2026\"}"
```

2. Extract:

```bash
curl -X POST http://localhost:3000/api/v1/extract \
  -H "Authorization: Bearer <TOKEN>" \
  -F "prompt=Tarik dalam bentuk JSON: judul_makalah, nama_pembuat, penerbit, instansi dari teks berikut: ..."
```

3. Admin: buka `http://localhost:3000/admin/login`  
   Username: `admin` / Password: `Admin@LPDP2026`

---

## 12. Summary Credentials (seed DB — copy cepat)

| Role (DB) | Username   | Password         | Digunakan untuk              |
|-----------|------------|------------------|------------------------------|
| `admin`   | `admin`    | `Admin@LPDP2026` | Login web `/admin`           |
| `api`     | `api_user` | `Api@LPDP2026`   | Login API + whitelist IP     |

Disimpan di `dbo.users` (bcrypt). **Ganti password via Admin UI sebelum production.**
