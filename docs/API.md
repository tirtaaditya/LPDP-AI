# API Documentation — AI LPDP

Collection Postman: **[AI LPDP](./AI_LPDP.postman_collection.json)**  
Environment: **[AI LPDP - Local](./AI_LPDP.postman_environment.json)**

Base URL (local): `http://localhost:3000`

---

## Import ke Postman

1. Buka Postman → **Import**
2. Pilih file di folder `docs/`
3. Aktifkan environment **AI LPDP - Local**
4. Jalankan **Auth → Login API User**
5. Jalankan **Extract**

---

## Authentication

`POST /api/v1/auth/login`

```json
{ "username": "api_user", "password": "Api@LPDP2026" }
```

Header untuk extract:

```http
Authorization: Bearer <access_token>
```

---

## `POST /api/v1/extract`

Body: **`application/json`** (disarankan)

| Field | Type | Required | Keterangan |
|-------|------|----------|------------|
| `prompt` | string | yes | Instruksi ekstraksi |
| `file_urls` | string[] | no | 1–10 URL file (`http`/`https`) — BE yang download |
| `file_url` | string | no | Alternatif single URL |
| `schema_hint` | string | no | Hint field JSON |

### Contoh — prompt saja

```json
{
  "prompt": "Tarik JSON: judul_makalah, nama_pembuat, penerbit, instansi dari teks: ..."
}
```

### Contoh — banyak file via link

```json
{
  "prompt": "Ekstrak metadata makalah ke JSON: judul_makalah, nama_pembuat, penerbit, instansi",
  "schema_hint": "judul_makalah, nama_pembuat, penerbit, instansi",
  "file_urls": [
    "https://example.com/makalah1.pdf",
    "https://example.com/lampiran.docx"
  ]
}
```

Tipe file yang didukung: `pdf`, `docx`, `txt` (atur di Admin Settings).  
Maks ukuran per file: `max_upload_mb` di Settings.  
Maks jumlah URL: **10**.

### Success

```json
{
  "status": "success",
  "data": {
    "judul_makalah": "...",
    "nama_pembuat": "..."
  },
  "meta": {
    "model": "gpt-4o-mini",
    "usage": { "prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140 },
    "request_id": "abc123",
    "files": [
      { "url": "https://...", "file_name": "makalah1.pdf", "file_size": 12345, "ext": "pdf" }
    ]
  }
}
```

Log tersimpan di **Admin → AI Logs** (prompt, URL file, teks hasil download, AI response, token).

---

## Admin Web

| URL | Keterangan |
|-----|------------|
| `/admin/settings` | OpenAI key, model, tipe file, max size |
| `/admin/logs` | Log extract |
| `/admin/whitelist` | IP whitelist per API user |
