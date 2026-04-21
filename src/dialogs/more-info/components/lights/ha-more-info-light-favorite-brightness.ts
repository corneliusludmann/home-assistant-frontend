import type { PropertyValues, TemplateResult } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators";
import { classMap } from "lit/directives/class-map";
import { styleMap } from "lit/directives/style-map";
import type { HASSDomEvent } from "../../../../common/dom/fire_event";
import { fireEvent } from "../../../../common/dom/fire_event";
import "../../../../components/ha-control-button";
import { UNAVAILABLE } from "../../../../data/entity/entity";
import type {
  ExtEntityRegistryEntry,
  LightEntityOptions,
} from "../../../../data/entity/entity_registry";
import { updateEntityRegistryEntry } from "../../../../data/entity/entity_registry";
import type { LightEntity } from "../../../../data/light";
import {
  DEFAULT_LIGHT_FAVORITE_BRIGHTNESS,
  normalizeLightFavoriteBrightness,
} from "../../../../data/light";
import type { HomeAssistant } from "../../../../types";
import {
  showConfirmationDialog,
  showPromptDialog,
} from "../../../generic/show-dialog-box";
import "../ha-more-info-favorites";
import type { HaMoreInfoFavorites } from "../ha-more-info-favorites";

type FavoriteLocalizeKey =
  | "set"
  | "edit"
  | "delete"
  | "delete_confirm_title"
  | "delete_confirm_text"
  | "delete_confirm_action"
  | "add"
  | "edit_title"
  | "add_title";

@customElement("ha-more-info-light-favorite-brightness")
export class HaMoreInfoLightFavoriteBrightness extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) public stateObj!: LightEntity;

  @property({ attribute: false }) public entry?: ExtEntityRegistryEntry | null;

  @property({ attribute: false }) public editMode?: boolean;

  @property({ type: Boolean, attribute: false }) public showDone = true;

  @state() private _favoriteBrightness: number[] = [];

  protected updated(changedProps: PropertyValues<this>): void {
    if (
      (changedProps.has("entry") || changedProps.has("stateObj")) &&
      this.entry &&
      this.stateObj
    ) {
      this._favoriteBrightness = normalizeLightFavoriteBrightness(
        this.entry.options?.light?.favorite_brightness ??
          DEFAULT_LIGHT_FAVORITE_BRIGHTNESS
      );
    }
  }

  private _localizeFavorite(
    key: FavoriteLocalizeKey,
    values?: Record<string, string | number>
  ): string {
    return this.hass.localize(
      `ui.dialogs.more_info_control.light.favorite_brightness.${key}`,
      values
    );
  }

  private _currentValue(): number | undefined {
    if (this.stateObj.state === "off") {
      return 0;
    }
    const brightness = this.stateObj.attributes.brightness;
    return brightness != null
      ? Math.round((brightness * 100) / 255)
      : undefined;
  }

  private async _save(favorite_brightness: number[]): Promise<void> {
    if (!this.entry) {
      return;
    }

    const currentOptions: LightEntityOptions = {
      ...(this.entry.options?.light ?? {}),
    };

    const result = await updateEntityRegistryEntry(
      this.hass,
      this.entry.entity_id,
      {
        options_domain: "light",
        options: {
          ...currentOptions,
          favorite_brightness,
        },
      }
    );

    fireEvent(this, "entity-entry-updated", result.entity_entry);
  }

  private async _setFavorites(favorites: number[]): Promise<void> {
    const normalized = normalizeLightFavoriteBrightness(favorites);
    this._favoriteBrightness = normalized;
    await this._save(normalized);
  }

  private _move(index: number, newIndex: number): void {
    const favorites = this._favoriteBrightness.concat();
    const moved = favorites.splice(index, 1)[0];
    favorites.splice(newIndex, 0, moved);
    this._setFavorites(favorites);
  }

  private _applyFavorite(index: number): void {
    const favorite = this._favoriteBrightness[index];

    if (favorite === undefined) {
      return;
    }

    this.hass.callService("light", "turn_on", {
      entity_id: this.stateObj.entity_id,
      brightness_pct: favorite,
    });
  }

  private async _promptFavoriteValue(
    value?: number
  ): Promise<number | undefined> {
    const response = await showPromptDialog(this, {
      title: this._localizeFavorite(
        value === undefined ? "add_title" : "edit_title"
      ),
      inputLabel: this.hass.formatEntityAttributeName(
        this.stateObj,
        "brightness"
      ),
      inputType: "number",
      inputMin: "0",
      inputMax: "100",
      inputSuffix: "%",
      defaultValue: value === undefined ? undefined : String(value),
    });

    if (response === null || response.trim() === "") {
      return undefined;
    }

    const number = Number(response);

    if (isNaN(number)) {
      return undefined;
    }

    return Math.max(0, Math.min(100, Math.round(number)));
  }

  private async _addFavorite(): Promise<void> {
    const value = await this._promptFavoriteValue();

    if (value === undefined) {
      return;
    }

    await this._setFavorites([...this._favoriteBrightness, value]);
  }

  private async _editFavorite(index: number): Promise<void> {
    const current = this._favoriteBrightness[index];

    if (current === undefined) {
      return;
    }

    const value = await this._promptFavoriteValue(current);

    if (value === undefined) {
      return;
    }

    const updated = [...this._favoriteBrightness];
    updated[index] = value;
    await this._setFavorites(updated);
  }

  private async _deleteFavorite(index: number): Promise<void> {
    const confirmed = await showConfirmationDialog(this, {
      destructive: true,
      title: this._localizeFavorite("delete_confirm_title"),
      text: this._localizeFavorite("delete_confirm_text"),
      confirmText: this._localizeFavorite("delete_confirm_action"),
    });

    if (!confirmed) {
      return;
    }

    await this._setFavorites(
      this._favoriteBrightness.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  private _renderFavorite: HaMoreInfoFavorites["renderItem"] = (
    favorite,
    _index,
    editMode
  ) => {
    const value = favorite as number;
    const active = this._currentValue() === value;
    const label = this._localizeFavorite(editMode ? "edit" : "set", {
      value: `${value}%`,
    });

    return html`
      <ha-control-button
        class=${classMap({
          active,
        })}
        style=${styleMap({
          "--control-button-border-radius": "var(--ha-border-radius-pill)",
          width: "72px",
          height: "36px",
        })}
        .label=${label}
        .disabled=${this.stateObj.state === UNAVAILABLE}
      >
        ${value}%
      </ha-control-button>
    `;
  };

  private _deleteLabel = (index: number): string =>
    this._localizeFavorite("delete", {
      number: index + 1,
    });

  private _handleFavoriteAction = (
    ev: HASSDomEvent<HASSDomEvents["favorite-item-action"]>
  ): void => {
    ev.stopPropagation();

    const { action, index } = ev.detail;

    if (action === "hold" && this.hass.user?.is_admin) {
      fireEvent(this, "toggle-edit-mode", true);
      return;
    }

    if (this.editMode) {
      this._editFavorite(index);
      return;
    }

    this._applyFavorite(index);
  };

  private _handleFavoriteMoved = (
    ev: HASSDomEvent<HASSDomEvents["favorite-item-moved"]>
  ): void => {
    ev.stopPropagation();
    this._move(ev.detail.oldIndex, ev.detail.newIndex);
  };

  private _handleFavoriteDelete = (
    ev: HASSDomEvent<HASSDomEvents["favorite-item-delete"]>
  ): void => {
    ev.stopPropagation();
    this._deleteFavorite(ev.detail.index);
  };

  private _handleFavoriteAdd = (
    ev: HASSDomEvent<HASSDomEvents["favorite-item-add"]>
  ): void => {
    ev.stopPropagation();
    this._addFavorite();
  };

  private _handleFavoriteDone = (
    ev: HASSDomEvent<HASSDomEvents["favorite-item-done"]>
  ): void => {
    ev.stopPropagation();
    fireEvent(this, "toggle-edit-mode", false);
  };

  protected render(): TemplateResult | typeof nothing {
    if (!this.stateObj || !this.entry) {
      return nothing;
    }

    if (!this.editMode && this._favoriteBrightness.length === 0) {
      return nothing;
    }

    return html`
      <div class="container">
        <ha-more-info-favorites
          .items=${this._favoriteBrightness}
          .renderItem=${this._renderFavorite}
          .deleteLabel=${this._deleteLabel}
          .editMode=${this.editMode ?? false}
          .disabled=${this.stateObj.state === UNAVAILABLE}
          .isAdmin=${Boolean(this.hass.user?.is_admin)}
          .showDone=${this.showDone}
          .addLabel=${this._localizeFavorite("add")}
          .doneLabel=${this.hass.localize(
            "ui.dialogs.more_info_control.exit_edit_mode"
          )}
          @favorite-item-action=${this._handleFavoriteAction}
          @favorite-item-moved=${this._handleFavoriteMoved}
          @favorite-item-delete=${this._handleFavoriteDelete}
          @favorite-item-add=${this._handleFavoriteAdd}
          @favorite-item-done=${this._handleFavoriteDone}
        ></ha-more-info-favorites>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .container ha-more-info-favorites {
      width: 100%;
      max-width: 384px;
      --favorite-items-max-width: 384px;
      --favorite-item-active-background-color: var(--state-light-active-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-more-info-light-favorite-brightness": HaMoreInfoLightFavoriteBrightness;
  }
}
