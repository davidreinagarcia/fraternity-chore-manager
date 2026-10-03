# Theme (estilo visual)

Capa visual compartida estilo SaaS enterprise denso (Stripe/Datadog/GitHub Enterprise): superficies panel con borde 1px, sin sombras flotantes, badges con dot indicator, tabs con subrayado, tabular-nums en métricas, Roboto, elevación solo en overlays.

## Estado

Actualizado (2026-10-03). Refactorización visual completa eliminando el look "vibecoded" (tarjetas flotantes, pasteles, píldoras). Solo estilo — sin cambios de layout, jerarquía ni JS.

## Cómo funciona

- `apps-script/Theme.html` se incluye al final del `<head>` de las apps claras (Officer, MemberView, Setup, Form, Signature, Submit) con `<?!= include('Theme') ?>` y sobrescribe los tokens y componentes del CSS propio de cada página.
- El color del chapter sigue siendo `--primary` (viene de `cfg.chapter.primary_color`); los tints usan `color-mix(in srgb, var(--primary) 10%, #fff)`.
- Apps oscuras (Draft, MemberDirectory) no incluyen Theme: usan paleta dark de Google (`#202124`/`#292a2d`) en su propio CSS.
- Formularios públicos móviles: card con borde superior de 8px del color primary (look Google Forms).
- `ButtonFeedback.html`: barra de progreso sólida 2px en `--primary`.

## Tokens actuales

| Token | Valor | Nota |
|---|---|---|
| `--border` | `#e2e8f0` | slate-200, frío y limpio |
| `--text` | `#1e293b` | slate-800 |
| `--muted` | `#64748b` | slate-500 |
| `--radius` | `4px` | máximo de cards y controles |
| `--shadow` | `none` | cards sin sombra |
| `--elev-3` | `0 2px 8px rgba(0,0,0,.1)` | solo modales/paneles/toast |
| `--green` | `#15803d` | semántico, solo estados |
| `--red` | `#dc2626` | semántico, solo estados |
| `--yellow` | `#b45309` | semántico, solo estados |

## Reglas para UI nueva

- Toda app clara nueva incluye `Theme`. Usar tokens; nada de colores hardcoded salvo semánticos de estado.
- Cero `box-shadow` en cards o botones. Sin `border-radius` > 6px (modales pueden usar 6px, el resto 4px).
- Badges de estado: clase `badge badge-*`, representados como dot (6px `::before`) + texto semántico, sin background pastel.
- Chips de métricas (`mm-stat-chip`): outlined con borde semántico, sin relleno.
- Números en tablas y stat-cards: siempre `font-variant-numeric: tabular-nums`.

## Botón Home y marca

- `HomeButton.html` (vía `includeHome()` en `Code.gs`, justo tras `<body>`) pinta un botón flotante circular abajo a la derecha que lleva a `?app=home` desde todas las apps salvo HomeApp. Toda app nueva debe llamar a `<?!= includeHome() ?>`.
- HomeApp es ahora clara y usa la marca del chapter: franja superior `primary`, línea inferior `accent`, nombre en `primary`, logo (`logo_url`) con sus colores originales, iconos sobre tinte del accent.
- Subtítulo de HomeApp: "GreekEasy Digital" (nombre comercial del producto, no es vocabulario del chapter).
- Wordmark GreekEasy Digital en HomeApp: monograma ΓΕΔ en círculo doble (accent/primary), "GREEKEASY / DIGITAL" en Cinzel y grecas (meandro) en el accent a ambos lados, todo CSS puro (greca vía `mask` con SVG inline).
