# LPDP Staff Assistant — Flow & Spec (SA/PM)

**Status:** Draft v0.1 (keputusan produk terkunci)  
**Bahasa jawaban agen:** Indonesia  
**Surface:** lanjut di repo AI LPDP (extend Admin Chat → Asisten Staf)  
**Audiens:** staf internal yang sudah login (semua role admin yang punya session)

---

## 1. Keputusan terkunci

| # | Topik | Keputusan |
|---|--------|-----------|
| 1 | Audiens | Staf internal |
| 2 | Scope | Kebijakan (website) + status pribadi (API) |
| 3 | Sumber kebijakan | Crawl website LPDP (seluruh halaman yang diizinkan) |
| 4 | Status pribadi | Desain API bersama (di repo ini / kontrak eksternal) |
| 5 | Kanal | Lanjut di AI LPDP |
| 6 | Bahasa | Indonesia |
| 7 | Sitasi | Wajib untuk jawaban kebijakan (URL + judul halaman) |
| 8 | Akses status | Semua user yang login (session admin) |

### Arti sitasi
Jawaban kebijakan harus menampilkan sumber resmi yang dipakai, misalnya:

> … syarat Affirmation adalah …  
> **Sumber:** [Syarat Beasiswa](https://lpdp.kemenkeu.go.id/…)

Tujuan: staf bisa verifikasi; agen tidak mengarang kebijakan.

---

## 2. Tujuan produk

Asisten AI untuk staf LPDP yang:

1. Menjawab pertanyaan **kebijakan / prosedur** dari konten website resmi (RAG + sitasi).
2. Menjawab pertanyaan **status pribadi** (pendaftar / awardee) dengan memanggil **Status API** — tidak menebak.
3. Menolak atau mengarahkan eskalasi jika di luar scope / data tidak ditemukan / confidence rendah.

---

## 3. Arsitektur fungsional

```text
┌─────────────────────────────────────────────────────────────┐
│  Staff (Admin UI — Chat / Asisten LPDP)                     │
│  Session cookie (semua yang login)                          │
└───────────────────────────┬─────────────────────────────────┘
                            │ POST /admin/chat/message
                            │ (nanti opsional: POST /api/v1/ask)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Orchestrator (Staff Agent)                                 │
│  1. Classify intent                                         │
│  2. Route tools                                             │
│  3. Compose jawaban ID + sitasi / data status               │
│  4. Audit log                                               │
└───────┬─────────────────────────────┬───────────────────────┘
        │                             │
        ▼                             ▼
┌───────────────────┐       ┌───────────────────────────────┐
│ Knowledge Service │       │ Status Lookup Service         │
│ - search chunks   │       │ - validate identifier         │
│ - return passages │       │ - call Status API             │
│   + url + title   │       │ - map fields → jawaban ID     │
└─────────┬─────────┘       └───────────────┬───────────────┘
          │                                 │
          ▼                                 ▼
┌───────────────────┐       ┌───────────────────────────────┐
│ Vector / KB store │       │ Status API (kontrak bersama)  │
│ + crawl metadata  │       │ eRISPRO / DB / service lain   │
└─────────┬─────────┘       └───────────────────────────────┘
          │
          ▼
┌───────────────────┐
│ Crawler           │
│ seed: lpdp site   │
│ robots, sitemap,  │
│ rate limit, hash  │
└───────────────────┘
```

---

## 4. Alur end-to-end (sequence)

### 4.1 Pertanyaan kebijakan

```text
Staff → Agent: "Apa syarat beasiswa Affirmation?"
Agent → Classifier: intent = kebijakan
Agent → Knowledge.search(query)
Knowledge → passages[{text, url, title, score}]
Agent → LLM (system: hanya dari passages, bahasa ID, wajib sitasi)
Agent → Staff: jawaban + Sumber: url/title
Agent → Log: intent, sources, tokens, user_id
```

### 4.2 Pertanyaan status pribadi

```text
Staff → Agent: "Cek status no. pendaftaran LP-2026-00123"
Agent → Classifier: intent = status_pribadi
Agent → extract_identifier(no_pendaftaran | nik | email)
Agent → StatusAPI.getStatus(identifier)   // tool call, bukan LLM guess
StatusAPI → 200 payload | 404 | 403 | 5xx
Agent → map ke kalimat Indonesia (tanpa menambah fakta)
Agent → Staff: status + tahapan + catatan (sesuai field API)
Agent → Audit: siapa lookup siapa, kapan, hasil (ada/tidak)
```

### 4.3 Campuran

```text
"Jelaskan syarat Affirmation dan cek status LP-2026-00123"
→ jalankan Knowledge + Status (parallel atau sequential)
→ gabungkan jawaban: bagian kebijakan (sitasi) + bagian status (dari API)
```

### 4.4 Di luar scope / gagal

| Kondisi | Perilaku |
|---------|----------|
| Intent tidak relevan LPDP | Tolak sopan, arahkan ke topik LPDP |
| RAG kosong / score rendah | "Tidak menemukan di sumber resmi website. Mohon cek portal atau hubungi [tim X]." |
| Status 404 | "Data tidak ditemukan untuk identitas tersebut." |
| Status API down | "Layanan status sedang tidak tersedia. Coba lagi / eskalasi." |
| Identifier ambigu | Tanya klarifikasi (NIK vs no. pendaftaran) |

---

## 5. Intent model (klasifikasi)

| Intent | Contoh | Tool |
|--------|--------|------|
| `kebijakan` | syarat, jadwal, jenis beasiswa, FAQ | `search_knowledge` |
| `status_pribadi` | status pendaftaran, tahapan, lulus/tidak | `get_application_status` |
| `campuran` | syarat + cek status | keduanya |
| `meta` | cara pakai asisten | tanpa tool |
| `di_luar_scope` | tipuan, non-LPDP, data sensitif tidak diizinkan | tolak |

Classifier bisa: LLM ringan + rules (regex NIK / pola no. pendaftaran).

---

## 6. Desain Status API (draft bersama)

API ini adalah **kontrak** antara AI LPDP dan sistem sumber data (eRISPRO / DB beasiswa / service baru).  
Bisa diimplementasi di service terpisah; AI LPDP hanya jadi **konsumen** dengan service token atau pass-through session.

### 6.1 Endpoint (usulan)

```http
POST /internal/v1/application-status
Authorization: Bearer <service_or_staff_token>
Content-Type: application/json
```

### 6.2 Request

```json
{
  "lookup_type": "registration_no",
  "lookup_value": "LP-2026-00123",
  "requested_by": {
    "user_id": 12,
    "username": "staf.budi",
    "source": "ai-lpdp-staff-assistant"
  }
}
```

`lookup_type` yang didukung (MVP):

| lookup_type | Keterangan |
|-------------|------------|
| `registration_no` | Nomor pendaftaran |
| `nik` | NIK (16 digit) — audit ketat |
| `email` | Email pendaftar |

### 6.3 Response sukses `200`

```json
{
  "status": "success",
  "data": {
    "registration_no": "LP-2026-00123",
    "full_name": "Budi Santoso",
    "program": "Affirmation",
    "batch": "2026-1",
    "application_status": "seleksi_wawancara",
    "application_status_label": "Seleksi Wawancara",
    "stage_updated_at": "2026-03-01T10:00:00+07:00",
    "notes_public": "Undangan wawancara dikirim via email",
    "university": null,
    "scholarship_year": 2026
  },
  "meta": {
    "source_system": "erispro",
    "retrieved_at": "2026-09-11T15:00:00+07:00"
  }
}
```

### 6.4 Response error

| HTTP | body `error_code` | Arti |
|------|-------------------|------|
| 400 | `INVALID_LOOKUP` | tipe/nilai tidak valid |
| 404 | `NOT_FOUND` | tidak ada data |
| 403 | `FORBIDDEN` | tidak diizinkan (kalau nanti ada restriction) |
| 429 | `RATE_LIMITED` | terlalu banyak lookup |
| 503 | `UPSTREAM_UNAVAILABLE` | sistem sumber down |

```json
{
  "status": "error",
  "data": null,
  "error_code": "NOT_FOUND",
  "message": "Data pendaftaran tidak ditemukan"
}
```

### 6.5 Aturan keamanan Status API

1. **Semua yang login** di AI LPDP boleh memanggil lewat asisten (sesuai keputusan).
2. Setiap lookup **wajib diaudit** (user_id, lookup_type/value hash atau full sesuai kebijakan LPDP, timestamp, hasil).
3. LLM **tidak** boleh mengisi field status dari pengetahuan sendiri.
4. Jangan tampilkan data yang tidak ada di payload API.
5. Rate limit per user (usulan: 30 lookup / 15 menit).
6. NIK di log: pertimbangkan mask `**************1234` kecuali audit forensik terpisah.

### 6.6 Field mapping → jawaban Indonesia (contoh)

| Field API | Kalimat |
|-----------|---------|
| `full_name` + `registration_no` | "Data atas nama **…**, no. **…**" |
| `application_status_label` | "Status saat ini: **…**" |
| `program` / `batch` | "Program: …, batch: …" |
| `notes_public` | "Catatan: …" |
| `stage_updated_at` | "Terakhir diubah: …" |

---

## 7. Crawler website (crawl semua — dengan guardrail)

### 7.1 Scope crawl

- **Seed:** domain resmi LPDP (konfirmasi exact host, mis. `lpdp.kemenkeu.go.id` + subdomain yang disetujui).
- **Mode:** ikut `sitemap.xml` + BFS link internal; hormati `robots.txt`.
- **“Crawl semua”** = semua halaman **publik HTML** dalam allowlist domain, **bukan**:
  - login-walled content
  - file unduhan masif tanpa perlu (opsional phase 2: PDF)
  - parameter trap / calendar infinite
  - aset binary (jpg/css/js) sebagai “dokumen pengetahuan”

### 7.2 Pipeline

```text
Seed URL
  → Fetch (rate limit, User-Agent LPDP-AI-Crawler)
  → Normalize URL (canonical, strip tracking query)
  → Extract title + main text (boilerplate removal)
  → Chunk (≈500–800 token, overlap)
  → Embed
  → Upsert ke KB (chunk_id, url, title, content_hash, fetched_at)
  → Re-crawl terjadwal (harian/mingguan) / manual “Reindex” di admin
```

### 7.3 Admin UI (minimal)

- Daftar sumber (URL, last_crawl, chunk count, status)
- Tombol **Crawl now** / **Reindex**
- Log error crawl (404, timeout)
- Toggle include/exclude path prefix (`/beasiswa`, `/faq`, …) jika perlu fine-tune setelah MVP

### 7.4 Risiko crawl “semua”

| Risiko | Mitigasi |
|--------|----------|
| Konten usang / bertentangan | Tampilkan `fetched_at` di sitasi; prioritas halaman bertanggal lebih baru |
| Halaman noise (berita lama) | Allow/deny path; skor retrieval + filter |
| Beban server LPDP | Rate limit + off-peak schedule |
| Halaman non-kebijakan | Classifier + retrieval threshold |

---

## 8. Prompt / perilaku agen (ringkas)

- Bahasa: **Indonesia**.
- Kebijakan: **hanya** dari hasil retrieval; wajib **Sumber**.
- Status: **hanya** dari Status API.
- Tidak tahu → akui; jangan mengarang.
- Jangan keluarkan rahasia internal yang tidak ada di KB/API.
- Identitas ganda / ambigu → tanya klarifikasi dulu.

---

## 9. Integrasi di repo AI LPDP saat ini

| Komponen existing | Dipakai untuk |
|-------------------|---------------|
| Admin session + CSRF | Auth staf |
| `chat.service.js` + Admin Chat UI | Surface asisten (mode baru) |
| OpenAI / Ollama settings | LLM + embeddings (OpenAI disarankan untuk embed) |
| `ai_extract_logs` / pricing | Perluas atau tabel log asisten khusus |
| Settings admin | Crawl schedule, Status API base URL + token |

**Baru (usulan modul):**

- `src/services/knowledge/` — crawl, chunk, embed, search  
- `src/services/status/` — client Status API  
- `src/services/staffAgent/` — orchestrator + tools  
- `sql/012_knowledge_base.sql` — documents, chunks, crawl_jobs  
- `sql/013_staff_assistant_audit.sql` — Q&A + status lookup audit  
- Admin pages: Knowledge sources, (opsional) Status API health  

---

## 10. Backlog sprint-ready

### Epic A — Knowledge & crawl

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| A1 | Seed domain + crawler hormati robots/sitemap | Crawl selesai; URL tersimpan; rate limit jalan |
| A2 | Extract text + chunk + embed | Chunk searchable; content_hash mencegah duplikat |
| A3 | `search_knowledge(query)` top-k | Return text + url + title + score |
| A4 | Admin: list sources + Reindex | Staf admin bisa trigger & lihat status |
| A5 | Jadwal re-crawl | Job periodik; stale pages ter-update |

### Epic B — Status API (desain + client)

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| B1 | Finalisasi kontrak API (doc + contoh) | Request/response disepakati stakeholder data |
| B2 | Mock Status API di AI LPDP (dev) | Postman/fixture 200/404/503 |
| B3 | Client `get_application_status` | Timeout, error_code mapping, tidak leak stack |
| B4 | Audit setiap lookup | Ada row: user, lookup, hasil, waktu |
| B5 | Rate limit lookup per user | 429 / pesan ramah saat berlebih |
| B6 | Hubungkan ke API production | Switch base URL via settings |

### Epic C — Staff Agent orchestrator

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| C1 | Intent classifier | Accurately route sample set (≥ kebijakan/status/campuran/luar) |
| C2 | Tool routing | Kebijakan→KB; status→API; campuran→keduanya |
| C3 | Jawaban ID + sitasi wajib (kebijakan) | Setiap jawaban kebijakan punya ≥1 sumber atau refusal |
| C4 | Refusal / klarifikasi | Kasus AC di §4.4 terpenuhi |
| C5 | Mode “Asisten LPDP” di Admin Chat | Toggle/mode; system prompt khusus |

### Epic D — Observability & governance

| ID | Story | Acceptance criteria |
|----|--------|---------------------|
| D1 | Log Q&A (intent, sources, tokens, cost) | Tampil di AI Logs / halaman khusus |
| D2 | Feedback 👍/👎 | Tersimpan untuk evaluasi |
| D3 | Eval set 30–50 pertanyaan | Skrip/manual score groundedness |
| D4 | Runbook konten | Siapa approve domain/path; SLA refresh |

---

## 11. Roadmap rilis

| Fase | Isi | Outcome |
|------|-----|---------|
| **MVP** | Crawl allowlist domain + RAG; chat asisten; sitasi; mock Status API + tool | Staf bisa tanya kebijakan dengan sumber; demo status |
| **v1** | Status API nyata; audit lookup; rate limit; re-crawl terjadwal | Produksi internal penuh |
| **v2** | `POST /api/v1/ask` (token internal); feedback; PDF crawl; path tuning | Integrasi sistem lain |
| **v3** | Eskalasi helpdesk; role lebih halus (jika kebijakan berubah); eval otomatis | Operasional mature |

---

## 12. Open items (butuh konfirmasi singkat)

1. **Exact domain seed** website (primary + subdomain).  
2. **Pemilik Status API** (tim eRISPRO / tim baru) & SLA.  
3. **Identifier utama** yang dipakai helpdesk sehari-hari (registration_no vs NIK).  
4. **Apakah PDF** di website ikut di-ingest di MVP atau phase 2.  
5. **Retensi audit** lookup status (90 hari / 1 tahun).  

---

## 13. Definition of Done (produk MVP)

- [ ] Staf login bisa membuka Asisten LPDP di admin.  
- [ ] Pertanyaan kebijakan dijawab dalam Bahasa Indonesia dengan sitasi URL.  
- [ ] Jika tidak ada di KB → refusal jelas, bukan karangan.  
- [ ] Pertanyaan status memanggil Status API (mock atau real) dan diaudit.  
- [ ] Crawl + reindex bisa dijalankan dari admin.  
- [ ] Log token/cost tetap terpantau.  

---

## 14. Next workshop (30–45 menit)

Agenda usulan:

1. Kunci domain crawl + apakah PDF ikut MVP.  
2. Review field Status API (§6) — tambah/hapus field.  
3. Pilih identifier default helpdesk.  
4. Prioritas sprint 1: A1–A3 + C1–C3 + B1–B2.  

Setelah workshop, dokumen ini naik ke **v0.2 approved** dan bisa masuk development.
