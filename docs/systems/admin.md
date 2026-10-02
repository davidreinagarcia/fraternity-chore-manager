# Admin (página de ajustes)

Navegación de Admin en `OfficerDashboard.html`, al estilo de los Settings de cualquier app.

## Estado

Hecho (2026-10-02). Sustituye a los acordeones (dropdowns) que había antes dentro de la pestaña Admin.

## Cómo funciona

- Al pulsar **Admin** en la barra principal, `showSection('admin')` añade la clase `admin-mode` a `#dash-layout`: se oculta `#sb` y aparece `#sb-admin`, una barra lateral propia con:
  - Botón **Back to dashboard** arriba (`exitAdmin()` vuelve a la última sección abierta, `_lastSection`).
  - Una entrada por página, agrupadas en General (Share Links, Config Editor, Drive Storage), Operations (Chore Manager, Philanthropy, Semester Tools, Custom Forms Manager) y Access (Officer Handoff).
- Cada página es un `.admin-section[data-ap="admin-xxx"]`; solo una tiene la clase `on`. `showAdminPage(id)` cambia de página, actualiza el título de la topbar ("Admin: <página>") y carga los datos la primera vez (`_adminSectionsLoaded`).
- `openAdminPage(id)` abre Admin directamente en una página (lo usa el enlace "Semester forms" de la sección Forms).
- Se recuerda la última página (`_adminPage`) al volver a entrar en Admin.
- Auto-Split Members (antes una tarjeta suelta arriba de Admin) vive ahora dentro de la página Chore Manager.

- Philanthropy (`admin-philanthropy`): objetivo de horas, acción de fin de semestre, carry-over y botón de cierre. Detalle en [philanthropy.md](./philanthropy.md). También se abre desde el botón "Philanthropy settings" de la sección Philanthropy (`openAdminPage('admin-philanthropy')`).

## Para añadir una página nueva

1. Botón en `#sb-admin` con `data-ap="admin-nueva"` y `onclick="showAdminPage('admin-nueva')"`.
2. Bloque `<div class="admin-section" data-ap="admin-nueva">` con su `admin-section-header` (h2) y `admin-section-body`.
3. Si necesita carga de datos al abrirse, añadir su rama en `showAdminPage()`.

## Tests

Probado con el harness local (template real + `google.script.run` simulado) en Playwright: entrada/salida, cambio de páginas, memoria de página y enlace desde Forms. No probado contra el deployment real.
