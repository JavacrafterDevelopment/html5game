/**
 * Map registry. Add a folder under shared/maps/, export the same shape, register it
 * here, and add a matching renderer in client/js/maps/MapRegistry.js.
 */

import * as snowyForest from './snowy_forest/index.js';
import * as grassyPlains from './grassy_plains/index.js';

export const MAPS = {
  snowy_forest: snowyForest,
  grassy_plains: grassyPlains
};

/** Short names players can type: /map snow, /map grass */
export const MAP_ALIASES = {
  snow: 'snowy_forest',
  snowy: 'snowy_forest',
  snowy_forest: 'snowy_forest',
  winter: 'snowy_forest',
  whiteout: 'snowy_forest',
  grass: 'grassy_plains',
  grassy: 'grassy_plains',
  grassy_plains: 'grassy_plains',
  plains: 'grassy_plains',
  field: 'grassy_plains',
  hollowmere: 'grassy_plains'
};

export const DEFAULT_MAP = 'snowy_forest';

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}

/** Resolve whatever the player typed to a real map id, or null. */
export function resolveMapId(input) {
  if (!input) return null;
  const key = String(input).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return MAP_ALIASES[key] || (MAPS[key] ? key : null);
}
