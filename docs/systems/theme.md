# Theme (estilo visual)

Capa visual compartida estilo apps de Google (admin console / Forms): superficies planas blancas, bordes 1px `#dadce0`, controles 4px, cards 8px, tabs con subrayado, Roboto, sombra solo en overlays.

## Estado

Hecho (2026-10-02). Solo estilo, el layout de cada app no cambió.

## Cómo funciona

- `apps-script/Theme.html` se incluye al final del `<head>` de las apps claras (Officer, MemberView, Setup, Form, Signature, Submit) con `<?!= include('Theme') ?>` y sobrescribe los tokens y componentes del CSS propio de cada página.
- El color del chapter sigue siendo `--primary` (viene de `cfg.chapter.primary_color`); los tints usan `color-mix(in srgb, var(--primary) 10%, #fff)`.
- Apps oscuras (Draft, Home, MemberDirectory) no incluyen Theme: usan paleta dark de Google (`#202124`/`#292a2d`) en su propio CSS.
- Formularios públicos móviles: card con borde superior de 8px del color primary (look Google Forms).
- `ButtonFeedback.html`: barra de progreso sólida 2px en `--primary`.

## Reglas para UI nueva

- Toda app clara nueva incluye `Theme`. Usar los tokens (`--border`, `--muted`, `--tint`, `--hover`, `--green/--red/--yellow` y sus `-bg`).
- Nada de gradientes, radios grandes (>8px) ni sombras en cards. Texto sobre fondo primary en blanco, no en gold.
