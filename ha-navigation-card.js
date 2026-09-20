import { LitElement, html, css } from "./lit-core.min.js";

/**
 * ha-navigation-card.js
 *
 * MODES (navigation_mode) — fully independent of each other:
 *   - "back"        On idle timeout: history.back(). One-shot, done.
 *   - "path"        On idle timeout: navigate to `navigation_path`. One-shot, done.
 *   - "screensaver" NO idle timeout of its own. Always listening for
 *                    activity (mouse / touch / keyboard / `motion_entity`).
 *                    When activity happens, navigates to `navigation_path`
 *                    if you've set one, otherwise back to whatever page
 *                    you were on before landing here (tracked automatically
 *                    whenever ANY mode's card navigates you somewhere).
 *   - "none"        Disabled entirely.
 *
 * A typical kiosk setup: a "menu" view has a `path`-mode card that idles
 * out to a "screensaver" view. The screensaver view has its own card in
 * `screensaver` mode — no timeout needed there — which just waits for a
 * touch/motion and sends you back to the menu.
 *
 * `timeout` (seconds) drives the idle countdown for back/path only.
 * `navigation_path` is used by "path" (required) and optionally by
 * "screensaver" (as a wake-destination override; default is "wherever
 * you came from").
 *
 * The idle counter for back/path always resets fresh on mount (page
 * load/return).
 *
 * EDIT MODE: no action at all while the dashboard is being edited (or
 * ?edit=1), plus a centered "Navigation disabled while in edit mode"
 * banner, shown regardless of debug/show_progress.
 *
 * SAFETY:
 *  - `timeout` can never be 0/null/empty (falls back to the default).
 *  - A circuit breaker hard-stops all navigation for 5 minutes if more
 *    than 8 navigations happen within 10 seconds, for any reason.
 *  - Shared state is tagged with the card's version and auto-resets
 *    whenever the script changes, so leftover state from a previous
 *    version (e.g. during iterative testing) can't cause stale
 *    cooldowns/circuit-breaker trips to block a newer version.
 *
 * EXAMPLE CONFIG
 * ---------------
 * type: custom:ha-navigation-card
 * navigation_mode: screensaver
 * navigation_path: null
 * motion_entity: binary_sensor.hallway_motion
 * motion_active_state: "on"
 * wake_on_touch: true
 * debug: false
 *
 * INSTALL
 * 1. Copy both ha-navigation-card.js AND lit-core.min.js (same folder,
 *    same relative path — the import above is a plain relative import)
 *    to <config>/www/ha-navigation-card/
 * 2. Settings -> Dashboards -> Resources -> Add Resource
 *      URL: /local/ha-navigation-card/ha-navigation-card.js   Type: JavaScript Module
 * 3. Add the card (type: custom:ha-navigation-card) to any always-on view.
 *
 * lit-core.min.js is a vendored, self-contained build of the "lit" library
 * (no external imports of its own) so this card never needs internet
 * access at dashboard-load time. See that file's header for provenance.
 */

const CARD_VERSION = "2026.09.20.02";
const MIN_TIMEOUT = 3; // seconds; floor to prevent 0/null causing a rapid re-trigger loop

/* ───────── module-level state, survives card re-creation across a view swap ─────────
 * Tagged with CARD_VERSION so a script update always starts clean, instead
 * of inheriting cooldowns/timestamps from whatever version ran before it
 * in this same browser tab. */
function freshState() {
  return {
    cardVersion: CARD_VERSION,
    lastPath: null, // page to return to on wake (screensaver mode)
    lastActivity: Date.now(),
    lastKnownPath: null,
    lastNavAt: 0,
    navTimestamps: [],
    circuitBrokenUntil: 0,
  };
}
if (!window.__HA_NAVIGATION__ || window.__HA_NAVIGATION__.cardVersion !== CARD_VERSION) {
  window.__HA_NAVIGATION__ = freshState();
}
const STATE = window.__HA_NAVIGATION__;

function cleanStr(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

// Shared with the editor below, so toggles for fields the user has never
// explicitly touched (e.g. count_mousemove_as_activity) display their real
// running default (true) instead of ha-form's fallback of "off" for any
// key missing from the saved config.
const CARD_DEFAULTS = {
  navigation_mode: "screensaver", // back | path | screensaver | none
  timeout: 60, // back/path only

  navigation_path: null, // required for "path"; optional wake-destination override for "screensaver"

  show_progress: null, // null = auto (true for back, false otherwise); not used by screensaver
  debug: false,

  motion_entity: null, // screensaver mode only
  motion_active_state: "on",

  wake_on_touch: true,
  count_mousemove_as_activity: true,
  count_scroll_as_activity: true,
};

// Shared by the card (_effectiveShowProgress below) and the editor's
// displayData, so the "Show progress bar" toggle always matches what the
// card actually renders instead of showing "off" for an inferred-on
// default (e.g. back mode with show_progress left unset).
function effectiveShowProgress(config) {
  if (!config) return false;
  if (config.navigation_mode === "screensaver") return false; // no countdown to show
  if (config.show_progress === true) return true;
  if (config.show_progress === false) return false;
  return config.navigation_mode === "back"; // auto default
}

class HaNavigationCard extends LitElement {
  static properties = {
    hass: {},
    _idleSeconds: { state: true },
    _status: { state: true },
    _statusReason: { state: true },
    _motionActive: { state: true },
    _progress: { state: true },
    _lastActivityType: { state: true },
    _lastActivityAt: { state: true },
    _activityCount: { state: true },
    _paused: { state: true },
    _motionRawState: { state: true },
    _motionEntityFound: { state: true },
    _motionChangeCount: { state: true },
    _motionLastChangeAt: { state: true },
    _motionLastChangeFrom: { state: true },
    _motionTriggerCount: { state: true },
    _motionLastTriggerAt: { state: true },
  };

  constructor() {
    super();

    this._defaults = CARD_DEFAULTS;

    this.config = { ...this._defaults };

    this._idleSeconds = 0;
    this._progress = 0;
    this._status = "idle";
    this._statusReason = "init";
    this._motionActive = false;
    this._lastMotionState = undefined;
    this._lastActivityType = null;
    this._lastActivityAt = null;
    this._activityCount = 0;
    this._paused = false;

    this._motionRawState = null;
    this._motionEntityFound = null;
    this._motionChangeCount = 0;
    this._motionLastChangeAt = null;
    this._motionLastChangeFrom = null;
    this._motionTriggerCount = 0;
    this._motionLastTriggerAt = null;

    this._tickInterval = null;

    this._boundActivity = (e) => this._onActivity(e?.type || "activity");
    this._boundLocationChanged = () => this._onLocationChanged();
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this.config = { ...this._defaults, ...config };

    const t = Number(this.config.timeout);
    this.config.timeout = Number.isFinite(t) && t >= MIN_TIMEOUT ? t : this._defaults.timeout;

    // binary_sensor entities in HA always report "on"/"off" for
    // active/inactive — force it rather than trusting a possibly
    // mistyped value. This is also why the editor hides the
    // "Motion active state" field for this domain.
    if (typeof this.config.motion_entity === "string" && this.config.motion_entity.startsWith("binary_sensor.")) {
      this.config.motion_active_state = "on";
    }

    // A navigation_path without a leading "/" is a RELATIVE path to
    // history.pushState — the browser appends it onto the current URL
    // instead of replacing it, so it grows a little longer on every
    // trigger (.../office-mogies/office-mogies/.../screensaver) rather
    // than looping fast enough for the circuit breaker to catch it.
    // Force it absolute here so that class of bug can't happen.
    if (typeof this.config.navigation_path === "string" && this.config.navigation_path.trim()) {
      const p = this.config.navigation_path.trim();
      if (!p.startsWith("/")) {
        console.warn(`ha-navigation-card: navigation_path "${p}" is missing a leading "/" — auto-correcting to "/${p}".`);
        this.config.navigation_path = "/" + p;
      }
    }

    this._applyOptionalListeners();
    this._refreshStatus();
  }

  static getStubConfig() {
    return {
      navigation_mode: "screensaver",
      wake_on_touch: true,
      debug: false,
    };
  }

  static getConfigElement() {
    return document.createElement("ha-navigation-card-editor");
  }

  getCardSize() {
    return this.config.debug || this._effectiveShowProgress() || this._isEditMode() ? 1 : 0;
  }

  // Sections-view analogue of getCardSize() above - same three
  // conditions (debug panel / progress bar / edit-mode banner), sized
  // for what's actually rendered in each state. Per HA's own developer
  // docs, leaving `rows` undefined tells the sections grid to ignore
  // row sizing for this card, used here for the fully-invisible state
  // (the common case: screensaver mode, or back/path with both the
  // progress bar and debug panel off) so it doesn't reserve an empty
  // row. Best-effort per that documented behavior - not yet confirmed
  // live on a real Sections dashboard whether an undefined `rows`
  // truly reserves zero cells or still falls back to some minimum; if
  // it does, that's a layout-engine floor, not something this card can
  // work around further.
  getGridOptions() {
    if (this.config.debug) {
      // Tallest, variable-length state (grows with whether a
      // motion_entity is configured, circuit-breaker status, etc.) -
      // give it real room and let the user resize via the dashboard's
      // own edit-mode drag handles.
      return { columns: 12, rows: 6, min_rows: 3 };
    }
    if (this._effectiveShowProgress() || this._isEditMode()) {
      // Progress bar or the edit-mode banner alone - both a single
      // compact row.
      return { columns: 12, rows: 1, min_rows: 1 };
    }
    return { columns: 12 };
  }

  _effectiveShowProgress() {
    return effectiveShowProgress(this.config);
  }

  set hass(hass) {
    this._hass = hass;
    const entityId = this.config.motion_entity;
    if (!entityId) {
      this._motionEntityFound = null;
      return;
    }

    const stateObj = hass.states[entityId];
    if (!stateObj) {
      this._motionEntityFound = false;
      this._motionRawState = null;
      return;
    }
    this._motionEntityFound = true;

    const newState = stateObj.state;
    this._motionActive = newState === this.config.motion_active_state;
    this._motionRawState = newState; // always reflects the live state, whether or not it "counts"

    if (this._lastMotionState === undefined) {
      this._lastMotionState = newState;
      return;
    }

    if (newState !== this._lastMotionState) {
      this._motionChangeCount = (this._motionChangeCount || 0) + 1;
      this._motionLastChangeAt = Date.now();
      this._motionLastChangeFrom = this._lastMotionState;

      if (newState === this.config.motion_active_state) {
        this._motionTriggerCount = (this._motionTriggerCount || 0) + 1;
        this._motionLastTriggerAt = Date.now();
        this._onActivity("motion");
      }
    }
    this._lastMotionState = newState;
  }

  /* ───────── lifecycle ───────── */

  connectedCallback() {
    super.connectedCallback();

    window.addEventListener("mousedown", this._boundActivity, { passive: true });
    window.addEventListener("keydown", this._boundActivity, { passive: true });
    window.addEventListener("touchstart", this._boundActivity, { passive: true });
    this._applyOptionalListeners();
    window.addEventListener("location-changed", this._boundLocationChanged);

    STATE.lastKnownPath = window.location.pathname;

    // back/path: idle counter always starts fresh on mount.
    // screensaver: no countdown of its own, nothing to reset.
    if (this.config.navigation_mode !== "screensaver") {
      STATE.lastActivity = Date.now();
      this._idleSeconds = 0;
      this._progress = 0;
    }

    this._tickInterval = setInterval(() => this._tick(), 500);
    this._refreshStatus();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("mousedown", this._boundActivity);
    window.removeEventListener("keydown", this._boundActivity);
    window.removeEventListener("touchstart", this._boundActivity);
    window.removeEventListener("mousemove", this._boundActivity);
    window.removeEventListener("wheel", this._boundActivity);
    window.removeEventListener("location-changed", this._boundLocationChanged);
    clearInterval(this._tickInterval);
  }

  _applyOptionalListeners() {
    window.removeEventListener("mousemove", this._boundActivity);
    window.removeEventListener("wheel", this._boundActivity);

    if (this.config.wake_on_touch === false) return;

    if (this.config.count_mousemove_as_activity) {
      window.addEventListener("mousemove", this._boundActivity, { passive: true });
    }
    if (this.config.count_scroll_as_activity) {
      window.addEventListener("wheel", this._boundActivity, { passive: true });
    }
  }

  /* ───────── helpers ───────── */

  _isEditMode() {
    const qsEdit = new URLSearchParams(window.location.search).get("edit") === "1";
    return qsEdit || !!this._hass?.editMode;
  }

  _navCooldownActive() {
    return Date.now() - STATE.lastNavAt < 800 || Date.now() < STATE.circuitBrokenUntil;
  }

  // Circuit breaker: more than 8 navigations in a 10s window means
  // something is looping, regardless of cause. Stop hard for 5 minutes
  // rather than keep flooding the shared HA connection.
  _recordNav() {
    const now = Date.now();
    STATE.navTimestamps.push(now);
    STATE.navTimestamps = STATE.navTimestamps.filter((t) => now - t < 10000);

    if (STATE.navTimestamps.length > 8) {
      STATE.circuitBrokenUntil = now + 5 * 60 * 1000;
      STATE.navTimestamps = [];
      console.error(
        "ha-navigation-card: navigation loop detected, pausing all navigation for 5 minutes to protect the connection."
      );
      this._statusReason = "circuit breaker: loop detected, cooling down 5m";
      return false;
    }

    STATE.lastNavAt = now;
    return true;
  }

  _navigate(path) {
    if (!path || !path.startsWith("/")) {
      // Defense in depth: even if something upstream passed a relative
      // path, refuse rather than let pushState silently append it onto
      // the current URL forever.
      console.error(`ha-navigation-card: refusing to navigate to non-absolute path "${path}".`);
      return;
    }
    if (path.length > 200) {
      // Catches slow-growth loops too (e.g. one trigger every 30s), not
      // just fast ones — a real dashboard path is never this long, so
      // something is clearly accumulating rather than resolving cleanly.
      console.error(
        `ha-navigation-card: navigation_path grew to ${path.length} chars, which looks like a runaway loop — refusing and tripping the circuit breaker.`
      );
      STATE.circuitBrokenUntil = Date.now() + 5 * 60 * 1000;
      return;
    }
    if (!this._recordNav()) return;
    STATE.lastPath = window.location.pathname; // so any screensaver-mode card elsewhere knows where to return
    history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed"));
  }

  _refreshStatus() {
    const mode = this.config.navigation_mode;
    if (this._isEditMode()) {
      this._status = "paused";
      this._statusReason = "edit mode";
    } else if (mode === "none") {
      this._status = "paused";
      this._statusReason = "mode: none";
    } else if (mode === "path" && !cleanStr(this.config.navigation_path)) {
      this._status = "paused";
      this._statusReason = "missing navigation_path";
    } else if (mode === "screensaver") {
      this._status = "listening";
      this._statusReason = "waiting for motion/touch/mouse/keyboard";
    } else if (this._paused) {
      this._status = "paused";
      this._statusReason = "paused by tap (progress bar)";
    } else {
      this._status = "idle";
      this._statusReason = "counting";
    }
  }

  /* ───────── activity / wake ───────── */

  _onActivity(reason) {
    this._lastActivityType = reason;
    this._lastActivityAt = Date.now();
    this._activityCount = (this._activityCount || 0) + 1;

    if (this._isEditMode()) return;
    const mode = this.config.navigation_mode;
    if (mode === "none") return;

    if (mode === "screensaver") {
      this._wake(reason);
      return;
    }

    // back/path: any activity resets the idle countdown.
    STATE.lastActivity = Date.now();
    this._idleSeconds = 0;
    this._progress = 0;
    this._refreshStatus();
  }

  // Tap the progress bar to pause/unpause the countdown. Counts as
  // activity either way, so it always resets the clock fresh — pausing
  // freezes at a full countdown remaining, and unpausing doesn't
  // immediately trigger from stale elapsed time.
  _togglePause(e) {
    e.stopPropagation();
    if (this._isEditMode()) return;
    const mode = this.config.navigation_mode;
    if (mode !== "back" && mode !== "path") return; // no progress bar in other modes

    this._paused = !this._paused;

    STATE.lastActivity = Date.now();
    this._idleSeconds = 0;
    this._progress = 0;
    this._refreshStatus();
  }

  _onLocationChanged() {
    const curPath = window.location.pathname;
    if (curPath === STATE.lastKnownPath) return;
    STATE.lastKnownPath = curPath;

    if (this.config.navigation_mode !== "screensaver") {
      STATE.lastActivity = Date.now();
      this._idleSeconds = 0;
      this._progress = 0;
    }
    this._refreshStatus();
  }

  /* ───────── idle -> enter target (back/path only) ───────── */

  _tick() {
    this._refreshStatus();
    if (this._isEditMode()) return;

    const mode = this.config.navigation_mode;
    if (mode === "none") return;
    if (mode === "screensaver") {
      if (this.config.debug) this.requestUpdate(); // keep "seconds ago" live in the debug panel
      return; // no timeout-driven entry
    }

    if (this._paused) {
      return; // frozen — idleSeconds/progress stay at their last value, nothing counts, nothing triggers
    }

    this._idleSeconds = Math.floor((Date.now() - STATE.lastActivity) / 1000);
    const timeout = Number(this.config.timeout || 0);
    this._progress = timeout > 0 ? Math.min(1, this._idleSeconds / timeout) : 0;

    if (this._idleSeconds >= timeout) {
      this._enterTarget();
    }
  }

  _enterTarget() {
    if (this._isEditMode()) return;
    if (this._navCooldownActive()) return;

    const mode = this.config.navigation_mode;
    const curPath = window.location.pathname;

    if (mode === "back") {
      STATE.lastPath = curPath;
      if (!this._recordNav()) return;
      STATE.lastActivity = Date.now();
      history.back();
      this._refreshStatus();
      return;
    }

    if (mode === "path") {
      const target = cleanStr(this.config.navigation_path);
      if (!target || target === curPath) return; // nothing to do
      STATE.lastActivity = Date.now();
      this._navigate(target);
      this._refreshStatus();
    }
  }

  // Screensaver mode only: always listening, no timeout gate. Navigates
  // to navigation_path if you've set one (wake-destination override),
  // otherwise back to wherever you were before landing here.
  _wake(reason) {
    if (this._isEditMode()) return;
    if (this.config.navigation_mode !== "screensaver") return;
    if (this._navCooldownActive()) return;

    const override = cleanStr(this.config.navigation_path);
    const target = override || STATE.lastPath;

    if (target && target !== window.location.pathname) {
      this._navigate(target);
    }
  }

  /* ───────── render ───────── */

  render() {
    const inEdit = this._isEditMode();
    const showDebug = this.config.debug;
    const showProgress = this._effectiveShowProgress();
    if (!inEdit && !showDebug && !showProgress) return html``;

    const timeout = this.config.timeout ?? 0;
    const mode = this.config.navigation_mode;

    return html`
      <ha-card>
        ${inEdit
          ? html`<div class="edit-warning">Navigation disabled while in edit mode</div>`
          : ""}
        ${showProgress
          ? html`
              <div
                class="progress-bar ${this._paused ? "paused" : ""}"
                @click=${(e) => this._togglePause(e)}
                title="Tap to ${this._paused ? "resume" : "pause"}"
              >
                <div class="progress" style="width:${this._progress * 100}%"></div>
                ${this._paused ? html`<div class="pause-label">Paused — tap to resume</div>` : ""}
              </div>
            `
          : ""}
        ${showDebug
          ? html`
              <div class="debug">
                <div><b>ha-navigation-card</b> v${CARD_VERSION}</div>
                <div>mode: <span class="mono">${mode}</span></div>
                <div>status: <span class="mono">${this._status}</span> (${this._statusReason})</div>
                ${mode !== "screensaver"
                  ? html`<div>timeout: <span class="mono">${this._idleSeconds}s / ${timeout}s</span></div>`
                  : ""}
                <div>navigation_path: <span class="mono">${this.config.navigation_path ?? "n/a"}</span></div>
                ${mode === "screensaver"
                  ? html`<div>will return to: <span class="mono">${cleanStr(this.config.navigation_path) || STATE.lastPath || "n/a"}</span></div>`
                  : ""}
                <div>path: <span class="mono">${window.location.pathname}</span></div>
                <div class="section-divider"></div>
                <div><b>Motion sensor</b></div>
                ${this.config.motion_entity
                  ? html`
                      <div>entity: <span class="mono">${this.config.motion_entity}</span></div>
                      ${this._motionEntityFound === false
                        ? html`<div class="edit-warning" style="text-align:left">
                            ⚠ entity not found in hass.states — check for a typo
                          </div>`
                        : html`
                            <div>
                              raw state: <span class="mono">${this._motionRawState ?? "n/a"}</span>
                              (active state configured: <span class="mono">${this.config.motion_active_state}</span>)
                            </div>
                            <div>currently active: <span class="mono">${this._motionActive}</span></div>
                            <div>
                              state changes seen: <span class="mono">${this._motionChangeCount || 0}</span>
                              ${this._motionLastChangeAt
                                ? html`— last: <span class="mono">${this._motionLastChangeFrom ?? "?"} → ${this._motionRawState}</span>
                                    (${Math.round((Date.now() - this._motionLastChangeAt) / 1000)}s ago)`
                                : ""}
                            </div>
                            <div>
                              triggers recognized: <span class="mono">${this._motionTriggerCount || 0}</span>
                              ${this._motionLastTriggerAt
                                ? html`— last: ${Math.round((Date.now() - this._motionLastTriggerAt) / 1000)}s ago`
                                : html`— none yet`}
                            </div>
                          `}
                    `
                  : html`<div class="muted">no motion_entity configured</div>`}
                <div class="section-divider"></div>
                <div><b>Activity detection</b></div>
                <div>
                  events seen: <span class="mono">${this._activityCount}</span>
                  ${this._lastActivityType
                    ? html`— last: <span class="mono">${this._lastActivityType}</span>
                        (${Math.round((Date.now() - this._lastActivityAt) / 1000)}s ago)`
                    : html`— none yet`}
                </div>
                <div class="muted">
                  listening for: mousedown, keydown, touchstart${this.config.count_mousemove_as_activity
                    ? ", mousemove"
                    : ""}${this.config.count_scroll_as_activity ? ", wheel" : ""}${this.config.motion_entity
                    ? `, motion (${this.config.motion_entity})`
                    : ""}${this.config.wake_on_touch === false ? " — wake_on_touch is OFF, mouse/scroll ignored" : ""}
                </div>
                ${Date.now() < STATE.circuitBrokenUntil
                  ? html`<div class="edit-warning" style="text-align:left">
                      Circuit breaker tripped — navigation paused until
                      ${new Date(STATE.circuitBrokenUntil).toLocaleTimeString()}
                    </div>`
                  : ""}
              </div>
            `
          : ""}
      </ha-card>
    `;
  }

  static styles = css`
    ha-card {
      padding: 8px 12px;
      font-family: monospace;
      font-size: 12px;
    }
    .edit-warning {
      font-weight: 700;
      font-family: var(--paper-font-body1_-_font-family, sans-serif);
      color: var(--error-color, var(--alert-color, #db4437));
      margin-bottom: 6px;
      text-align: center;
    }
    .progress-bar {
      position: relative;
      height: 14px;
      border-radius: 999px;
      background: var(--divider-color);
      overflow: hidden;
      margin-bottom: 6px;
      cursor: pointer;
      user-select: none;
    }
    .progress-bar.paused {
      background: rgba(255, 193, 7, 0.22);
    }
    .progress {
      height: 100%;
      background: var(--primary-color);
      transition: width 0.2s linear;
    }
    .progress-bar.paused .progress {
      background: rgba(255, 193, 7, 0.65);
    }
    .pause-label {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-weight: 700;
      color: var(--primary-text-color);
      pointer-events: none;
      white-space: nowrap;
      text-shadow: 0 1px 1px rgba(0, 0, 0, 0.4);
    }
    .debug div {
      opacity: 0.75;
      margin: 1px 0;
    }
    .section-divider {
      border-top: 1px dashed var(--divider-color);
      margin: 6px 0;
      opacity: 1;
    }
    .muted {
      opacity: 0.55 !important;
      font-size: 11px;
    }
    .mono {
      font-family: monospace;
      opacity: 1;
    }
  `;
}

/* ─────────────────────────────────────────────────────────────
 * VISUAL EDITOR — fields shown depend on navigation_mode.
 * ───────────────────────────────────────────────────────────── */

const FIELD_LABELS = {
  navigation_mode: "Navigation mode",
  timeout: "Timeout (seconds)",
  navigation_path: "Navigation path",
  show_progress: "Show progress bar",
  debug: "Debug panel",
  motion_entity: "Motion entity",
  motion_active_state: "Motion active state",
  wake_on_touch: "Wake/reset on touch, mouse, keyboard",
  count_mousemove_as_activity: "Count mouse movement as activity",
  count_scroll_as_activity: "Count scrolling as activity",
};

const FIELD_HELPERS = {
  navigation_path:
    "Path mode: required destination. Screensaver mode: optional — overrides the wake destination; leave blank to return to wherever you came from.",
  timeout: "Seconds of no activity before entering the target.",
  show_progress: "Leave unset for the default: on for 'back' mode, off otherwise.",
  motion_entity:
    "Screensaver mode only. A binary_sensor (or any entity) that wakes the display when it matches the active state below.",
};

function computeNavigationCardSchemaTop(config) {
  const mode = config?.navigation_mode || "screensaver";

  const schema = [
    {
      name: "navigation_mode",
      required: true,
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "back", label: "Back (history.back(), one-shot)" },
            { value: "path", label: "Path (fixed destination, one-shot)" },
            { value: "screensaver", label: "Screensaver (always listening, wake-only)" },
            { value: "none", label: "None (disabled)" },
          ],
        },
      },
    },
  ];

  if (mode === "back" || mode === "path") {
    schema.push({
      name: "timeout",
      required: true,
      selector: { number: { min: MIN_TIMEOUT, max: 3600, mode: "box", unit_of_measurement: "s" } },
    });
  }

  return schema;
}

function computeNavigationCardSchemaRest(config) {
  const mode = config?.navigation_mode || "screensaver";
  if (mode === "none") return [];

  const schema = [];

  if (mode === "screensaver") {
    const isBinarySensor =
      typeof config?.motion_entity === "string" && config.motion_entity.startsWith("binary_sensor.");
    const wakeSchema = [{ name: "motion_entity", selector: { entity: { domain: "binary_sensor" } } }];
    if (!isBinarySensor) {
      // binary_sensor is always on/off, so there's nothing to configure —
      // only show this for a manually-entered non-binary_sensor entity.
      wakeSchema.push({ name: "motion_active_state", selector: { text: {} } });
    }
    schema.push({
      type: "expandable",
      name: "wake_options",
      title: "Wake sources",
      flatten: true,
      schema: wakeSchema,
    });
  }

  schema.push({
    type: "expandable",
    name: "activity_detection",
    title: "Activity detection",
    flatten: true,
    schema: [
      { name: "wake_on_touch", selector: { boolean: {} } },
      { name: "count_mousemove_as_activity", selector: { boolean: {} } },
      { name: "count_scroll_as_activity", selector: { boolean: {} } },
    ],
  });

  const advancedSchema = [];
  if (mode === "back" || mode === "path") {
    advancedSchema.push({ name: "show_progress", selector: { boolean: {} } });
  }
  advancedSchema.push({ name: "debug", selector: { boolean: {} } });

  schema.push({
    type: "expandable",
    name: "advanced",
    title: "Advanced",
    flatten: true,
    schema: advancedSchema,
  });

  return schema;
}

class HaNavigationCardEditor extends LitElement {
  static properties = {
    hass: {},
    _config: { state: true },
  };

  setConfig(config) {
    this._config = config;
  }

  _computeLabel = (schema) => FIELD_LABELS[schema.name] ?? schema.name;
  _computeHelper = (schema) => FIELD_HELPERS[schema.name];

  _valueChanged(ev) {
    const event = new CustomEvent("config-changed", {
      detail: { config: ev.detail.value },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  _navPathChanged(value) {
    this._valueChanged({ detail: { value: { ...this._config, navigation_path: value } } });
  }

  _renderNavigationPathField() {
    const mode = this._config.navigation_mode;
    if (mode !== "path" && mode !== "screensaver") return html``;

    const value = this._config.navigation_path || "";
    const isInvalid = value && !value.startsWith("/");
    // Same picker HA's own tap-action "Navigate" editor uses for browsing
    // all dashboard/view paths, when it's available in this HA version;
    // falls back to a plain text field otherwise so the editor never breaks.
    const hasPicker = !!customElements.get("ha-navigation-picker");

    return html`
      <div class="nav-path-field">
        <div class="nav-path-label">
          ${FIELD_LABELS.navigation_path}${mode === "path" ? " (required)" : " (optional)"}
        </div>
        ${hasPicker
          ? html`
              <ha-navigation-picker
                .hass=${this.hass}
                .value=${value}
                @value-changed=${(e) => this._navPathChanged(e.detail.value)}
              ></ha-navigation-picker>
            `
          : html`
              <ha-textfield
                .value=${value}
                placeholder="/dashboard/view"
                @input=${(e) => this._navPathChanged(e.target.value)}
              ></ha-textfield>
            `}
        <div class="nav-path-helper">${FIELD_HELPERS.navigation_path}</div>
        ${isInvalid
          ? html`<div class="nav-path-warning">
              ⚠ Missing leading "/" — will be auto-corrected to "/${value}" to prevent a navigation loop.
            </div>`
          : ""}
      </div>
    `;
  }

  render() {
    if (!this.hass || !this._config) return html``;
    // Fields the user has never explicitly set are absent from the saved
    // config, and ha-form displays a missing boolean as off — even when
    // the card's real default is true. Merging CARD_DEFAULTS underneath
    // makes the toggles match what's actually running.
    const merged = { ...CARD_DEFAULTS, ...this._config };
    const displayData = { ...merged, show_progress: effectiveShowProgress(merged) };
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${displayData}
        .schema=${computeNavigationCardSchemaTop(displayData)}
        .computeLabel=${this._computeLabel}
        .computeHelper=${this._computeHelper}
        @value-changed=${this._valueChanged}
      ></ha-form>
      ${this._renderNavigationPathField()}
      <ha-form
        .hass=${this.hass}
        .data=${displayData}
        .schema=${computeNavigationCardSchemaRest(displayData)}
        .computeLabel=${this._computeLabel}
        .computeHelper=${this._computeHelper}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }

  static styles = css`
    .nav-path-field {
      margin: 16px 0;
    }
    .nav-path-label {
      font-size: 14px;
      margin-bottom: 4px;
      color: var(--primary-text-color);
    }
    ha-textfield {
      width: 100%;
    }
    .nav-path-helper {
      font-size: 12px;
      color: var(--secondary-text-color);
      margin-top: 4px;
    }
    .nav-path-warning {
      font-size: 12px;
      color: var(--error-color, #db4437);
      margin-top: 4px;
      font-weight: 600;
    }
  `;
}

customElements.define("ha-navigation-card-editor", HaNavigationCardEditor);
customElements.define("ha-navigation-card", HaNavigationCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-navigation-card",
  name: `Navigation Card (${CARD_VERSION})`,
  description: "Idle timeout navigation: back / path / screensaver (always-listening) / none.",
  preview: false,
});
