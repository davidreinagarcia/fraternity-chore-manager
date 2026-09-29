# Systems Index

Quick reference for every functional subsystem in the codebase.
Each entry links to the deeper doc if one exists, or points to the source file directly.

## Core

| System | Source | Doc |
|---|---|---|
| Routing & entry point | `Code.gs` → `doGet()` | — |
| Config / vocabulary / module flags | `Code.gs` → `getChapterConfig()` | [CONFIGURATION.md](../CONFIGURATION.md) |
| Semester tools & rollover | `Code.gs` → `runSemesterSync()` | — |
| CSV import / member migration | `Code.gs` → `importMembersFromCSVText()` | — |

## Chores & Fines

| System | Source | Doc |
|---|---|---|
| Weekly chore assignment | `Code.gs` → `assignChores()` | — |
| Photo submission (member-facing) | `SubmitApp.html` + `Code.gs` → `processSubmission()` | — |
| Photo validation (Vision API) | `PhotoCheck.gs` | — |
| Fine enforcement | `Code.gs` → `issueFines()` | — |
| Fine override (officer) | `OfficerDashboard.html` → Admin accordion | — |

## Members

| System | Source | Doc |
|---|---|---|
| Member manager UI | `OfficerDashboard.html` → Members section | — |
| Alumni contact view | `OfficerDashboard.html` → Members → Alumni | — |
| Member CRUD (add/edit/status) | `Code.gs` → `saveMember()`, `updateMemberStatus()` | — |

## Associate Members (AM / Pledge system)

| System | Source | Doc |
|---|---|---|
| AM manager (points, status) | `OfficerDashboard.html` → Members → AMs | — |
| AM events & attendance | `AMEvents.gs` + `OfficerDashboard.html` → Members → AM Events | — |
| AM signature self-service | `SignatureApp.html` + `Signatures.gs` | — |
| Signatures dashboard (officer) | `OfficerDashboard.html` → Members → Signatures | — |

## Forms

| System | Source | Doc |
|---|---|---|
| Custom Forms (NM/RM) | `CustomForms.gs` + `OfficerDashboard.html` → Admin → Custom Forms | — |
| Form reminders | `CustomForms.gs` → `sendFormReminders()` | — |
| Response tracking | `CustomForms.gs` → `getFormResponses()` | — |

## Admin & Setup

| System | Source | Doc |
|---|---|---|
| Setup wizard (new install) | `SetupApp.html` + `Code.gs` → `initChapter()` | [DEPLOYMENT.md](../DEPLOYMENT.md) |
| Config editor (officer) | `OfficerDashboard.html` → Admin → Config Editor | [CONFIGURATION.md](../CONFIGURATION.md) |
| Officer handoff & PIN change | `OfficerDashboard.html` → Admin → Officer Handoff | — |
| Draft Night board | `DraftApp.html` | — |
| QR generation | `Code.gs` → `generateQRCodes()` | — |

## Planned (not yet built — see product roadmap)

| System | Status |
|---|---|
| Attendance unified (brothers + AMs) | Planned |
| Google Calendar integration | Planned |
| Dues tracker | Planned |
| Philanthropy hours | Planned |
| Financial dashboard | Planned |
| License key validation | Planned (before first sale) |
