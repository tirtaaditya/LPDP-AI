# SIT — System Integration Test (AI LPDP)

| | |
|--|--|
| **Dokumen** | System Integration Testing |
| **Aplikasi** | AI LPDP |
| **Versi dokumen** | 1.0 |
| **Tanggal** | 11 September 2026 |
| **Tujuan** | Memverifikasi integrasi antar komponen (Admin UI, API, DB, AI provider, file, keamanan) sebelum UAT |

**Ilustrasi aplikasi:** lihat [`MANUAL_BOOK.md`](./MANUAL_BOOK.md) dan folder [`images/`](./images/).

---

## 1. Ruang lingkup

| In scope | Out of scope |
|----------|----------------|
| Boot app + migrate/seed DB | Staff Assistant (flow draft) |
| Admin login → semua modul CRUD | Performance load test penuh |
| API health / login / extract (URL + upload) | Penetration test formal |
| OpenAI dan/atau Ollama (sesuai env SIT) | Integrasi eRISPRO end-to-end di luar kontrak extract |
| Whitelist, token, logs, pricing snapshot | |

---

## 2. Environment SIT

| Item | Nilai (isi saat eksekusi) |
|------|---------------------------|
| Base URL | `http://____:____` |
| DB | `db_lpdp_ai` / host `____` |
| AI provider | OpenAI / Ollama |
| Tester | |
| Build / commit | |
| Tanggal eksekusi | |

**Prasyarat**

- [ ] `.env` terisi (DB, JWT secret, session secret, PORT)
- [ ] `npm install` & `npm start` (atau PM2) sukses
- [ ] `GET /health` → `status: ok`
- [ ] `GET /api/v1/health` → `status: success`
- [ ] Postman collection diimpor (`docs/AI_LPDP.postman_collection.json`)

---

## 3. Matriks integrasi

```text
[Browser Admin] ──CSRF+Session──► [Express /admin] ──► [SQL Server]
[API Client]    ──Bearer+IP────► [Express /api/v1] ──► [SQL Server]
                                      │
                                      ├── file download / multer ──► uploads/
                                      └── OpenAI / Ollama
```

![Arsitektur](./images/manual-architecture.png)

---

## 4. Test cases SIT

**Legenda hasil:** `P` Pass · `F` Fail · `B` Blocked · `N/A`

### 4.1 Infrastruktur & health

| ID | Case | Langkah | Expected | Hasil | Keterangan |
|----|------|---------|----------|-------|------------|
| SIT-INF-01 | App start | Start service, cek log | Listen PORT, migrate/seed tanpa error fatal | | |
| SIT-INF-02 | Health root | `GET /health` | `status=ok`, ada `scheme`, `time` | | |
| SIT-INF-03 | Health API | `GET /api/v1/health` | `{ status:"success", data.ok:true }` | | |
| SIT-INF-04 | Static CSS | Buka `/admin/login`, cek Network CSS | `admin.css` 200, halaman tidak “blank putih” | | |

### 4.2 Admin auth & session

| ID | Case | Langkah | Expected | Hasil | Keterangan |
|----|------|---------|----------|-------|------------|
| SIT-ADM-01 | Login sukses | Username/password admin + captcha benar | Redirect dashboard, cookie session | | |
| SIT-ADM-02 | Captcha salah | Isi captcha salah | Tetap di login + error | | |
| SIT-ADM-03 | Captcha refresh | Panggil refresh + image baru | Image berubah, login dengan kode baru OK | | |
| SIT-ADM-04 | Captcha audio | Putar audio | Bunyi / WAV tersedia | | |
| SIT-ADM-05 | CSRF login | POST login tanpa `_csrf` | Ditolak (403/error CSRF) | | |
| SIT-ADM-06 | Logout | POST logout | Session hilang, redirect login | | |
| SIT-ADM-07 | Proteksi route | Buka `/admin/users` tanpa login | Redirect login | | |
| SIT-ADM-08 | Ganti password | Ubah password → logout → login baru | Sukses; password lama gagal | | |

![Login](./images/manual-login.png)

### 4.3 Admin modul (integrasi UI ↔ DB)

| ID | Case | Langkah | Expected | Hasil | Keterangan |
|----|------|---------|----------|-------|------------|
| SIT-UI-01 | Dashboard | Buka `/admin` | Angka & chart render tanpa error 500 | | |
| SIT-UI-02 | Users CRUD | Create api user → edit → list | Data di DB & UI konsisten | | |
| SIT-UI-03 | User delete | Hapus user uji | Hilang dari list | | |
| SIT-UI-04 | Whitelist CRUD | Tambah IP untuk api user | Tersimpan; edit/delete OK | | |
| SIT-UI-05 | Token create | Buat token, salin nilai | Token sekali tampil; list muncul | | |
| SIT-UI-06 | Token revoke | Revoke → panggil extract | 401 | | |
| SIT-UI-07 | Settings save | Ubah temperature/max_tokens → save | Nilai persist di DB; reload sama | | |
| SIT-UI-08 | Settings provider | Set openai key (SIT) / ollama URL | Runtime extract pakai setting baru | | |
| SIT-UI-09 | Logs list | Buka AI Logs + DataTables | Data JSON load | | |
| SIT-UI-10 | Log detail | Buka detail by id | Prompt/response/meta terlihat | | |

![Dashboard](./images/manual-dashboard.png)
![Users](./images/manual-users.png)
![Settings](./images/manual-settings.png)

### 4.4 API auth & keamanan

| ID | Case | Langkah | Expected | Hasil | Keterangan |
|----|------|---------|----------|-------|------------|
| SIT-API-01 | Login API | POST login `api_user` | `access_token` + role api | | |
| SIT-API-02 | Login admin via API | Login username role admin | Ditolak (bukan api) | | |
| SIT-API-03 | Extract tanpa Bearer | POST extract | 401 | | |
| SIT-API-04 | Extract JWT | Bearer JWT valid + prompt | 200 success | | |
| SIT-API-05 | Extract static token | Bearer token admin | 200 success | | |
| SIT-API-06 | Whitelist ON + IP salah | Enable whitelist, IP tidak terdaftar | 403 | | |
| SIT-API-07 | Whitelist ON + IP benar | IP di whitelist | 200 | | |
| SIT-API-08 | Whitelist OFF | Disable setting | Extract jalan tanpa cek IP | | |
| SIT-API-09 | Rate limit (opsional) | Burst > limit login/API | 429 | | |

### 4.5 Extract — integrasi file & AI

| ID | Case | Langkah | Expected | Hasil | Keterangan |
|----|------|---------|----------|-------|------------|
| SIT-EX-01 | Prompt only | JSON `prompt` saja | `status=success`, `data` object, ada `meta.request_id` | | |
| SIT-EX-02 | schema_hint | + `schema_hint` | Struktur mendekati hint | | |
| SIT-EX-03 | file_urls | URL PDF/DOCX reachable | File di meta; data terisi | | |
| SIT-EX-04 | file_uploads | Multipart 1–N file | Sukses; temp cleaned | | |
| SIT-EX-05 | Hybrid | URL + upload | Total ≤10 OK | | |
| SIT-EX-06 | >10 files | 11 file | 400 validation | | |
| SIT-EX-07 | Tipe ditolak | Ext di luar allowed | 400 | | |
| SIT-EX-08 | Oversize | File > max_upload_mb | 400 | | |
| SIT-EX-09 | URL unreachable | URL mati/timeout | Error jelas / log | | |
| SIT-EX-10 | Scanned PDF/image | File vision (OpenAI) | Meta scanned/vision path; jawaban dari isi | | |
| SIT-EX-11 | Ollama text | Provider ollama, PDF text | Sukses (tanpa vision) | | |
| SIT-EX-12 | Log terisi | Setelah extract sukses/gagal | Row di AI Logs + cost jika usage ada | | |

### 4.6 Admin Chat integrasi

| ID | Case | Langkah | Expected | Hasil | Keterangan |
|----|------|---------|----------|-------|------------|
| SIT-CH-01 | Chat text | Kirim pesan | Reply JSON OK di UI | | |
| SIT-CH-02 | Chat + file | Upload PDF/TXT | Jawaban memakai konteks file | | |
| SIT-CH-03 | Chat CSRF | POST tanpa X-CSRF-Token | Ditolak | | |
| SIT-CH-04 | Image gen | Mode image / `/image` (OpenAI) | Image kembali; log tercatat | | |
| SIT-CH-05 | Image di Ollama | Provider ollama + image | Error ramah / tidak crash | | |

![Chat](./images/manual-chat.png)
![Logs](./images/manual-logs.png)

### 4.7 Observability & pricing

| ID | Case | Langkah | Expected | Hasil | Keterangan |
|----|------|---------|----------|-------|------------|
| SIT-OBS-01 | Cost fields | Extract dengan usage | `cost_usd` / `cost_idr` terisi sesuai setting harga | | |
| SIT-OBS-02 | Dashboard usage | Beberapa panggilan AI | Chart/aggregate naik | | |

---

## 5. Data uji disarankan

| Data | Keterangan |
|------|------------|
| PDF teks kecil | Extract teks |
| PDF scan / JPG | Vision (OpenAI) |
| DOCX / TXT | Text pipeline |
| URL internal reachable | Validasi download server-side |
| URL 404 | Negatif |

---

## 6. Exit criteria SIT

SIT **lulus** jika:

- [ ] Semua case **Critical** (INF, ADM-01/07, API-01/03/04, EX-01/04, UI-07) = Pass
- [ ] Tidak ada defect **Blocker / Critical** terbuka
- [ ] Defect Medium terdokumentasi & disepakati residual risk
- [ ] Hasil ditandatangani Tester + Tech Lead

---

## 7. Defect log (template)

| Defect ID | SIT Case | Severity | Deskripsi | Status | Fix build |
|-----------|----------|----------|-----------|--------|-----------|
| DEF- | | Blocker/Critical/Major/Minor | | Open/Fixed | |

---

## 8. Ringkasan eksekusi

| Metrik | Jumlah |
|--------|--------|
| Total case | |
| Pass | |
| Fail | |
| Blocked | |
| N/A | |
| **Kesimpulan** | **PASS / FAIL / PASS WITH NOTES** |

| Peran | Nama | Tanda tangan | Tanggal |
|-------|------|--------------|---------|
| Tester SIT | | | |
| Developer / Tech Lead | | | |
| QA Lead | | | |

---

**Referensi:** [`MANUAL_BOOK.md`](./MANUAL_BOOK.md) · [`API.md`](./API.md) · [`UAT.md`](./UAT.md)
