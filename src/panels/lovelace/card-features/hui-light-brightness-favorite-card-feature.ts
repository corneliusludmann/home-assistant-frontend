import type { UnsubscribeFunc } from "home-assistant-js-websocket";
import type { PropertyValues, TemplateResult } from "lit";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators";
import { styleMap } from "lit/directives/style-map";
import { computeCssColor } from "../../../common/color/compute-color";
import type { HASSDomEvent } from "../../../common/dom/fire_event";
import { computeDomain } from "../../../common/entity/compute_domain";
import { stateColorCss } from "../../../common/entity/state_color";
import "../../../components/ha-control-select";
import { UNAVAILABLE } from "../../../data/entity/entity";
import type { ExtEntityRegistryEntry } from "../../../data/entity/entity_registry";
import {
  getExtendedEntityRegistryEntry,
  subscribeEntityRegistry,
} from "../../../data/entity/entity_registry";
import type { LightEntity } from "../../../data/light";
import {
  DEFAULT_LIGHT_FAVORITE_BRIGHTNESS,
  lightSupportsBrightness,
  normalizeLightFavoriteBrightness,
} from "../../../data/light";
import type { HomeAssistant } from "../../../types";
import type { LovelaceCardFeature } from "../types";
import { cardFeatureStyles } from "./common/card-feature-styles";
import { getMoreInfoHintCardFeatureEditor } from "./get-more-info-hint-card-feature-editor";
import type {
  LightBrightnessFavoriteCardFeatureConfig,
  LovelaceCardFeatureContext,
} from "./types";

export const supportsLightBrightnessFavoriteCardFeature = (
  hass: HomeAssistant,
  context: LovelaceCardFeatureContext
) => {
  const stateObj = context.entity_id
    ? (hass.states[context.entity_id] as LightEntity | undefined)
    : undefined;

  if (!stateObj) {
    return false;
  }

  return (
    computeDomain(stateObj.entity_id) === "light" &&
    lightSupportsBrightness(stateObj)
  );
};

@customElement("hui-light-brightness-favorite-card-feature")
class HuiLightBrightnessFavoriteCardFeature
  extends LitElement
  implements LovelaceCardFeature
{
  @property({ attribute: false }) public hass?: HomeAssistant;

  @property({ attribute: false }) public context?: LovelaceCardFeatureContext;

  @property({ attribute: false }) public color?: string;

  @state() private _config?: LightBrightnessFavoriteCardFeatureConfig;

  @state() private _entry?: ExtEntityRegistryEntry | null;

  @state() private _currentBrightness?: number;

  private _unsubEntityRegistry?: UnsubscribeFunc;

  private _subscribedEntityId?: string;

  private _subscribedConnection?: HomeAssistant["connection"];

  private get _stateObj(): LightEntity | undefined {
    if (!this.hass || !this.context?.entity_id) {
      return undefined;
    }

    return this.hass.states[this.context.entity_id] as LightEntity | undefined;
  }

  public connectedCallback() {
    super.connectedCallback();
    this._refreshEntitySubscription();
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeEntityRegistry();
  }

  public setConfig(config: LightBrightnessFavoriteCardFeatureConfig): void {
    if (!config) {
      throw new Error("Invalid configuration");
    }

    this._config = config;
  }

  protected willUpdate(changedProp: PropertyValues): void {
    super.willUpdate(changedProp);

    if (
      (changedProp.has("hass") || changedProp.has("context")) &&
      this._stateObj
    ) {
      const oldHass = changedProp.get("hass") as HomeAssistant | undefined;
      const oldStateObj = this.context?.entity_id
        ? (oldHass?.states[this.context.entity_id] as LightEntity | undefined)
        : undefined;

      if (oldStateObj !== this._stateObj) {
        this._currentBrightness = this._getBrightnessPercent(this._stateObj);
      }
    }

    if (
      changedProp.has("context") &&
      (changedProp.get("context") as LovelaceCardFeatureContext | undefined)
        ?.entity_id !== this.context?.entity_id
    ) {
      this._refreshEntitySubscription();
    }

    if (
      changedProp.has("hass") &&
      (changedProp.get("hass") as HomeAssistant | undefined)?.connection !==
        this.hass?.connection
    ) {
      this._refreshEntitySubscription();
    }
  }

  private _getBrightnessPercent(stateObj: LightEntity): number | undefined {
    return stateObj.attributes.brightness != null
      ? Math.round((stateObj.attributes.brightness * 100) / 255)
      : undefined;
  }

  private _refreshEntitySubscription(): void {
    this._ensureEntitySubscription().catch(() => undefined);
  }

  private _unsubscribeEntityRegistry(): void {
    if (this._unsubEntityRegistry) {
      this._unsubEntityRegistry();
      this._unsubEntityRegistry = undefined;
    }
  }

  private async _loadEntityEntry(entityId: string): Promise<void> {
    if (!this.hass) {
      return;
    }

    try {
      const entry = await getExtendedEntityRegistryEntry(this.hass, entityId);

      if (this.context?.entity_id === entityId) {
        this._entry = entry;
      }
    } catch (_err) {
      if (this.context?.entity_id === entityId) {
        this._entry = null;
      }
    }
  }

  private async _subscribeEntityEntry(entityId: string): Promise<void> {
    this._unsubscribeEntityRegistry();

    await this._loadEntityEntry(entityId);

    try {
      this._unsubEntityRegistry = subscribeEntityRegistry(
        this.hass!.connection,
        async (entries) => {
          if (this.context?.entity_id !== entityId) {
            return;
          }

          if (entries.some((entry) => entry.entity_id === entityId)) {
            await this._loadEntityEntry(entityId);
            return;
          }

          this._entry = null;
        }
      );
    } catch (_err) {
      this._unsubEntityRegistry = undefined;
    }
  }

  private async _ensureEntitySubscription(): Promise<void> {
    const entityId = this.context?.entity_id;
    const connection = this.hass?.connection;

    if (!this.hass || !entityId || !connection) {
      this._unsubscribeEntityRegistry();
      this._subscribedEntityId = undefined;
      this._subscribedConnection = undefined;
      this._entry = undefined;
      return;
    }

    if (
      this._subscribedEntityId === entityId &&
      this._subscribedConnection === connection &&
      this._unsubEntityRegistry
    ) {
      return;
    }

    this._subscribedEntityId = entityId;
    this._subscribedConnection = connection;

    await this._subscribeEntityEntry(entityId);
  }

  private async _valueChanged(
    ev: HASSDomEvent<HASSDomEvents["value-changed"]>
  ) {
    const value = ev.detail.value;

    if (value == null || !this.hass || !this._stateObj) {
      return;
    }

    const brightness = Number(value);

    if (isNaN(brightness)) {
      return;
    }

    const oldBrightness = this._getBrightnessPercent(this._stateObj);

    if (brightness === oldBrightness) {
      return;
    }

    this._currentBrightness = brightness;

    try {
      if (brightness === 0) {
        await this.hass.callService("light", "turn_off", {
          entity_id: this._stateObj.entity_id,
        });
      } else {
        await this.hass.callService("light", "turn_on", {
          entity_id: this._stateObj.entity_id,
          brightness_pct: brightness,
        });
      }
    } catch (_err) {
      this._currentBrightness = oldBrightness;
    }
  }

  protected render(): TemplateResult | null {
    if (
      !this._config ||
      !this.hass ||
      !this.context ||
      !this._stateObj ||
      !supportsLightBrightnessFavoriteCardFeature(this.hass, this.context)
    ) {
      return null;
    }

    const favorites = normalizeLightFavoriteBrightness(
      this._entry?.options?.light?.favorite_brightness ??
        DEFAULT_LIGHT_FAVORITE_BRIGHTNESS
    );

    if (favorites.length === 0) {
      return null;
    }

    const hass = this.hass;

    const options = favorites.map((brightness) => ({
      value: String(brightness),
      label: `${brightness}%`,
      ariaLabel: hass.localize(
        "ui.dialogs.more_info_control.light.favorite_brightness.set",
        { value: `${brightness}%` }
      ),
    }));

    const currentValue =
      this._currentBrightness != null
        ? String(this._currentBrightness)
        : undefined;

    const color = this.color
      ? computeCssColor(this.color)
      : stateColorCss(this._stateObj);

    return html`
      <ha-control-select
        style=${styleMap({ "--feature-color": color })}
        .options=${options}
        .value=${currentValue}
        @value-changed=${this._valueChanged}
        .label=${hass.localize(
          "ui.panel.lovelace.editor.features.types.light-brightness-favorite.label"
        )}
        .disabled=${this._stateObj.state === UNAVAILABLE}
      >
      </ha-control-select>
    `;
  }

  static getStubConfig(): LightBrightnessFavoriteCardFeatureConfig {
    return {
      type: "light-brightness-favorite",
    };
  }

  public static getConfigElement = getMoreInfoHintCardFeatureEditor;

  static get styles() {
    return cardFeatureStyles;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-light-brightness-favorite-card-feature": HuiLightBrightnessFavoriteCardFeature;
  }
}
