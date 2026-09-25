# Changelog

All notable changes to this project are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.5.0] — 2025

### Added
- **AM Event Points system**: calendar-based attendance tracking for associate members, replacing manual-only point entry
- Compact list view for AM events alongside the existing calendar view
- AM calendar opens on today's date by default
- To-date attendance percentage shown on AM calendar header

### Fixed
- Event dates saving one day early due to timezone off-by-one error
- AM dissociation now hard-deletes their row instead of marking inactive (was leaving ghost rows)
- AM event attendance records stripped on dissociation

---

## [1.4.0] — 2025

### Added
- **AM Signatures system**: dedicated submission app, automatic point award, Drive photo album per AM, officer dashboard tab
- Ability to delete a signature and revert the points it awarded
- iOS photo/library/camera picker support on the Signature form
- Auto-assign BK numbers on cross, in points order, with tie warning

### Fixed
- Public link: Apps Script test deployments enforce Google-account login unconditionally — documented and enforced use of versioned deployment only

---

## [1.3.0] — 2025 — Update 5

### Added
- Alumni contact view (lightweight tab: BK#, name, phone, email)
- Full CSV export (every field including GTID, BuzzCard, emergency contact, allergies, orgs)
- AM points: High Kappa role can assign/remove points; AM Manager list sorts by points descending
- Dedicated AM Manager page, separate from main Member Manager
- AMs moved to their own `AMs` sheet, separate from brothers

### Changed
- Semester Sync made safer: blank answers on returning-member form never overwrite existing data; ambiguous name matches are reported, never guessed
- Member Manager redesigned: colorful stats strip, hide obligation-free inactive members, Alumni as its own tab

---

## [1.2.0] — 2025 — Update 4

### Added
- Full member lifecycle management: status transitions, suspension, probation, audit trail
- Per-member expand row: secondary info without cluttering the main table
- Suspension/Probation place and lift from `···` context menu
- `move_to_alumni` flow; alumni never mix into active/inactive/all views
- Config Editor UI rewrite

---

## [1.1.0] — 2025 — Update 3

### Added
- QR code generation directly from the Officer Dashboard (single + ZIP of all chores)
- Alumni support (dedicated sheet, contact view, restore flow)
- Manual chore selection fallback on SubmitApp (no QR code required)
- PIN moved to config tab; Config Editor in Admin tab
- `?app=` routing consolidated under a single deployment URL

### Fixed
- Stale hardcoded deployment URL breaking inter-app navigation

---

## [1.0.0] — 2025 — Initial release

### Added
- Core chore submission flow: QR code → name select → photo upload
- Perceptual hash duplicate detection and EXIF date checking
- Monday Reset: automated fine writing, officer email, weekly rollover
- Officer Dashboard: this-week view, fine preview, member stats
- Draft Night Board: TV display mode and manager mode (PIN-gated)
- Chore auto-split and drag-and-drop manual assignment
- Member Manager: roster CRUD, import CSV, status management
- Semester Tools: Semester Sync (Google Forms integration), End-of-Semester Archive
- BigQuerySync: REST API sync for historical analytics
- ML skip-prediction notebook (Google Colab, requires 2+ semesters of data)
- `logs` sheet for error and info logging across all script functions
