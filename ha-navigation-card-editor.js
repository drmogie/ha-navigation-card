/**
 * HA Navigation Card - GUI Editor
 * Version: 2026.09.12.1
 */

const LitElement = Object.getPrototypeOf(
  customElements.get("hui-view") || customElements.get("hui-masonry-view")
);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class HaNavigationCardEditor extends LitElement {
  static get properties() {
    return { hass: {}, _config: {} };
  }

  setConfig(config) {
    this._config = config;
  }

  render() {
    if (!this._config || !this.hass) {
      return html``;
    }

    return html`
      <div class="card-config">
        <ha-textfield
          label="Idle timeout (seconds)"
          type="number"
          min="1"
          .value=${this._config.idle_seconds ?? 60}
          .configValue=${"idle_seconds"}
          @input=${this._valueChanged}
        ></ha-textfield>

        <ha-textfield
          label="Idle / screensaver path (required)"
          helper="Dashboard path to navigate to when the user goes idle, e.g. /lovelace-kiosk/screensaver"
          helper-persistent
          .value=${this._config.idle_path ?? ""}
          .configValue=${"idle_path"}
          @input=${this._valueChanged}
        ></ha-textfield>

        <ha-textfield
          label="Wake / home path"
          helper="Dashboard path to return to when the user interacts again, e.g. /lovelace-kiosk/home"
          helper-persistent
          .value=${this._config.wake_path ?? ""}
          .configValue=${"wake_path"}
          @input=${this._valueChanged}
        ></ha-textfield>

        <ha-textfield
          label="Only watch this path (optional)"
          helper="Leave blank to arm the idle timer on every view except the idle view"
          helper-persistent
          .value=${this._config.only_watch_path ?? ""}
          .configValue=${"only_watch_path"}
          @input=${this._valueChanged}
        ></ha-textfield>
      </div>
    `;
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) return;

    const target = ev.target;
    const key = target.configValue;
    if (!key) return;

    let value = target.value;
    if (key === "idle_seconds") {
      value = Number(value);
    }

    if (this._config[key] === value) return;

    const newConfig = { ...this._config, [key]: value };
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: newConfig } })
    );
  }

  static get styles() {
    return css`
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 8px 0;
      }
      ha-textfield {
        width: 100%;
      }
    `;
  }
}

customElements.define("ha-navigation-card-editor", HaNavigationCardEditor);
