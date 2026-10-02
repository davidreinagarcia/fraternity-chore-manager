# Demo data

Datos ficticios para seguir el desarrollo en la dev sheet con tabs poblados.

## Estado

Hecho (2026-10-02).

## Cómo funciona

`Seed.gs` → `loadDemoData()` (menú Fraternity System > Admin > Load demo data (dev)). Reemplaza el demo anterior y rellena:
28 hermanos activos (roles de oficial, 1 suspension, 1 probation, 1 academic suspension, 1 co-op) + 2 inactivos, 7 AMs con puntos,
8 alumni, 6 chores (crea `chore_ratios.json` solo si no existe) con asignaciones, submissions de la semana actual, multas de la
semana anterior, 15 eventos (pasados y futuros) con asistencia, AM events/attendance, signatures, notas y respuestas de
philanthropy (si el form existe).

Todos los ids llevan `DEMO` en la primera columna. `removeDemoData()` (menú Remove demo data) borra exactamente esas filas y
no toca datos reales. Personas ficticias: emails example.com, teléfonos 555. Eventos con `gcal_dirty` vacío (no se sincronizan
a Google Calendar).

## Decisiones abiertas

Las fotos son placeholders (placehold.co), no ficheros de Drive. Gestionar `config` (semester/week_start) solo si faltan.
