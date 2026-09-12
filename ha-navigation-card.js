/**
 * HA Navigation Card
 * Version: 2026.09.12.1
 *
 * A background (non-visual) Home Assistant Lovelace card that watches for
 * user inactivity and navigates the dashboard to an "idle" view (e.g. a
 * kiosk-style screensaver), then navigates back to a "wake" view as soon as
 * the user interacts again.
 *
 * Example card config:
 * type: custom:ha-navigation-card
 * idle_seconds: 60
 * idle_path: /lovelace-kiosk/screensaver
 * wake_path: /lovelace-kiosk/home
 * only_watch_path: /lovelace-kiosk/home
 */

class HaNavigationCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("ha-navigation-card-editor");
  }

  static getStubConfig() {
    return {
      idle_seconds: 60,
      idle_path: "",
      wake_path: "",
      only_watch_path: "",
    };
  }

  setConfig(config) {
    if (!config || !config.idle_path) {
      throw new Error("`idle_path` is required (the view to navigate to when idle).");
    }

    this._config = {
      idle_seconds: 60,
      wake_path: "",
      only_watch_path: "",
      reset_events: ["mousedown", "touchstart", "keydown", "mousemove"],
      ...config,
    };

    this._resetTimer = this._resetTimer.bind(this);
    this._render();

    if (this.isConnected) {
      this._setupListeners();
    }
  }

  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    return 0;
  }

  connectedCallback() {
    this._setupListeners();
  }

  disconnectedCallback() {
    this._teardownListeners();
  }

  _render() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    // This card has no visible UI - it only runs idle-detection logic.
    this.shadowRoot.innerHTML = `<style>:host { display: none; }</style>`;
  }

  _setupListeners() {
    if (this._listening || !this._config) return;
    this._listening = true;
    this._config.reset_events.forEach((evt) =>
      document.addEventListener(evt, this._resetTimer, { passive: true })
    );
    this._resetTimer();
  }

  _teardownListeners() {
    if (!this._listening) return;
    this._config.reset_events.forEach((evt) =>
      document.removeEventListener(evt, this._resetTimer)
    );
    clearTimeout(this._timer);
    this._listening = false;
  }

  _currentPath() {
    return window.location.pathname;
  }

  _navigate(path) {
    if (!path || this._currentPath() === path) return;
    history.pushState(null, "", path);
    const event = new Event("location-changed", { bubbles: true, composed: true });
    event.detail = { replace: false };
    window.dispatchEvent(event);
  }

  _resetTimer() {
    clearTimeout(this._timer);
    const path = this._currentPath();

    // If we're currently on the idle/screensaver view, treat this event as
    // the "wake up" interaction and navigate home immediately.
    if (path === this._config.idle_path) {
      if (this._config.wake_path) {
        this._navigate(this._config.wake_path);
      }
      return;
    }

    // Optionally only arm the idle timer while on a specific view.
    if (this._config.only_watch_path && path !== this._config.only_watch_path) {
      return;
    }

    this._timer = setTimeout(() => {
      this._navigate(this._config.idle_path);
    }, this._config.idle_seconds * 1000);
  }
}

customElements.define("ha-navigation-card", HaNavigationCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-navigation-card",
  name: "HA Navigation Card",
  description: "Idle-timeout kiosk screensaver navigation for Home Assistant dashboards.",
  preview: false,
});
