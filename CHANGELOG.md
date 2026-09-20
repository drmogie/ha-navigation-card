# Changelog

All notable changes to this project are documented here. Versioning is
`YYYY.MM.DD.##`, matching the GitHub Release tags.

## 2026.09.20.03 - 2026-09-20

- Dropped the version number from the card's `window.customCards` display
  name (was `Navigation Card (2026.09.20.02)`) so the "Add Card" picker
  entry stays stable across releases, matching the plain "Navigation
  Card" name used everywhere else.
- Added this CHANGELOG.md and a `.gitignore`.

## 2026.09.20.02 - 2026-09-20

- Debug panel is now off by default on a freshly-added card
  (`getStubConfig()` previously set `debug: true`).
- The GUI editor's "Show progress bar" toggle now correctly shows on by
  default for `navigation_mode: back`, matching what the card actually
  renders (it was already on-by-default at runtime; the editor just
  displayed it as off).

## 2026.09.20.01 - 2026-09-20

- Added `getGridOptions()` so the card sizes itself correctly in
  Lovelace **Sections** dashboards (width/height), matching the states
  `getCardSize()` already handled for Masonry view.

## 2026.09.12.3 - 2026-09-15

**Breaking change:** replaced the old `idle_path` / `wake_path` /
`only_watch_path` config with `navigation_mode` / `navigation_path` /
`timeout`. Existing card configs need to be re-created with the new
schema.

- Rewrote as a single-file card with four independent modes:
  `back` (history.back on idle timeout), `path` (navigate to a fixed
  destination on idle timeout), `screensaver` (always-listening,
  wake-only, no timeout), and `none` (disabled).
- Added motion-sensor wake support (`motion_entity` /
  `motion_active_state`), a tap-to-pause idle progress bar, and a debug
  panel with live status/activity/motion diagnostics.
- Added a shared circuit breaker and navigation cooldown to guard
  against runaway navigation loops.
- Rebuilt the GUI editor on `ha-form` with a mode-aware schema,
  replacing the earlier hand-rolled text fields.
- Vendored Lit locally (`lit-core.min.js`) instead of importing it from
  a CDN at runtime, so the card works fully offline.
- Corrected the display name to drop the `HA`/card-type prefix per
  naming convention.

## 2026.09.12.1 - 2026-09-12

- Initial release: idle-timeout kiosk screensaver navigation card, with
  `idle_path` / `wake_path` / `only_watch_path` config and a GUI editor.
