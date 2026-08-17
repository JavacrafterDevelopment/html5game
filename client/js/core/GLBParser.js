import * as THREE from './three.js';

/**
 * Portable, lightweight GLB parser for Three.js.
 * Handles standard GLB binary buffers, accessors, bufferViews, meshes, materials, and node hierarchies.
 */
export function parseGLB(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);
  const magic = dataView.getUint32(0, true);
  if (magic !== 0x46546c67) { // 'glTF'
    throw new Error('Invalid GLB magic header');
  }
  const totalLength = dataView.getUint32(8, true);

  let json = null;
  let binBuffer = null;

  let offset = 12;
  while (offset < totalLength) {
    const chunkLength = dataView.getUint32(offset, true);
    const chunkType = dataView.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;

    if (chunkType === 0x4e4f534a) { // 'JSON'
      const jsonBytes = new Uint8Array(arrayBuffer, chunkDataStart, chunkLength);
      const jsonStr = new TextDecoder().decode(jsonBytes);
      json = JSON.parse(jsonStr);
    } else if (chunkType === 0x004e4942) { // 'BIN\0'
      binBuffer = arrayBuffer.slice(chunkDataStart, chunkDataStart + chunkLength);
    }
    offset += 8 + chunkLength;
  }

  if (!json || !binBuffer) {
    throw new Error('GLB missing JSON or BIN chunk');
  }

  // 1. Build Materials with realistic weapon presets
  // Authored baseColorFactors on these models sit around 0.02-0.08 linear, which is
  // physically fine for a black rifle and completely unreadable held against snow.
  // The presets lift them into a range where the shape still reads in shadow.
  const MAT_PRESETS = {
    'AK_Steel': { color: 0x1f2227, roughness: 0.36, metalness: 0.90 },
    'AK_Wood': { color: 0x723819, roughness: 0.44, metalness: 0.02 },
    'AK_Bakelite': { color: 0x7c2c15, roughness: 0.38, metalness: 0.04 },
    'AK_BoltSteel': { color: 0xc4c8d0, roughness: 0.18, metalness: 0.98 },
    'Mat_M4_Steel': { color: 0x2a2e33, roughness: 0.40, metalness: 0.86 },
    'Mat_M4_BoltChrome': { color: 0xb9bec6, roughness: 0.18, metalness: 0.95 },
    'Mat_M4_Polymer': { color: 0x23262a, roughness: 0.72, metalness: 0.04 },
    'Mat_M4_Receiver': { color: 0x33383e, roughness: 0.44, metalness: 0.28 },
    'Mat_M4_Accent': { color: 0x3a3f45, roughness: 0.50, metalness: 0.62 }
  };

  const materials = (json.materials || []).map((m) => {
    const preset = MAT_PRESETS[m.name];
    if (preset) {
      return new THREE.MeshStandardMaterial({
        name: m.name || '',
        color: preset.color,
        roughness: preset.roughness,
        metalness: preset.metalness,
        side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide
      });
    }

    const pbr = m.pbrMetallicRoughness || {};
    const baseColor = pbr.baseColorFactor
      ? new THREE.Color(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2])
      : new THREE.Color(0x333333);

    return new THREE.MeshStandardMaterial({
      name: m.name || '',
      color: baseColor,
      roughness: pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 0.45,
      metalness: pbr.metallicFactor !== undefined ? pbr.metallicFactor : 0.7,
      side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide
    });
  });

  // Helper to read accessor
  function getAccessor(index) {
    const acc = json.accessors[index];
    const bv = json.bufferViews[acc.bufferView];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const count = acc.count;

    const componentType = acc.componentType;
    const type = acc.type; // SCALAR, VEC2, VEC3, VEC4

    const itemSize = type === 'SCALAR' ? 1 : type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : 4;
    const totalElements = count * itemSize;

    let array;
    if (componentType === 5126) { // FLOAT
      array = new Float32Array(binBuffer, byteOffset, totalElements);
    } else if (componentType === 5123) { // UNSIGNED_SHORT
      array = new Uint16Array(binBuffer, byteOffset, totalElements);
    } else if (componentType === 5125) { // UNSIGNED_INT
      array = new Uint32Array(binBuffer, byteOffset, totalElements);
    } else if (componentType === 5121) { // UNSIGNED_BYTE
      array = new Uint8Array(binBuffer, byteOffset, totalElements);
    } else {
      throw new Error('Unsupported componentType ' + componentType);
    }

    return new THREE.BufferAttribute(array, itemSize);
  }

  // 2. Build Meshes
  const meshes = (json.meshes || []).map((meshDef) => {
    const primitives = meshDef.primitives.map((prim) => {
      const geo = new THREE.BufferGeometry();
      if (prim.attributes.POSITION !== undefined) {
        geo.setAttribute('position', getAccessor(prim.attributes.POSITION));
      }
      if (prim.attributes.NORMAL !== undefined) {
        geo.setAttribute('normal', getAccessor(prim.attributes.NORMAL));
      } else {
        geo.computeVertexNormals();
      }
      if (prim.attributes.TEXCOORD_0 !== undefined) {
        geo.setAttribute('uv', getAccessor(prim.attributes.TEXCOORD_0));
      }
      if (prim.indices !== undefined) {
        geo.setIndex(getAccessor(prim.indices));
      }

      const mat = prim.material !== undefined && materials[prim.material]
        ? materials[prim.material]
        : new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.5 });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = meshDef.name || '';
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      return mesh;
    });

    if (primitives.length === 1) return primitives[0];
    const group = new THREE.Group();
    group.name = meshDef.name || '';
    primitives.forEach((p) => group.add(p));
    return group;
  });

  // 3. Build Nodes & Hierarchy
  const nodeObjects = (json.nodes || []).map((nodeDef) => {
    const obj = nodeDef.mesh !== undefined ? meshes[nodeDef.mesh].clone() : new THREE.Group();
    obj.name = nodeDef.name || '';
    if (nodeDef.translation) {
      obj.position.set(nodeDef.translation[0], nodeDef.translation[1], nodeDef.translation[2]);
    }
    if (nodeDef.rotation) {
      obj.quaternion.set(nodeDef.rotation[0], nodeDef.rotation[1], nodeDef.rotation[2], nodeDef.rotation[3]);
    }
    if (nodeDef.scale) {
      obj.scale.set(nodeDef.scale[0], nodeDef.scale[1], nodeDef.scale[2]);
    }
    return obj;
  });

  // Attach children
  json.nodes?.forEach((nodeDef, idx) => {
    if (nodeDef.children) {
      for (const childIdx of nodeDef.children) {
        nodeObjects[idx].add(nodeObjects[childIdx]);
      }
    }
  });

  // Root scene
  const rootScene = new THREE.Group();
  rootScene.name = 'GLBScene';
  const defaultScene = json.scenes ? json.scenes[json.scene || 0] : null;
  const rootNodeIndices = defaultScene ? defaultScene.nodes : json.nodes?.map((_, i) => i) || [];

  for (const rootIdx of rootNodeIndices) {
    rootScene.add(nodeObjects[rootIdx]);
  }

  return rootScene;
}

/**
 * Async fetch and parse a GLB file by URL.
 */
export async function loadGLB(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load GLB: ${url} (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  return parseGLB(arrayBuffer);
}

export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export function parseBase64GLB(base64) {
  return parseGLB(base64ToArrayBuffer(base64));
}
