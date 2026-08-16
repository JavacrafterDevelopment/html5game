/**
 * Grassy Plains -- scene assembly.
 *
 * Same build/update/dispose surface as the snowy map, which is what lets the server
 * swap between them at runtime with /map.
 */

import * as THREE from '../../core/three.js';
import { createTerrain } from './TerrainMesh.js';
import { createHuts } from './HutMesh.js';
import { createProps } from './Props.js';
import { GrassField } from './GrassField.js';
import { SheepFlocks } from './Sheep.js';
import { createSky, createLighting } from './Sky.js';
import { WindMotes } from '../../effects/WindMotes.js';
import { MAP_INFO } from '/shared/maps/grassy_plains/index.js';

const GRASS_COUNT = { low: 4500, medium: 9000, high: 16000, ultra: 26000 };

export class GrassyPlainsMap {
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

    this.scene.fog = new THREE.FogExp2(this.env.fogColor, this.env.fogDensity);
    this.scene.background = new THREE.Color(this.env.fogColor);

    this.sky = await step(0.08, 'Opening the sky', () => createSky(this.env));
    this.scene.add(this.sky);

    this.lighting = await step(0.16, 'Hanging the sun', () =>
      createLighting(this.env, { shadows, shadowMapSize: quality === 'ultra' ? 4096 : 2048 }));
    this.scene.add(this.lighting.group);

    this.terrain = await step(0.28, 'Rolling out the fields', () => createTerrain());
    this.scene.add(this.terrain);

    this.props = await step(0.48, 'Planting hedgerows', () => createProps({ shadows }));
    this.scene.add(this.props);

    this.huts = await step(0.66, 'Raising the huts', () => createHuts());
    this.scene.add(this.huts);

    this.grass = await step(0.78, 'Sowing the grass', () => new GrassField({
      count: GRASS_COUNT[quality] ?? GRASS_COUNT.high,
      wind: this.env.windDirection,
      strength: this.env.windStrength,
      viewDistance: quality === 'low' ? 34 : quality === 'medium' ? 46 : 60
    }));
    this.scene.add(this.grass.group);

    this.sheep = await step(0.90, 'Letting the sheep out', () => new SheepFlocks({ enabled: true }));
    this.scene.add(this.sheep.group);

    this.wind = await step(0.96, 'Getting the wind up', () => new WindMotes({
      wind: this.env.windDirection,
      strength: this.env.windStrength,
      density: quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : 1.0
    }));
    this.scene.add(this.wind.group);

    onProgress(1, 'Ready');
    this.built = true;
    return this;
  }

  update(dt, camera) {
    if (!this.built) return;
    this.time += dt;
    this.grass.update(dt);
    this.sheep.update(dt);
    this.wind.update(dt, camera.position);
    this.lighting.update(camera.position);
    if (this.sky.material.uniforms.uTime) this.sky.material.uniforms.uTime.value = this.time;
    this.sky.position.copy(camera.position);
  }

  /** Gunfire scatters the nearest flock. */
  onGunshot(position) {
    this.sheep?.startleNear(position[0], position[2]);
  }

  dispose() {
    if (!this.built) return;
    this.scene.remove(this.sky, this.lighting.group, this.terrain,
      this.props, this.huts, this.grass.group, this.sheep.group, this.wind.group);
    this.grass.dispose();
    this.sheep.dispose();
    this.wind.dispose();
    const kill = (obj) => obj?.traverse?.((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        o.geometry?.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material?.dispose();
      }
    });
    kill(this.terrain); kill(this.props); kill(this.huts); kill(this.sky);
    this.built = false;
  }
}
