/**
 * ISS -- the absence of terrain.
 *
 * Every other map answers "how high is the ground here". In orbit there is no
 * answer, and the honest thing is to say so rather than to lay an invisible floor
 * somewhere out of sight: a floor at -500 m is still a floor, and sooner or later
 * somebody lands on it.
 *
 * So heightAt reports a depth nothing can reach and the collider is built with
 * hasTerrain:false, which makes it skip the ground clamp and the terrain march
 * entirely. These functions exist only because the map contract asks for them.
 */

import { clamp } from '../../math/num.js';

export const TERRAIN = {
  seed: 1998,          // the year Zarya went up
  extent: 150,
  /**
   * The volume you are expected to fly in. Past this the station is behind you and
   * there is nothing ahead, so the boundary is a soft push back rather than a wall
   * -- there is no geometry out here to stop you with, and pretending otherwise is
   * how you get an invisible wall in the middle of an empty sky.
   */
  playRadius: 96,
  hardRadius: 132,
  /**
   * The collider's own backstop is a cylinder round Y, which on a map you can fly
   * straight up would stop you somewhere the soft boundary has not even started
   * pushing yet. Matching it to hardRadius keeps the only edge anybody meets the
   * spherical one in LocalPlayer.
   */
  hardY: 132,
  meshResolution: 2
};

/** Far enough below that no bullet, body or bit of debris will ever reach it. */
const VOID_Y = -1e6;

export function heightAt() { return VOID_Y; }
export function normalAt() { return [0, 1, 0]; }
export function slopeAt() { return 0; }

/** There is nowhere to stand. That is the whole point of the map. */
export function isWalkable() { return false; }

/** Distance from the centre of the play volume, spherical rather than cylindrical. */
export function radiusAt(x, y, z) {
  return Math.hypot(x, y, z);
}

/** How far past the soft boundary a position is, 0..1. */
export function boundaryPressure(x, y, z) {
  return clamp((radiusAt(x, y, z) - TERRAIN.playRadius) / (TERRAIN.hardRadius - TERRAIN.playRadius), 0, 1);
}
