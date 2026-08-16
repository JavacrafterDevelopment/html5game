/**
 * Client-side map registry. The server names a map id in its welcome message and in
 * map-change broadcasts; this resolves that id to a renderer.
 */

import { SnowyForestMap } from './snowy_forest/SnowyForestMap.js';
import { GrassyPlainsMap } from './grassy_plains/GrassyPlainsMap.js';

const MAPS = {
  snowy_forest: SnowyForestMap,
  grassy_plains: GrassyPlainsMap
};

export function createMap(id, scene, options) {
  const Ctor = MAPS[id] || SnowyForestMap;
  return new Ctor(scene, options);
}

export const MAP_IDS = Object.keys(MAPS);
