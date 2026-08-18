/**
 * ISS -- scene assembly.
 *
 * Same build/update/dispose surface as the two ground maps, which is what lets the
 * server swap to it at runtime with /map iss. The only thing it does differently is
 * clear the fog: there is no air out here, so a distant object is exactly as sharp
 * as a near one, and leaving a fog term in would quietly grey out the far end of
 * the truss.
 */

import * as THREE from '../../core/three.js';
import { createStation } from './StationMesh.js';
import { createAsteroids } from './Asteroids.js';
import { createSky, createLighting, createInteriorLights, sunDirection } from './Sky.js';
import { SunGlare } from './SunGlare.js';
import { MAP_INFO, INTERIOR_PROBES } from '/shared/maps/iss/index.js';
import { raycastWorld } from '/shared/maps/active.js';

export class ISSMap {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = options;
    this.env = { ...MAP_INFO.environment, ...(options.environment || {}) };
    this.info = MAP_INFO;
    this.built = false;
    this.time = 0;
  }

  async build(onProgress = () => {}) {
    const quality = this.options.quality || 'high';
    const shadows = quality !== 'low';
    const step = async (fraction, label, fn) => {
      onProgress(fraction, label);
      await new Promise((r) => setTimeout(r, 0));
      return fn();
    };

    // Vacuum: no fog term at all, and a background that is only ever seen for the
    // one frame before the star dome is drawn.
    this.scene.fog = null;
    this.scene.background = new THREE.Color(0x000000);

    this.sky = await step(0.10, 'Hanging the stars', () => createSky(this.env));
    this.scene.add(this.sky);

    this.lighting = await step(0.24, 'Lighting the sun', () =>
      createLighting(this.env, { shadows, shadowMapSize: quality === 'ultra' ? 4096 : 2048 }));
    this.scene.add(this.lighting.group);

    this.station = await step(0.42, 'Berthing the modules', () => createStation({ shadows }));
    this.scene.add(this.station);

    this.rocks = await step(0.70, 'Scattering the debris field', () => createAsteroids({ shadows }));
    this.scene.add(this.rocks);

    this.cabin = await step(0.86, 'Switching the cabin lights on', () => createInteriorLights(INTERIOR_PROBES));
    this.scene.add(this.cabin);

    this.glare = await step(0.94, 'Unfiltering the sun', () =>
      new SunGlare(sunDirection(this.env), this.env.sunColor));
    this.scene.add(this.glare.mesh);
    /**
     * Screen-space, so it belongs to the eye and not to the optic. The scope's
     * second pass renders the same scene through a 13 degree camera, where the sun
     * is somewhere else entirely -- Game hands this list to Scope.render to hide.
     */
    this.overlays = [this.glare.mesh];

    onProgress(1, 'Ready');
    this.built = true;
    return this;
  }

  update(dt, camera) {
    if (!this.built) return;
    this.time += dt;
    // Only the cloud deck on Earth moves, and it moves slowly.
    this.sky.material.uniforms.uTime.value = this.time;
    this.sky.position.copy(camera.position);
    this.lighting.update(camera.position);
    this.glare.update(dt, camera, raycastWorld);
  }

  /** Nothing out here hears a thing. */
  onGunshot() {}

  dispose() {
    if (!this.built) return;
    this.scene.remove(this.sky, this.lighting.group, this.station, this.cabin, this.rocks, this.glare.mesh);
    this.rocks.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
    this.rocks.userData.material?.map?.dispose();
    this.rocks.userData.material?.dispose();
    this.glare.dispose();
    this.overlays = null;
    this.station.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose();
    });
    for (const m of Object.values(this.station.userData.materials || {})) {
      m.map?.dispose();
      m.emissiveMap?.dispose();
      m.dispose();
    }
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.built = false;
  }
}
