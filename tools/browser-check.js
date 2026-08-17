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
  check('tracer pool fires', g.effects.tracers.items.some((i) => i.life > 0));

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

  // ---- 4. snowfall ----
  check('snowfall present', !!g.map.snow?.group.parent);
  check('snowfall tracks the camera',
    g.map.snow.far.material.uniforms.uCamPos.value.distanceTo(g.camera.position) < 0.01);

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

  for (let i = 0; i < 200; i++) rag.update(1 / 60);
  const T = await import('/shared/maps/snowy_forest/terrain.js');
  let sunk = 0;
  for (const p of Object.values(rag.p)) sunk = Math.min(sunk, p.pos.y - T.heightAt(p.pos.x, p.pos.z));
  check('settled ragdoll stays above ground', sunk > -0.05, `${sunk.toFixed(3)} m`);
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

  // ---- 7. hardcore rules ----
  check('no hitmarker element exists', !document.querySelector('#hitmarker, .hitmarker'));
  check('no kill feed element exists', !document.querySelector('#killfeed, .killfeed, .kill-feed'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) console.warn('failed:', failed.map((f) => f.name));
  return { passed: results.length - failed.length, total: results.length, failed: failed.map((f) => f.name) };
})();
