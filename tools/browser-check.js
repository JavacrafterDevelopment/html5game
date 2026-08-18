/**
 * Paste-into-the-console smoke test for the client.
 *
 * Open the game, deploy, press F12 and paste this whole file into the console.
 * It exercises the render path, weapons, effects, ragdolls and the scope, and
 * prints a pass/fail list.
 *
 * The render check matters most: a ShaderMaterial with bad uniforms makes
 * THREE.WebGLRenderer throw PART WAY through a frame, so the world still looks
 * fine while everything queued behind it silently disappears.
 */
(async function whiteoutCheck() {
  const g = window.__whiteout;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? '  -> ' + detail : ''}`);
  };

  if (!g || !g.running) {
    console.error('Deploy into a match first, then re-run this.');
    return;
  }

  // ---- 1. a full frame must complete without throwing ----
  let renderError = null;
  try { g._render(); } catch (e) { renderError = e.message; }
  check('full frame renders without throwing', !renderError, renderError || '');

  // every scene material that claims fog must actually carry fog uniforms
  const badFog = [];
  g.scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m.isShaderMaterial && m.fog === true && !m.uniforms?.fogColor) {
        badFog.push(o.name || o.type);
      }
    }
  });
  check('no ShaderMaterial declares fog without fog uniforms', badFog.length === 0, badFog.join(', '));

  // ---- 2. weapons ----
  for (const id of ['ak47', 'm4a1', 'm700', 'glock17']) {
    g.viewModel.setWeapon(id);
    const m = g.viewModel.model;
    check(`${id} model builds`, !!m && !!m.muzzle && !!m.sight);
  }
  g.viewModel.setWeapon(g.weapons.weaponId);

  // ---- 2b. the M4 comes from m4.glb, with its parts still separable ----
  g.viewModel.setWeapon('m4a1', true);
  const m4 = g.viewModel.model;
  const M4_PARTS = ['M4_Magazine', 'M4_ChargingHandle', 'M4_BoltCarrier', 'M4_FlashHider',
    'M4_CarryHandle_RearSight', 'M4_FrontSight_GasBlock'];
  const missing = M4_PARTS.filter((n) => !m4.group.getObjectByName(n));
  check('M4 loads from m4.glb with named parts', missing.length === 0, missing.join(', '));
  check('M4 has its own reload choreography', !!m4.reload);

  // A reload throws the rifle out of frame and brings it back. `gun` and `stash`
  // are animation frames that get reset to (0,0,0), so anything that belongs in
  // their rest pose has to live BELOW them -- otherwise every reload walks the
  // weapon 15 cm closer to the eye and never puts it back.
  {
    const restOf = () => {
      g.viewModel.root.updateMatrixWorld(true);
      const p = new (g.camera.position.constructor)();
      return m4.muzzle.getWorldPosition(p).clone();
    };
    const st = { ads: false, sprint: false, speed: 0, grounded: true, lookDX: 0, lookDY: 0, lowered: false };
    for (let i = 0; i < 40; i++) g.viewModel.update(1 / 60, st);
    const before = restOf();
    g.viewModel.startReload(2400);
    for (let i = 0; i < 200; i++) g.viewModel.update(1 / 60, st);   // >2.4 s, runs to completion
    for (let i = 0; i < 40; i++) g.viewModel.update(1 / 60, st);
    const after = restOf();
    check('weapon returns to its rest pose after a reload', before.distanceTo(after) < 0.01,
      `${(before.distanceTo(after) * 100).toFixed(1)} cm of drift`);
    check('magazine goes back in the weapon',
      m4.group.getObjectByName('M4_Magazine').parent !== null &&
      m4.group.getObjectByName('M4_Magazine').getWorldPosition(new (g.camera.position.constructor)())
        .distanceTo(g.camera.getWorldPosition(new (g.camera.position.constructor)())) < 1);
  }
  g.viewModel.setWeapon(g.weapons.weaponId, true);

  // ---- 3. effects ----
  const before = g.effects.debris.activeCount;
  g.effects.impact([g.player.pos[0], g.player.pos[1] + 1, g.player.pos[2] + 2], [0, 1, 0], 'terrain');
  g.effects.update(1 / 60, g.camera);
  check('impact debris spawns', g.effects.debris.activeCount > before);

  g.effects.tracer([0, 5, 0], [0, 5, 20], {});
  check('tracer pool fires', g.effects.bullets.items.some((i) => i.active));

  const smokeBefore = g.effects.debris.activeCount;
  g.effects.muzzleFlash([g.player.pos[0], g.player.pos[1] + 1.5, g.player.pos[2]], 1, g.camera);
  check('muzzle flash fires', g.effects.flashes.items.some((i) => i.life > 0));

  // The flash is drawn a few centimetres from the eye. Anything approaching the
  // size of the weapon itself stops being a flash and starts being a wall.
  const flash = g.effects.flashes.items.find((i) => i.life > 0);
  check('muzzle flash is small enough to see past', flash.mesh.scale.x < 0.13,
    `${(flash.mesh.scale.x * 100).toFixed(1)} cm across`);
  check('muzzle flash has a soft falloff texture, not a bare quad', !!flash.mesh.material.map);
  g.effects.update(1 / 60, g.camera);
  check('muzzle smoke puffs out', g.effects.debris.activeCount > smokeBefore);

  let e2 = null;
  try { g._render(); } catch (e) { e2 = e.message; }
  check('frame still renders with effects active', !e2, e2 || '');

  // ---- 4. weather, on the maps that have any ----
  if (g.map.snow) {
    check('snowfall present', !!g.map.snow.group.parent);
    check('snowfall tracks the camera',
      g.map.snow.far.material.uniforms.uCamPos.value.distanceTo(g.camera.position) < 0.01);
  }

  // ---- 5. scope ----
  const prevWeapon = g.weapons.weaponId;
  g.weapons.setLoadout('m700');
  g.viewModel.adsBlend = 1;
  g.scope.update(1 / 60, 1, {});
  let e3 = null;
  try { g.scope.render(g.scene, g.camera, [g.viewModel.root]); g.scope.composite(); } catch (e) { e3 = e.message; }
  check('scope renders and composites', !e3, e3 || '');
  check('scope magnifies', g.camera.fov / g.scope.camera.fov > 2,
    `${(g.camera.fov / g.scope.camera.fov).toFixed(1)}x`);
  g.weapons.setLoadout(prevWeapon === 'm700' ? 'ak47' : prevWeapon);

  // ---- 6. ragdoll ----
  g._onPlayerJoin({ id: 99991, name: 'SmokeTest' });
  const rp = g.remotes.get(99991);
  const bx = g.player.pos[0] + 3, bz = g.player.pos[2] + 3, by = g.player.pos[1];
  for (let i = 0; i < 6; i++) {
    rp.applySnapshot(g.net.serverNow() - 300 + i * 60, { i: 99991, p: [bx, by, bz], y: 0, t: 0, s: 0, w: 'ak47', a: 1 });
  }
  rp.update(1 / 60, g.net.serverNow() - 110, g.camera);
  const n = g.ragdolls.bodies.length;
  g._onPlayerDied({ id: 99991, dir: [1, 0, 0], hitY: by + 1.4, headshot: false });
  const rag = g.ragdolls.bodies[g.ragdolls.bodies.length - 1];
  check('ragdoll spawns on death', g.ragdolls.bodies.length === n + 1);
  check('ragdoll spawns at the body, not the origin',
    Math.hypot(rag.p.pelvis.pos.x - bx, rag.p.pelvis.pos.z - bz) < 2.5,
    `${Math.hypot(rag.p.pelvis.pos.x - bx, rag.p.pelvis.pos.z - bz).toFixed(2)} m away`);

  const dropY = rag.p.pelvis.pos.y;
  for (let i = 0; i < 200; i++) rag.update(1 / 60);
  const M = await import('/shared/maps/active.js');
  if (M.mapInfo().environment.gravityScale === 0) {
    // In orbit a body does not settle -- it drifts. Falling is the failure here.
    check('a body in free fall does not sink toward a floor that is not there',
      rag.p.pelvis.pos.y > dropY - 0.6,
      `${(rag.p.pelvis.pos.y - dropY).toFixed(2)} m after 3.3 s`);
  } else {
    let sunk = 0;
    for (const p of Object.values(rag.p)) sunk = Math.min(sunk, p.pos.y - M.heightAt(p.pos.x, p.pos.z));
    check('settled ragdoll stays above ground', sunk > -0.05, `${sunk.toFixed(3)} m`);
  }
  check('ragdoll limbs stay attached',
    Math.abs(rag.p.shoulderL.pos.distanceTo(rag.p.elbowL.pos)
      - rag.links.find((l) => l.a === 'shoulderL' && l.b === 'elbowL').rest) < 0.05);
  g._onPlayerLeave({ id: 99991 });

  // ---- 6b. decorative rock must not overhang its collider ----
  // A boulder drawn outside the collision volume is the inverse of an invisible
  // wall: solid-looking rock you walk straight through. Box3.setFromObject is not
  // instance-aware, so this measures the instance matrices directly.
  if (g.map.cave) {
    const THREE = await import('/client/vendor/three.module.js');
    const { CAVE } = await import('/shared/maps/grassy_plains/cave.js');
    const m4 = new THREE.Matrix4();
    const p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
    let over = 0;
    for (const mesh of g.map.cave.children) {
      if (!mesh.isInstancedMesh) continue;
      mesh.geometry.computeBoundingBox();
      const gb = mesh.geometry.boundingBox;
      const gx = Math.max(Math.abs(gb.min.x), Math.abs(gb.max.x));
      const gz = Math.max(Math.abs(gb.min.z), Math.abs(gb.max.z));
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m4);
        m4.decompose(p, q, s);
        over = Math.max(over,
          (CAVE.x - CAVE.halfW) - (p.x - gx * s.x),
          (p.x + gx * s.x) - (CAVE.x + CAVE.halfW),
          (CAVE.z - CAVE.halfD) - (p.z - gz * s.z),
          (p.z + gz * s.z) - (CAVE.z + CAVE.halfD + CAVE.mouthLen));
      }
    }
    check('cave rock stays inside its collision volume', over < 0.15, `overhang ${over.toFixed(2)} m`);
  }

  // ---- 6c. the ISS, if that is the map we are on ----
  // Only runs when the server is actually on it; type /map iss first.
  if (g.mapId === 'iss') {
    const THREE = await import('/client/vendor/three.module.js');
    const active = await import('/shared/maps/active.js');
    const iss = await import('/shared/maps/iss/index.js');

    check('zero-g movement is active', active.movement().mode === 'zerog');
    check('the crew are astronauts', active.characterStyle() === 'astronaut');
    check('there is no fog in vacuum', g.scene.fog === null);

    // Side thrusters. The bank has to PERSIST -- a roll that springs back to level
    // is a lean, and the point of this map is being able to fly upside down.
    const st = { move: { x: 0, z: 0 }, jump: false, crouch: false, sprint: false,
      roll: 1, lift: 0, ads: false, speedMult: 1, frozen: false };
    g.player.pos = [0, -0.46, -12];
    g.player.roll = 0;
    for (let i = 0; i < 110; i++) g.player.update(1 / 60, st);
    const rolled = g.player.roll;
    st.roll = 0;
    for (let i = 0; i < 120; i++) g.player.update(1 / 60, st);
    check('Q/E roll the player past inverted', Math.abs(rolled) > 2.6,
      `${(rolled * 57.3).toFixed(0)} deg after 1.8 s`);
    check('the bank stays where it is left', Math.abs(g.player.roll - rolled) < 0.25,
      `drifted ${((g.player.roll - rolled) * 57.3).toFixed(1)} deg in 2 s`);
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(g.camera.quaternion).y;
    check('the camera actually turns over with it', upY < -0.7, `camera up.y ${upY.toFixed(2)}`);
    g.player.roll = 0;

    // W and S still mean forward and back -- they just follow where you look.
    g.player.pos = [0, -0.46, -12];
    g.player.vel.set(0, 0, 0);
    g.player.yaw = 0; g.player.pitch = 0;
    const fwd = { ...st, move: { x: 0, z: 1 } };
    for (let i = 0; i < 60; i++) g.player.update(1 / 60, fwd);
    check('W drives you along the way you are looking', g.player.pos[2] < -14,
      `travelled ${(-12 - g.player.pos[2]).toFixed(1)} m in a second`);

    // Nothing floats and nothing is drawn outside what stops a bullet. This is the
    // check the plains map never had: fire rays at the station from every side and
    // demand that the drawn surface and the collision surface agree. Anything drawn
    // WELL PROUD of its collider is scenery you can fly through.
    const rc = new THREE.Raycaster();
    const origin = new THREE.Vector3(), dir = new THREE.Vector3(), target = new THREE.Vector3();
    const b = iss.STATION_BOUNDS;
    let compared = 0, worst = 0, ghosts = [];
    for (let i = 0; i < 700; i++) {
      const a1 = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * Math.PI;
      origin.set(Math.cos(a1) * Math.cos(e), Math.sin(e), Math.sin(a1) * Math.cos(e)).multiplyScalar(74);
      target.set(
        b.min[0] + Math.random() * (b.max[0] - b.min[0]),
        b.min[1] + Math.random() * (b.max[1] - b.min[1]),
        b.min[2] + Math.random() * (b.max[2] - b.min[2]));
      dir.subVectors(target, origin).normalize();
      rc.set(origin, dir);
      const hit = rc.intersectObject(g.map.station, true)[0];
      if (!hit) continue;
      const solid = iss.raycastWorld(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 400);
      compared++;
      // Drawn surface in FRONT of the collider by more than a handrail's depth.
      const proud = solid ? solid.dist - hit.distance : 999;
      if (proud > worst) worst = proud;
      if (proud > 0.3 && ghosts.length < 6) {
        ghosts.push(`${hit.object.name} ${proud.toFixed(2)}m proud`);
      }
    }
    check('drawn geometry never sticks out past its collider', ghosts.length === 0,
      ghosts.length ? ghosts.join('; ') : `${compared} rays, worst overhang ${worst.toFixed(2)} m`);

    // The stack is a clear shot end to end, which is what makes it a corridor.
    const through = iss.raycastWorld(0, 0, -8, 0, 0, -1, 400);
    check('the pressurised stack is a clear sight line', through === null);
  }

  // ---- 7. hardcore rules ----
  check('no hitmarker element exists', !document.querySelector('#hitmarker, .hitmarker'));
  check('no kill feed element exists', !document.querySelector('#killfeed, .killfeed, .kill-feed'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) console.warn('failed:', failed.map((f) => f.name));
  return { passed: results.length - failed.length, total: results.length, failed: failed.map((f) => f.name) };
})();
