/**
 * Client-side map registry. The server tells us which map id to load in its
 * welcome message; this resolves that id to a renderer.
 */

import { SnowyForestMap } from './snowy_forest/SnowyForestMap.js';

const MAPS = {
  snowy_forest: SnowyForestMap
};

export function createMap(id, scene, options) {
  const Ctor = MAPS[id] || SnowyForestMap;
  return new Ctor(scene, options);
}

export const MAP_IDS = Object.keys(MAPS);
