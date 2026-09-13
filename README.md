# Navigation Card

A background (non-visual by default) Home Assistant Lovelace card for
kiosk/wall-mounted dashboards. It drives navigation between views based on
idle timeout, motion, or touch - no automations or scripts required.

Designed for Lovelace **Sections** dashboards on current Home Assistant
releases, with a full visual (GUI) configuration editor - no YAML required.

## Modes

Pick one `navigation_mode` per card instance - a dashboard typically uses
more than one card, each in a different mode, on different views:

| Mode | Behavior |
|---|---|
| `back` | On idle timeout, calls `history.back()`. One-shot. |
| `path` | On idle timeout, navigates to `navigation_path`. One-shot. |
| `screensaver` | No idle timeout of its own - always listening for activity (mouse, touch, keyboard, scroll, or a `motion_entity`). On activity, navigates to `navigation_path` if set, otherwise back to wherever you came from (tracked automatically). |
| `none` | Disabled entirely. |

A typical kiosk setup: a "menu" view has a `path`-mode card that idles out
to a "screensaver" view. The screensaver view has its own card in
`screensaver` mode - no timeout needed there - which just waits for a
touch/motion/click and sends you back to the menu.

The idle counter for `back`/`path` always resets fresh whenever the card
mounts (page load or return) and on any real activity event.

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=drmogie&repository=ha-navigation-card&category=plugin)

1. In HACS, go to **Frontend** > menu (top right) > **Custom repositories**.
2. Add this repository URL, category **Lovelace**.
3. Install **Navigation Card** and reload your browser.

### Manual

[![Open your Home Assistant instance and show your dashboard resources.](https://my.home-assistant.io/badges/lovelace_resources.svg)](https://my.home-assistant.io/redirect/lovelace_resources/)

1. Copy **both** `ha-navigation-card.js` and `lit-core.min.js` into
   `config/www/ha-navigation-card/` (same folder — the card imports the
   bundle by relative path).
2. Add the resource in **Settings > Dashboards > Resources**:
   - URL: `/local/ha-navigation-card/ha-navigation-card.js`
   - Type: JavaScript Module

`lit-core.min.js` is a vendored, self-contained build of the
[Lit](https://lit.dev) library (BSD-3-Clause, © Google LLC) with no
imports of its own, so the card works fully offline - no CDN, no internet
access required at dashboard-load time.

## Usage

Add a card to any dashboard view and configure it with the GUI editor, or
with YAML. Example - a menu view that idles out to a screensaver:

```yaml
# On the "menu" view
type: custom:ha-navigation-card
navigation_mode: path
timeout: 60
navigation_path: /lovelace-kiosk/screensaver
```

```yaml
# On the "screensaver" view
type: custom:ha-navigation-card
navigation_mode: screensaver
motion_entity: binary_sensor.hallway_motion
wake_on_touch: true
```

| Option | Applies to | Default | Description |
|---|---|---|---|
| `navigation_mode` | all | `screensaver` | `back` \| `path` \| `screensaver` \| `none` |
| `timeout` | `back`, `path` | `60` | Seconds of no activity before entering the target. Minimum `3`. |
| `navigation_path` | `path` (required), `screensaver` (optional) | - | `path` mode: destination to navigate to. `screensaver` mode: optional override for the wake destination; leave blank to return to wherever you came from. |
| `show_progress` | `back`, `path` | auto | Show the idle countdown progress bar. Leave unset for the default (on for `back`, off otherwise). |
| `debug` | all | `false` | Shows a debug panel with live status, activity counts, and motion-sensor state. |
| `motion_entity` | `screensaver` | - | An entity (typically a `binary_sensor`) that wakes the display when it matches `motion_active_state`. |
| `motion_active_state` | `screensaver` | `on` | State value that counts as "motion detected". Forced to `on` automatically for `binary_sensor.*` entities. |
| `wake_on_touch` | all | `true` | If `false`, mouse/scroll activity is ignored (only mousedown/keydown/touchstart, or motion, count). |
| `count_mousemove_as_activity` | all | `true` | Whether mouse movement (not just clicks) resets the idle timer / wakes the screensaver. |
| `count_scroll_as_activity` | all | `true` | Whether scroll/wheel events count as activity. |

Navigation is disabled entirely while a dashboard is in edit mode.

### Safety

- A shared circuit breaker pauses all navigation for 5 minutes if more than
  8 navigations happen within 10 seconds, regardless of cause.
- `navigation_path` values are auto-corrected to start with `/`, and
  refused outright if they ever grow past 200 characters - both guard
  against a runaway navigation loop.

## Versioning

Releases are tagged `YYYY.MM.DD.#` (e.g. `2026.09.12.3`).

## License

MIT - see [LICENSE](LICENSE).
