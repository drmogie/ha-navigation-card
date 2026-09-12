# HA Navigation Card

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=drmogie&repository=ha-navigation-card&category=plugin)
[![Open your Home Assistant instance and show your dashboard resources.](https://my.home-assistant.io/badges/lovelace_resources.svg)](https://my.home-assistant.io/redirect/lovelace_resources/)

A background (non-visual) Home Assistant Lovelace card that watches for user
inactivity on a kiosk/wall-mounted dashboard and automatically navigates to
an "idle" view (e.g. a screensaver dashboard). As soon as the user interacts
again, it navigates back to your normal "home" view.

Designed for Lovelace **Sections** dashboards on current Home Assistant
releases, with a full visual (GUI) configuration editor - no YAML required.

## Installation

### HACS (recommended)

1. In HACS, go to **Frontend** > menu (top right) > **Custom repositories**.
2. Add this repository URL, category **Lovelace**.
3. Install **HA Navigation Card** and reload your browser.

### Manual

1. Copy `ha-navigation-card.js` and `ha-navigation-card-editor.js` into
   `config/www/ha-navigation-card/`.
2. Add the resource in **Settings > Dashboards > Resources**:
   - URL: `/local/ha-navigation-card/ha-navigation-card.js`
   - Type: JavaScript Module

## Usage

Add a new card to any dashboard view (this card renders nothing visible, so
placement on the page doesn't matter) and configure it with the GUI editor,
or with YAML:

```yaml
type: custom:ha-navigation-card
idle_seconds: 60
idle_path: /lovelace-kiosk/screensaver
wake_path: /lovelace-kiosk/home
only_watch_path: /lovelace-kiosk/home
```

| Option | Required | Default | Description |
|---|---|---|---|
| `idle_seconds` | No | `60` | Seconds of inactivity before navigating to `idle_path`. |
| `idle_path` | **Yes** | - | Dashboard path to navigate to when idle (your screensaver view). |
| `wake_path` | No | - | Dashboard path to return to when the user interacts while on `idle_path`. |
| `only_watch_path` | No | - | If set, the idle timer only arms while on this exact path. Leave blank to arm it on every view except `idle_path`. |

## Versioning

Releases are tagged `YYYY.MM.DD.#` (e.g. `2026.09.12.1`).

## License

MIT - see [LICENSE](LICENSE).
