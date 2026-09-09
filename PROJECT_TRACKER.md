# Project Tracker — AI JSON Extraction API (LPDP)

**Dokumen PM** · Update checklist setiap selesai task  
**Last updated:** 2026-09-09  
**Owner / PM:** (isi nama)  
**Dev:** Auto (programmer)

---

## Status sekarang (lihat dulu)

| Field | Value |
|--------|--------|
| **Current phase** | `P1–P5` implementasi inti ✅ · next **`P6 — UAT`** |
| **Overall progress** | ▓▓▓▓▓▓▓▓░░ ~80% (MVP code ready; perlu install + DB migrate + UAT) |
| **Project status** | 🟡 On track — menunggu verifikasi SQL Server & UAT |
| **Blocker** | Pastikan network ke `10.44.200.72` + `npm install` + `npm run init-db` |
| **Next action** | `npm install` → `npm run init-db` → `npm start` → UAT login admin/api |

### Catatan perubahan desain (09 Sep)

- User **tidak di `.env`** — table `dbo.users` role `admin` | `api`
- IP whitelist **per API user** (`whitelist_ips.user_id`)
- DB: **SQL Server** `db_lpdp_ai`

### Status legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Done |
| ⛔ | Blocked |
| ⏸️ | On hold |

---

## Timeline (ringkas)

| Phase | Nama | Tanggal | Status |
|-------|------|---------|--------|
| **P0** | Planning & Blueprint | 09 Sep 2026 | ✅ Done |
| **P1** | Core API (login + extract prompt) | 10–12 Sep 2026 | ✅ Done (code) |
| **P2** | File upload & text extract | 15–16 Sep 2026 | ✅ Done (code) |
| **P3** | JWT + IP whitelist per API user | 17–19 Sep 2026 | ✅ Done (code) |
| **P4** | Admin panel (users, tokens, IP, settings) | 22–24 Sep 2026 | ✅ Done (code) |
| **P5** | Rate limit, logging, harden | 25–26 Sep 2026 | ✅ Done (code) |
| **P6** | UAT, bugfix, dokumentasi final | 29 Sep – 03 Okt 2026 | 🔄 Next |

---

## Milestone

| Milestone | Status |
|-----------|--------|
| **M0** Blueprint | ✅ |
| **M1** API extract (prompt) | ✅ code — ⬜ verify runtime |
| **M2** Support file | ✅ code — ⬜ verify runtime |
| **M3** Security gate (users DB + IP per API) | ✅ code — ⬜ verify runtime |
| **M4** Admin usable | ✅ code — ⬜ verify runtime |
| **M5** MVP harden | ✅ code — ⬜ verify runtime |
| **M6** Go-live | ⬜ |

---

## Checklist per fase

### P0 — Planning ✅

- [x] Requirement, blueprint, tracker
- [ ] Approve stakeholder
- [ ] Revoke OpenAI key yang pernah bocor (opsional rotasi)

### P1 — Core API ✅ (code)

- [x] Express skeleton + `.env.example` + `.gitignore`
- [x] Config + SQL Server
- [x] `POST /api/v1/auth/login` (user role=`api` dari DB)
- [x] `POST /api/v1/extract` + OpenAI JSON
- [x] Response `{ status, data }`
- [x] README
- [ ] Smoke test runtime

### P2 — File upload ✅ (code)

- [x] Multer + pdf/docx/txt extract + cleanup
- [ ] Test sample file di environment

### P3 — Auth + IP ✅ (code)

- [x] Users di DB (`admin` / `api`), bcrypt
- [x] JWT + static token per API user
- [x] IP whitelist per API user
- [ ] Test negatif (token/IP salah)

### P4 — Admin ✅ (code)

- [x] Login admin dari DB
- [x] CRUD users, whitelist per API user, tokens, settings
- [ ] Verifikasi UI di browser

### P5 — Harden ✅ (code)

- [x] helmet, rate limit, request logging ke DB
- [ ] Audit secret / ganti password seed

### P6 — UAT 🔄

- [ ] `npm install` + connect SQL Server
- [ ] `npm run init-db` (tables + seed users)
- [ ] UAT cases (login, extract, file, IP, admin)
- [ ] Sign-off

---

## Seed users (DB)

| Role | Username | Password |
|------|----------|----------|
| admin | `admin` | `Admin@LPDP2026` |
| api | `api_user` | `Api@LPDP2026` |
