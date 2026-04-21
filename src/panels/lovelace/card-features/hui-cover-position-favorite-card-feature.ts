import { customElement } from "lit/decorators";
import type { CoverEntity } from "../../../data/cover";
import {
  DEFAULT_COVER_FAVORITE_POSITIONS,
  coverSupportsPosition,
} from "../../../data/cover";
import { normalizeFavoritePositions } from "../../../data/favorite_positions";
import type { HomeAssistant } from "../../../types";
import {
  HuiNumericFavoriteCardFeatureBase,
  type NumericFavoriteCardFeatureDefinition,
  supportsNumericFavoriteCardFeature,
} from "./hui-numeric-favorite-card-feature-base";
import type {
  CoverPositionFavoriteCardFeatureConfig,
  LovelaceCardFeatureContext,
} from "./types";
import { getMoreInfoHintCardFeatureEditor } from "./get-more-info-hint-card-feature-editor";

const coverPositionFavoriteCardFeatureDefinition: NumericFavoriteCardFeatureDefinition<CoverEntity> =
  {
    domain: "cover",
    supportsValue: coverSupportsPosition,
    getFavoriteValues: (entry) => entry?.options?.cover?.favorite_positions,
    getCurrentValue: (stateObj) => stateObj.attributes.current_position,
    normalizeFavoriteValues: normalizeFavoritePositions,
    defaultFavoriteValues: DEFAULT_COVER_FAVORITE_POSITIONS,
    setValueService: "set_cover_position",
    serviceDataKey: "position",
    setValueLabelKey:
      "ui.dialogs.more_info_control.cover.favorite_position.set",
    featureLabelKey:
      "ui.panel.lovelace.editor.features.types.cover-position-favorite.label",
  };

export const supportsCoverPositionFavoriteCardFeature = (
  hass: HomeAssistant,
  context: LovelaceCardFeatureContext
) =>
  supportsNumericFavoriteCardFeature(
    hass,
    context,
    coverPositionFavoriteCardFeatureDefinition
  );

@customElement("hui-cover-position-favorite-card-feature")
class HuiCoverPositionFavoriteCardFeature extends HuiNumericFavoriteCardFeatureBase<
  CoverEntity,
  CoverPositionFavoriteCardFeatureConfig
> {
  protected get _definition(): NumericFavoriteCardFeatureDefinition<CoverEntity> {
    return coverPositionFavoriteCardFeatureDefinition;
  }

  static getStubConfig(): CoverPositionFavoriteCardFeatureConfig {
    return {
      type: "cover-position-favorite",
    };
  }

  public static getConfigElement = getMoreInfoHintCardFeatureEditor;
}

declare global {
  interface HTMLElementTagNameMap {
    "hui-cover-position-favorite-card-feature": HuiCoverPositionFavoriteCardFeature;
  }
}
