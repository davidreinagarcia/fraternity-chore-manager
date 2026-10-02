# Systems Index

Punto de entrada obligatorio antes de tocar o crear código de cualquier parte del proyecto.
Si el sistema ya tiene fichero, entra directo en vez de reconstruir contexto desde cero.
Si no lo tiene, créalo desde [`_template.md`](./_template.md) y añade la fila aquí en el mismo commit.

## Core

| Sistema | Estado | Fuente | Doc |
|---|---|---|---|
| Routing & entry point | Hecho | `Code.gs` → `doGet()` | — |
| Config / vocabulary / módulos | Hecho | `Code.gs` → `getChapterConfig()` | [config.md](./config.md) |
| Semester tools & rollover | Hecho (básico) | `Code.gs` → `runSemesterSync()` | — |
| CSV import / member migration | Hecho | `Code.gs` → `importMembersFromCSVText()` | — |

## Chores & Fines

| Sistema | Estado | Fuente | Doc |
|---|---|---|---|
| Weekly chore assignment | Hecho | `Code.gs` → `assignChores()` | [chores-fines.md](./chores-fines.md) |
| Photo submission (member-facing) | Hecho | `SubmitApp.html` + `Code.gs` → `processSubmission()` | [chores-fines.md](./chores-fines.md) |
| Photo validation (Vision API) | Hecho | `PhotoCheck.gs` | [chores-fines.md](./chores-fines.md) |
| Fine enforcement | Hecho | `Code.gs` → `issueFines()` | [chores-fines.md](./chores-fines.md) |

## Members

| Sistema | Estado | Fuente | Doc |
|---|---|---|---|
| Member manager UI | Hecho | `OfficerDashboard.html` → Members | [members.md](./members.md) |
| Member CRUD (add/edit/status) | Hecho | `Code.gs` → `saveMember()`, `updateMemberStatus()` | [members.md](./members.md) |
| Alumni contact view | Hecho | `OfficerDashboard.html` → Members → Alumni | [members.md](./members.md) |
| CSV export | Hecho | `OfficerDashboard.html` → Admin | [members.md](./members.md) |

## Associate Members (AM / Pledge system)

| Sistema | Estado | Fuente | Doc |
|---|---|---|---|
| AM manager (puntos, estado) | Hecho | `OfficerDashboard.html` → Members → AMs | [am-system.md](./am-system.md) |
| AM events & attendance (legacy) | Hecho | `AMEvents.gs` | [am-system.md](./am-system.md) |
| AM signature self-service | Hecho | `SignatureApp.html` + `Signatures.gs` | [am-system.md](./am-system.md) |
| Signatures dashboard (officer) | Hecho | `OfficerDashboard.html` → Members → Signatures | [am-system.md](./am-system.md) |

## Events & Calendar

| Sistema | Estado | Fuente | Doc |
|---|---|---|---|
| Chapter events (CRUD, recurrencia) | Hecho | `Events.gs` + `OfficerDashboard.html` → Events | [events.md](./events.md) |
| Event attendance (roll call) | Hecho | `Events.gs` + `event_attendance` tab | [events.md](./events.md) |
| Google Calendar sync (one-way push) | Hecho | `Events.gs` → `syncPendingEvents()` | [events.md](./events.md) |
| Google Calendar sync (two-way pull) | Hecho | `EventsTwoWay.gs` → `pullCalendarChanges()` | [events.md](./events.md) |

## Forms

| Sistema | Estado | Fuente | Doc |
|---|---|---|---|
| Form builder nativo | Hecho | `Forms.gs` + `OfficerDashboard.html` → Forms | [forms.md](./forms.md) |
| Forms public page | Hecho | `FormApp.html` (`?app=form&f=<id>`) | [forms.md](./forms.md) |
| Absence request form | Hecho | `Forms.gs` → `_fmExcusesForEvent()` | [forms.md](./forms.md) |
| Philanthropy hours (form + página) | Hecho | `Forms.gs` → `fmPhilanthropySummary()` + `OfficerDashboard.html` → Philanthropy | [forms.md](./forms.md) |
| Photo upload field (galería → Drive) | Hecho | `Forms.gs` → `_fmSavePhoto()` + `FormApp.html` | [forms.md](./forms.md) |
| Party guest list form (solo el form) | Hecho; gestión de la lista pendiente | plantilla "Party guest list" del builder | [forms.md](./forms.md) |
| Custom Forms (NM/RM, Google Forms) | Hecho | `CustomForms.gs` | — |
| Form reminders | Hecho | `CustomForms.gs` → `sendFormReminders()` | — |
| Response tracking | Hecho | `CustomForms.gs` → `getFormResponses()` | — |

## Admin & Setup

| Sistema | Estado | Fuente | Doc |
|---|---|---|---|
| Setup wizard (nueva instalación) | Hecho | `SetupApp.html` + `Code.gs` → `initChapter()` | [`../DEPLOYMENT.md`](../DEPLOYMENT.md) |
| Drive storage (carpeta raíz + estructura de fotos) | Hecho | `DriveStorage.gs` + `OfficerDashboard.html` → Admin → Drive Storage | [drive-storage.md](./drive-storage.md) |
| Config editor (officer) | Hecho | `OfficerDashboard.html` → Admin → Config Editor | [config.md](./config.md) |
| Officer handoff & PIN change | Hecho | `OfficerDashboard.html` → Admin → Officer Handoff | — |
| Draft Night board | Hecho | `DraftApp.html` | — |
| QR generation | Hecho | `Code.gs` → `generateQRCodes()` | — |
| Demo data (dev) | Hecho | `Seed.gs` → `loadDemoData()` / `removeDemoData()` | [demo-data.md](./demo-data.md) |

## Pendiente / no empezado

| Sistema | Estado |
|---|---|
| Auto-fines por eventos de hermanos | Planeado (base: `event_attendance` + audience ya existe) |
| Multi-day events | Planeado |
| Unificación AM Events → Events unificado | Planeado |
| Dues tracker | Planeado |
| License key validation (antes de primera venta) | Planeado |
