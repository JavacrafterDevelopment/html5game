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
import { createSky, createLighting, createInteriorLights } from './Sky.js';
import { MAP_INFO, INTERIOR_PROBES } from '/shared/maps/iss/index.js';

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

    this.cabin = await step(0.86, 'Switching the cabin lights on', () => createInteriorLights(INTERIOR_PROBES));
    this.scene.add(this.cabin);

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
  }

  /** Nothing out here hears a thing. */
  onGunshot() {}

  dispose() {
    if (!this.built) return;
    this.scene.remove(this.sky, this.lighting.group, this.station, this.cabin);
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
