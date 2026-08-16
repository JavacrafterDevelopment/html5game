/**
 * Map registry. Add a folder under shared/maps/, export the same shape, register it here.
 */

import * as snowyForest from './snowy_forest/index.js';

export const MAPS = {
  snowy_forest: snowyForest
};

export const DEFAULT_MAP = 'snowy_forest';

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}
