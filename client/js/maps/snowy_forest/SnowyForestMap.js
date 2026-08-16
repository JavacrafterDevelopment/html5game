/**
 * Snowy Forest -- scene assembly.
 *
 * Owns the terrain, the forest, the cabin, the sky dome, the light rig and the
 * weather. Adding a second map later means writing a sibling class with the same
 * build/update/dispose surface and registering it in client/js/maps/MapRegistry.js.
 */

import * as THREE from '../../core/three.js';
import { createTerrain, createDistantMountains } from './TerrainMesh.js';
import { createFoliage } from './Foliage.js';
import { createCabin } from './CabinMesh.js';
import { createSky, createLighting, CloudField } from './Sky.js';
import { Snowfall } from '../../effects/Snowfall.js';
import { MAP_INFO } from '/shared/maps/snowy_forest/index.js';

export class SnowyForestMap {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = options;
    this.env = { ...MAP_INFO.environment, ...(options.environment || {}) };
    this.info = MAP_INFO;
    this.built = false;
    this.time = 0;
  }

  /**
   * Built in stages so the loading bar can advance between them.
   * @param {(fraction:number, label:string)=>void} onProgress
   */
  async build(onProgress = () => {}) {
    const quality = this.options.quality || 'high';
    const shadows = quality !== 'low';
    const step = async (fraction, label, fn) => {
      onProgress(fraction, label);
      // Yield to the browser so the loading bar actually paints between stages.
      await new Promise((r) => setTimeout(r, 0));
      return fn();
    };

    this.scene.fog = new THREE.FogExp2(this.env.fogColor, this.env.fogDensity);
    this.scene.background = new THREE.Color(this.env.fogColor);

    this.sky = await step(0.10, 'Raising the sky', () => createSky(this.env));
    this.scene.add(this.sky);

    this.clouds = await step(0.14, 'Forming moving clouds', () =>
      new CloudField(this.env, quality === 'low' ? 14 : quality === 'medium' ? 20 : 28));
    this.scene.add(this.clouds.group);

    this.lighting = await step(0.18, 'Placing the sun', () =>
      createLighting(this.env, { shadows, shadowMapSize: quality === 'ultra' ? 4096 : 2048 }));
    this.scene.add(this.lighting.group);

    this.terrain = await step(0.30, 'Carving the valley', () => createTerrain());
    this.scene.add(this.terrain);

    this.mountains = await step(0.52, 'Raising the mountains', () => createDistantMountains());
    this.scene.add(this.mountains);

    this.foliage = await step(0.62, 'Planting the forest', () => createFoliage({ shadows }));
    this.scene.add(this.foliage);

    this.cabin = await step(0.80, 'Building the cabin', () => createCabin());
    this.scene.add(this.cabin);

    this.snow = await step(0.90, 'Starting the weather', () => new Snowfall({
      density: quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1.0,
      wind: this.env.windDirection,
      strength: this.env.windStrength
    }));
    this.scene.add(this.snow.group);

    onProgress(1.0, 'Ready');
    this.built = true;
    return this;
  }

  update(dt, camera) {
    if (!this.built) return;
    this.time += dt;
    if (this.sky?.material?.uniforms?.uTime) {
      this.sky.material.uniforms.uTime.value = this.time;
    }
    this.clouds?.update(dt);
    this.snow.update(dt, camera.position);
    this.lighting.update(camera.position);
    // The sky dome and the scenic ridge line ride with the camera so they stay
    // infinitely far away.
    this.sky.position.copy(camera.position);
    this.mountains.position.set(camera.position.x * 0.55, 0, camera.position.z * 0.55);
    this.mountains.updateMatrix();
  }

  dispose() {
    if (!this.built) return;
    this.scene.remove(this.sky, this.clouds?.group, this.lighting.group, this.terrain, this.mountains, this.foliage, this.cabin, this.snow.group);
    this.snow.dispose();
    this.clouds?.dispose();
    const kill = (obj) => obj?.traverse?.((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      }
    });
    kill(this.terrain); kill(this.foliage); kill(this.cabin); kill(this.mountains); kill(this.sky);
    this.built = false;
  }
}
