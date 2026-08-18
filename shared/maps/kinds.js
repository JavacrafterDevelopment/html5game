/**
 * Canonical surface kinds, shared by every map.
 *
 * These drive impact effects (what a bullet throws up) and footstep audio, so a new
 * map only has to tag its colliders with one of these to get the right behaviour.
 */

export const KIND = {
  TERRAIN: 'terrain',
  WALL: 'wall',
  FLOOR: 'floor',
  ROOF: 'roof',
  PROP: 'prop',
  TREE: 'tree',
  ROCK: 'rock',
  WOOD: 'wood',
  // grassy plains
  THATCH: 'thatch',
  MUD: 'mud',
  HAY: 'hay',
  FENCE: 'fence',
  // orbit
  HULL: 'hull',           // pressurised module skin
  TRUSS: 'truss',         // the aluminium spine and everything bolted to it
  SOLAR: 'solar',         // array blankets
  RADIATOR: 'radiator',
  GLASS: 'glass'          // cupola panes
};
