# API Documentation — AI LPDP

Collection Postman: **[AI LPDP](./AI_LPDP.postman_collection.json)**  
Environment Local: **[AI LPDP - Local](./AI_LPDP.postman_environment.json)**  
Environment Production: **[AI LPDP - Production](./AI_LPDP.postman_environment.production.json)**

| Environment | Base URL (contoh) |
|-------------|-------------------|
| Local | `http://localhost:9898` (sesuaikan `PORT` di `.env`) |
| Production | `http://10.216.67.197:9898` |

Prefix API: **`/api/v1`**

---

## Import ke Postman

1. Postman → **Import** → pilih file di folder `docs/`
2. Aktifkan environment **AI LPDP - Local**
3. Set `baseUrl` sesuai server
4. Jalankan **Auth → Login API User** (token tersimpan otomatis)
5. Jalankan request **Extract**

---

## Endpoints ringkas

| Method | Path | Auth | Keterangan |
|--------|------|------|------------|
| `GET` | `/api/v1/health` | no | Health check |
| `GET` | `/health` | no | Health + scheme (`http`/`https`) |
| `POST` | `/api/v1/auth/login` | no | Login API user → Bearer token |
| `POST` | `/api/v1/extract` | Bearer | Extract / verifikasi dokumen (URL dan/atau upload) |

---

## Authentication

### `POST /api/v1/auth/login`

```http
Content-Type: application/json
```

```json
{
  "username": "api_user",
  "password": "Api@LPDP2026"
}
```

**Success**

```json
{
  "status": "success",
  "data": {
    "access_token": "<jwt>",
    "token_type": "Bearer",
    "expires_in": "1d",
    "user": {
      "id": 2,
      "username": "api_user",
      "role": "api"
    }
  }
}
```

Header untuk extract (JWT atau static API token):

```http
Authorization: Bearer <access_token>
```

Static token dibuat di **Admin → API Tokens**.

Jika IP whitelist aktif (Admin → Settings), IP client harus ada di whitelist user tersebut.

---

## `POST /api/v1/extract`

Mengekstrak / memverifikasi dokumen dengan AI.  
Bisa kirim **file via URL**, **upload langsung**, atau **keduanya**.

### Batasan

| Item | Nilai |
|------|--------|
| Max total file (`file_urls` + `file_uploads`) | **10** |
| Tipe file | dari Admin → Settings (`allowed_file_types`), default: pdf, docx, txt, jpg, jpeg, png, … |
| Max ukuran / file | Admin → Settings (`max_upload_mb`) |
| Provider | Admin → Settings (`openai` / `ollama`). Scan PDF / image butuh **OpenAI** |

---

### Mode A — `application/json` (file via URL)

```http
Content-Type: application/json
Authorization: Bearer <token>
```

| Field | Type | Required | Keterangan |
|-------|------|----------|------------|
| `prompt` | string | **yes** | Instruksi ekstraksi / verifikasi |
| `file_urls` | string[] | no | 1–10 URL (`http`/`https`) — server yang mendownload |
| `file_url` | string | no | Alternatif single URL |
| `schema_hint` | string | no | Hint field / skema JSON |

**Contoh — prompt saja**

```json
{
  "prompt": "Tarik JSON: judul_makalah, nama_pembuat, penerbit, instansi dari teks: ...",
  "schema_hint": "judul_makalah, nama_pembuat, penerbit, instansi"
}
```

**Contoh — banyak file via link**

```json
{
  "prompt": "Ekstrak metadata makalah ke JSON dari semua file terlampir.",
  "schema_hint": "judul_makalah, nama_pembuat, penerbit, instansi",
  "file_urls": [
    "https://example.com/makalah1.pdf",
    "https://example.com/lampiran.docx"
  ]
}
```

**Contoh — single `file_url`**

```json
{
  "prompt": "Ringkas dokumen ke JSON: ringkasan, topik",
  "file_url": "https://example.com/dokumen.pdf"
}
```

> Catatan: URL harus bisa diakses **dari server AI LPDP** (bukan hanya dari laptop pemanggil).

---

### Mode B — `multipart/form-data` (upload file)

```http
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

| Field | Type | Required | Keterangan |
|-------|------|----------|------------|
| `prompt` | text | **yes** | Instruksi ekstraksi / verifikasi |
| `schema_hint` | text | no | Hint field / skema JSON |
| `file_uploads` | **file** (ulang field) | no | Upload **banyak file** — kirim field `file_uploads` berkali-kali |
| `file_urls` | text | no | Opsional: JSON array string, atau URL dipisah koma |

**cURL — multi upload**

```bash
curl -X POST "{{baseUrl}}/api/v1/extract" \
  -H "Authorization: Bearer <TOKEN>" \
  -F "prompt=Verifikasi dokumen syarat pencairan. Balas JSON valid sesuai instruksi." \
  -F "schema_hint=rekomendasi,memenuhi,catatan,confidence" \
  -F "file_uploads=@/path/kontrak.pdf" \
  -F "file_uploads=@/path/lampiran.pdf"
```

**cURL — upload + URL sekaligus**

```bash
curl -X POST "{{baseUrl}}/api/v1/extract" \
  -H "Authorization: Bearer <TOKEN>" \
  -F "prompt=Analisis semua lampiran" \
  -F 'file_urls=["https://example.com/a.pdf"]' \
  -F "file_uploads=@/path/b.pdf"
```

Di Postman: Body → **form-data** → tambah beberapa baris key `file_uploads` (type **File**).

---

### Success response

```json
{
  "status": "success",
  "data": {
    "judul_makalah": "...",
    "nama_pembuat": "..."
  },
  "meta": {
    "model": "gpt-4o-mini",
    "usage": {
      "prompt_tokens": 100,
      "completion_tokens": 40,
      "total_tokens": 140
    },
    "request_id": "abc123",
    "files": [
      {
        "url": "https://...",
        "file_name": "makalah1.pdf",
        "file_size": 12345,
        "ext": "pdf",
        "scanned": false,
        "source": "url"
      },
      {
        "url": null,
        "file_name": "kontrak.pdf",
        "file_size": 90000,
        "ext": "pdf",
        "scanned": true,
        "source": "upload"
      }
    ]
  }
}
```

- `source`: `"url"` | `"upload"`
- `scanned`: `true` jika PDF/image diproses via vision (tanpa teks embedded)
- Bentuk `data` mengikuti output model / instruksi di `prompt` (bisa custom skema verifikasi)

---

### Error response

```json
{
  "status": "error",
  "data": {
    "request_id": "abc123",
    "error_code": "FILE_DOWNLOAD_FAILED"
  },
  "message": "Failed to download file (404): https://..."
}
```

| HTTP | Contoh penyebab |
|------|-----------------|
| 400 | File type tidak diizinkan, terlalu besar, terlalu banyak, download gagal, captcha/N/A |
| 401 | Token hilang / invalid |
| 403 | IP tidak di whitelist |
| 502 / 503 | AI provider error / belum dikonfigurasi |

Log detail ada di **Admin → AI Logs** (prompt, file, response, token, cost).

---

## Health

### `GET /api/v1/health`

```json
{ "status": "success", "data": { "ok": true } }
```

### `GET /health`

```json
{
  "status": "ok",
  "scheme": "http",
  "secure": false,
  "forwarded_proto": null,
  "host": "10.216.67.197:9898",
  "time": "2026-09-11T07:00:00.000Z"
}
```

---

## Admin Web (referensi)

| URL | Keterangan |
|-----|------------|
| `/admin/login` | Login admin (+ captcha) |
| `/admin/settings` | Provider, API key, model, tipe file, max upload, harga token |
| `/admin/logs` | AI Logs (extract + chat) |
| `/admin/users` | User admin / API |
| `/admin/tokens` | Static API tokens |
| `/admin/whitelist` | IP whitelist per API user |
| `/admin/chat` | AI Chat (upload + image gen) |
| `/admin` | Dashboard pemakaian token / cost |

---

## Tips integrasi (eRISPRO / backoffice)

1. Prefer **`file_uploads`** jika file sudah ada di server pemanggil — tidak bergantung download lintas host.
2. Pakai **`file_urls`** hanya jika URL bisa di-`GET` dari mesin AI LPDP.
3. Untuk PDF scan / image, set provider **OpenAI** di Settings.
4. Simpan `meta.request_id` untuk tracing ke AI Logs.
