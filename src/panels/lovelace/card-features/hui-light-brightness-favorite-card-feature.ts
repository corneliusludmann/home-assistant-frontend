import { customElement } from "lit/decorators";
import type { LightEntity } from "../../../data/light";
import {
  DEFAULT_LIGHT_FAVORITE_BRIGHTNESS,
  lightSupportsBrightness,
  normalizeLightFavoriteBrightness,
} from "../../../data/light";
import type { HomeAssistant } from "../../../types";
import {
  HuiNumericFavoriteCardFeatureBase,
  type NumericFavoriteCardFeatureDefinition,
  supportsNumericFavoriteCardFeature,
} from "./hui-numeric-favorite-card-feature-base";
import type {
  LightBrightnessFavoriteCardFeatureConfig,
  LovelaceCardFeatureContext,
} from "./types";
import { getMoreInfoHintCardFeatureEditor } from "./get-more-info-hint-card-feature-editor";

const lightBrightnessFavoriteCardFeatureDefinition: NumericFavoriteCardFeatureDefinition<LightEntity> =
  {
    domain: "light",
    supportsValue: lightSupportsBrightness,
    getFavoriteValues: (entry) => entry?.options?.light?.favorite_brightness,
    getCurrentValue: (stateObj) => {
      if (stateObj.state === "off") {
        return 0;
      }
      return stateObj.attributes.brightness != null
        ? Math.round((stateObj.attributes.brightness * 100) / 255)
        : undefined;
    },
    normalizeFavoriteValues: normalizeLightFavoriteBrightness,
    defaultFavoriteValues: DEFAULT_LIGHT_FAVORITE_BRIGHTNESS,
    setValueService: "turn_on",
    serviceDataKey: "brightness_pct",
    setValueLabelKey:
      "ui.dialogs.more_info_control.light.favorite_brightness.set",
    featureLabelKey:
      "ui.panel.lovelace.editor.features.types.light-brightness-favorite.label",
  };

export const supportsLightBrightnessFavoriteCardFeature = (
  hass: HomeAssistant,
  context: LovelaceCardFeatureContext
) =>
  supportsNumericFavoriteCardFeature(
    hass,
    context,
    lightBrightnessFavoriteCardFeatureDefinition
  );

@customElement("hui-light-brightness-favorite-card-feature")
class HuiLightBrightnessFavoriteCardFeature extends HuiNumericFavoriteCardFeatureBase<
  LightEntity,
  LightBrightnessFavoriteCardFeatureConfig
> {
  protected get _definition(): NumericFavoriteCardFeatureDefinition<LightEntity> {
    return lightBrightnessFavoriteCardFeatureDefinition;
  }

  static getStubConfig(): LightBrightnessFavoriteCardFeatureConfig {
    return {
      type: "light-brightness-favorite",
    };
  }

  public static getConfigElement = getMoreInfoHintCardFeatureEditor;
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-light-brightness-favorite-card-feature": HuiLightBrightnessFavoriteCardFeature;
  }
}
