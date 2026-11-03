# Alerts

Plugin sólo-overlay para `streams-tools`: recibe eventos núcleo, selecciona una alerta y la muestra en una cola FIFO. Incluye el pack `default`, una página de previsualización y hojas CSS personalizables.

Es compatible con Twitch, Kick y YouTube y con los eventos `follow`, `sub`, `gift_sub`, `raid`, `donation`, `redemption` y `chat`. El host valida los eventos y parsea los manifiestos TOML de los packs; este plugin no parsea TOML.

## Instalación

Instala el repositorio como `plugins/alerts` dentro de `streams-tools`, por ejemplo:

```sh
git submodule add -b main <url> plugins/alerts
```

Reinicia `streams-tools`. En OBS añade un Browser Source con:

- URL: `http://127.0.0.1:7777/p/alerts/`
- Tamaño recomendado: 800 × 600 píxeles; ajusta el ancho a tu composición.

La configuración se edita en `plugins/alerts/plugin.toml` y se sirve al overlay como `config.json`.

## Configuración

| Clave de `[config]` | Default | Descripción |
|---|---:|---|
| `packs` | `[]` | Packs activos y su orden. Vacío activa todos los externos en el orden del índice. |
| `volume` | `1.0` | Volumen global, limitado a 0..1. |
| `gap_ms` | `250` | Pausa entre alertas, limitada a 0..60000 ms. |
| `max_queue` | `20` | Eventos pendientes máximos, limitado a 1..100. Al llenarse se descarta el evento nuevo. |
| `events` | `["follow", "sub", "gift_sub", "raid", "donation", "redemption"]` | Tipos habilitados; se filtran valores desconocidos y duplicados. |
| `chat_alerts` | `false` | Además debe contener `chat` en `events` para mostrar chats. |
| `test_mode` | `false` | Al cargar el catálogo encola un ejemplo determinista de cada tipo no-chat. |

## Selección y packs

Primero se descartan alertas de otro tipo, plataforma o condiciones no coincidentes. Después ganan, en este orden:

1. Mayor `priority`.
2. Mayor especificidad: un punto por `platforms`, `currency`, `min_amount`, `max_amount`, `min_months`, `min_count`, `min_viewers` y `reward_title` presentes.
3. El orden de `config.packs`; con `packs=[]`, el orden del índice.
4. Nombre de alerta ascendente.

Las variaciones se eligen por peso y heredan `template` y `sound` base; pueden aportar `image`. La sustitución de placeholders produce texto plano.

El pack `default` se activa si no existe ninguna alerta externa válida o si `packs` contiene explícitamente `"default"`. Además, cuando ningún pack activo tiene una alerta para un evento, se usa la alerta equivalente del pack `default`, así un pack que solo personaliza donaciones no deja sin alerta a follows o subs. El índice del host está en `/alerts/index.json`; conserva errores parciales sin invalidar las demás alertas.

La estructura del plugin es:

```text
alerts/
├── plugin.toml
└── overlay/
    ├── index.html
    ├── app.js
    ├── alerts-core.js
    ├── style.css
    ├── test.html
    └── packs/default/
        ├── index.json
        └── <alerta>/alert.toml y style.css
```

Para crear packs externos, condiciones, assets y variaciones, consulta [la documentación de packs del host](../../docs/alerts.md).

## Seguridad y render

El HTML y `script.js` opcionales de un pack son contenido estático confiable del disco. Los datos del evento nunca se interpolan en HTML: el título y los campos se escriben con `textContent`. Las imágenes sólo se asignan a `img[data-image]`; el JavaScript dinámico sólo cambia variables CSS con `style.setProperty`, nunca otros estilos inline.

Los eventos `st-alerts:show` y `st-alerts:hide` se emiten en `document` con `detail={pack, alert, eventType}`, sin texto del chat.

## Personalización CSS

Crea `styles/alerts.css` en el host y recarga el Browser Source. Se carga como `custom.css` después del CSS del plugin y de cada alerta. La raíz es `.st-alerts`; los elementos usan BEM:

- `.st-alerts__alert`, `.st-alerts__image`, `.st-alerts__content`, `.st-alerts__title`, `.st-alerts__message`.
- Estados `.st-alerts__alert--entering`, `--visible` y `--leaving`.
- Modificadores `--follow`, `--sub`, `--gift_sub`, `--raid`, `--donation`, `--redemption` y `--chat` sobre `.st-alerts__alert`.
- `data-pack` y `data-alert` identifican el origen en `.st-alerts__alert`.

Variables disponibles en `.st-alerts`:

| Variable | Variable |
|---|---|
| `--st-alerts-font-family` | `--st-alerts-width` |
| `--st-alerts-color` | `--st-alerts-background` |
| `--st-alerts-accent` | `--st-alerts-padding` |
| `--st-alerts-gap` | `--st-alerts-radius` |
| `--st-alerts-shadow` | `--st-alerts-title-size` |
| `--st-alerts-message-size` | `--st-alerts-image-size` |
| `--st-alerts-enter-duration` | `--st-alerts-exit-duration` |
| `--st-alerts-enter-transform` | `--st-alerts-exit-transform` |

Ejemplo de `styles/alerts.css`:

```css
.st-alerts {
  --st-alerts-width: 36rem;
  --st-alerts-font-family: Georgia, serif;
  --st-alerts-enter-duration: 400ms;
}

.st-alerts__alert[data-pack="default"][data-alert="donation"] {
  --st-alerts-accent: #fde047;
  border-width: 4px;
}
```

## Audio

Si una alerta o variación define `sound`, se reproduce con `new Audio(sound)`. El volumen es `alert.volume * config.volume`, saturado a 0..1. El navegador puede rechazar autoplay; el overlay captura ese rechazo y continúa la cola.

## Previsualización

Abre `http://127.0.0.1:7777/p/alerts/test.html`. El iframe muestra el overlay real; selecciona Twitch, Kick o YouTube y usa los siete botones para publicar eventos en `/api/events`. Las donaciones de prueba usan bits en Twitch y USD en YouTube/Kick. Con los defaults, chat no aparece salvo que actives sus dos opciones.

También puedes usar `test_mode=true` para encolar automáticamente los seis ejemplos no-chat al cargar.

## Desarrollo

No hay dependencias npm. Ejecuta las pruebas con Node 24 o compatible:

```sh
node --test
```

## Limitaciones

- No hay recarga en caliente: reinicia el host tras cambiar configuración o packs.
- El HTML y los scripts de packs se consideran confiables; instala sólo packs de confianza.
- La cola vive en memoria y se pierde al recargar o cerrar el overlay.
- El audio depende de las políticas de autoplay del navegador.
