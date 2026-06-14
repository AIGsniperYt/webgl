# Changelog

> **Style:**
> - `## **DD/MM/YYYY — Title**` — bold header, em-dash separator. Newest entry at top.
> - `**What changed:**` — lead with a short summary. Numbered list with bold items for multi-part changes.
> - **Show code, not line numbers** — use `// before` / `// after` blocks for every change. This is the main format. Keep snippets short and focused.
> - Bugs: problem → cause → fix. Features: show the key before/after.
> - `---` between entries.


## **06/06/2026 — Web Worker Research; Terrain Worker (Disabled by Default); Minimap Removed**

**What changed:** Four related outcomes from investigating Web Workers as a solution for main-thread lag.

### 1. Web Worker viability research

Workers are async math machines — they run JS on a separate OS thread, receive data via `postMessage()`, compute, send results back. No DOM, no Three.js, no canvas, no shared memory allowed, only pure maths. Every main-process in the animation loop was evaluated:

| Process | Worker? | Reason |
|---|---|---|
| Terrain tile generation (`generateTile`) | **YES** | Pure math (50k noise calls/tile), no Three.js dependency. Only clean fit. |
| Physics simulation (`updatePlane`) | No | Three.js Vector3/Quaternion/Mesh throughout. Message latency > computation time. |
| Chunk geometry writes (`addChunkToBucket`) | No | Writes to `BufferGeometry.attributes.position.array` — Three.js internal. |
| Chunk boundary scanning | Partial | Pure arithmetic, but geometry writes (the expensive half) can't leave main thread. |
| Frustum culling | No | `THREE.Frustum.intersectsBox()` — Three.js objects everywhere. |
| Minimap (36k sync lookups) | **No** | Tight sync loop can't await async messages. Stale data, priority inversion, message pileup. |
| Debug overlay / instruments / UI | No | Direct DOM/CSS manipulation. |
| GPU rendering | No | WebGL context required. |

**Key finding:** Workers are a net win for batchable heavy compute (tile generation) but a net loss for tight sync loops (minimap) because:
- **Sync/async mismatch** — animation loop is synchronous, workers return whenever
- **Stale data** — minimap always shows where you *were*, not where you *are*
- **No priority** — urgent `getTile` queues behind a minimap batch in FIFO worker
- **No cancellation** — if aircraft moves during a minimap batch, the result is wasted

### 2. Terrain worker implementation (`src/terrain-worker.js`, `src/terrain.js`)

Created `src/terrain-worker.js` with the full Gustavson simplex noise stack, `generateTile()`, tile LRU cache, and minimap batch API. Modified `src/terrain.js` to support dual-mode operation — default is synchronous (no worker, zero background processes):

```js
// New exports (unused by default)
enableWorker()    // lazily creates the worker
disableWorker()   // terminates worker, returns to sync
isWorkerEnabled() // check mode
updatePrefetch()  // tells worker to pre-generate tiles around position
```

In worker mode, `getHeight()` checks a main-thread sync cache (populated by worker) first. On miss, falls back to inline synchronous generation + async worker request — correct value arrives next frame. The worker is never created unless `enableWorker()` is explicitly called.

### 3. Minimap removed

36,864 synchronous `getTerrainColorAt()` calls every 250ms (~10-15ms frame spikes). In a flight sim the terrain is already visible, just look down obviously. Besides, the minimap area was so small, it had no useful information, showing a small area of biome or maybe a mountain, nothing you can't see by just looking at the screen — the minimap added CPU cost for redundant information. Removed entirely:

- DOM elements (`minimapContainer`, `minimapCanvas`, `minimapReadout`) — deleted
- `drawMinimap()` — deleted  
- `getTerrainColorAt` import — dropped from `main.js`
- `minimapVisible`, `MINIMAP_*` constants — deleted
- `KeyM` toggle handler — deleted
- `terrain-worker.js` still has `getTerrainColorAt` internally for the batch minimap API (unused)

### 4. Worker is *not* wired up — decision rationale

With the minimap gone, `getHeight()` is called once per physics frame for collision detection. At 60fps with the existing 4000-tile LRU cache, the CPU cost of the occasional cache-miss tile generation (~2-8ms) is negligible. The worker would add message-passing latency, sync-cache complexity, and maintenance overhead — smoothing a spike that barely registers. The infrastructure is kept on disk (`enableWorker()`/`disableWorker()`/`updatePrefetch()` available) for future need, but is not wired into the startup path.

### 5. Benchmarking ready

Press `F8` to run the profiler (900 frames, sampled every 60). Output appears in console as CSV-like rows. Paste the full output to analyse frame-time breakdowns (chunk gen, physics, tile cache, memory).


## **05/06/2026 — Aerodynamic Control Authority & Flight Dynamics Overhaul**

**What changed:** Six discrete changes to `src/physics.js`, all based on the committed version. Controls were fully static before — same rate regardless of speed or airflow. Turn energy loss was tied to rotation rate rather than lift force. The velocity vector had no aerodynamic coupling to the nose. All three are now fixed.

1. **`alignmentRate` raised from 2.0 to 4.0** — The velocity-to-nose lerp was already present in the committed code but was too weak at `2.0`. At typical F-16 speeds the velocity vector lagged too far behind the nose, creating a floaty disconnected feel. `4.0` gives tight aerodynamic coupling: pull the nose up, the trajectory follows quickly, which is consistent with how a real fighter is dragged through the air by its own lift.

```js
// before
alignmentRate: 2.0

// after
alignmentRate: 4.0
```

2. **Axis-specific control inertia added to `DEFAULT_CONTROLS`** — The committed code used a single `angBlend = Math.min(1, 8 * dt)` for all three axes. New `pitchInertia`, `yawInertia`, `rollInertia` fields allow each axis to have its own blend rate. The F-16 defaults inherit these and can be overridden per aircraft.

```js
// before: uniform blend, no per-axis inertia
const angBlend = Math.min(1, 8 * dt);
angVel.x += (desiredPitch - angVel.x) * angBlend;
angVel.y += (desiredYaw   - angVel.y) * angBlend;
angVel.z += (desiredRoll  - angVel.z) * angBlend;
```

```js
// after: per-axis inertia-weighted blends
const angBlend = 8;
const pitchBlend = Math.min(1, angBlend * dt / Math.max(0.001, controls.pitchInertia));
const yawBlend   = Math.min(1, angBlend * dt / Math.max(0.001, controls.yawInertia));
const rollBlend  = Math.min(1, angBlend * dt / Math.max(0.001, controls.rollInertia));

angVel.x += (desiredPitch - angVel.x) * pitchBlend;
angVel.y += (desiredYaw   - angVel.y) * yawBlend;
angVel.z += (desiredRoll  - angVel.z) * rollBlend;
```

3. **Dynamic control authority + pre-computed `dynamicPressure`** — The committed code applied `controls.pitchSpeed` etc. directly. Control inputs are now scaled by `authority` (clamped dynamic-pressure ratio), so controls have 15% effectiveness at stall speed and ramp to 100% at cruise. `rho` and `dynamicPressure` are now computed before the rotation block so they're available to scale controls, then reused for the aerodynamic force pass below.

```js
// before: static control rates, rho computed later
const desiredPitch = pitchInput * controls.pitchSpeed;
const desiredRoll  = rollInput  * controls.rollSpeed;
const desiredYaw   = yawInput   * controls.yawSpeed;
```

```js
// after: authority-scaled, dynamic pressure available early
const rho = getAirDensity(plane.position.y);
const dynamicPressure = 0.5 * rho * speed * speed;
const authority = THREE.MathUtils.clamp(dynamicPressure / 5000, 0.15, 1.0);

let desiredPitch = pitchInput * controls.pitchSpeed * authority;
let desiredRoll  = rollInput  * controls.rollSpeed * authority;
let desiredYaw   = yawInput   * controls.yawSpeed * authority;
```

4. **Airflow alignment torque added + dynamic-pressure angular damping** — The committed code had only AoA/sideslip stability corrections. Added a cross-product torque that nudges the nose toward the velocity vector (weak enough to allow sustained high-AoA, strong enough to prevent divergence), plus per-axis dynamic-pressure damping applied before `controls.angularDamping`. Rotation is now applied *after* these corrections so a second AoA/sideslip read using the updated orientation feeds the aerodynamic force pass.

```js
// before: only AoA/sideslip nudge, no cross-product torque, no q-damping
if (speed > 5) {
    if (pitchInput === 0) angVel.x += -aoa * controls.pitchStability * dt;
    if (yawInput === 0) angVel.y += -sideslip * controls.yawStability * dt;
}
angVel.multiplyScalar(Math.max(0, 1 - controls.angularDamping * dt));
plane.rotateX(angVel.x * dt); // rotation before force pass — stale AoA
```

```js
// after: cross-product alignment + q-damping + rotation moved before force pass
if (speed > 5) {
    if (pitchInput === 0) angVel.x += -aoa * controls.pitchStability * dt;
    if (yawInput === 0) angVel.y += -sideslip * controls.yawStability * dt;

    airflowError.copy(velDir).cross(forward).applyQuaternion(inverseQuaternion);
    angVel.x -= airflowError.x * 0.15 * dt;
    angVel.y -= airflowError.y * 0.3  * dt;
    angVel.z -= airflowError.z * 0.1  * dt;
}

const q = dynamicPressure;
angVel.x *= Math.max(0, 1 - q * 0.000001  * dt);
angVel.y *= Math.max(0, 1 - q * 0.0000015 * dt);
angVel.z *= Math.max(0, 1 - q * 0.000002  * dt);
angVel.multiplyScalar(Math.max(0, 1 - controls.angularDamping * dt));

plane.rotateX(angVel.x * dt); // then AoA/sideslip re-read with fresh orientation
```

5. **Lift-induced turn drag replaces rotation-rate drag** — The committed `04/06/2026` model calculated `airflowDrag` from turn rate × speed, nose/velocity misalignment × speed, and lateral G-load × speed. These all penalised rotation itself rather than the G-load generating it. Replaced with a single load-factor formula: extra drag above 1G, proportional to dynamic pressure. A fast barrel roll (low G, high rotation) barely loses speed; a 9G sustained turn bleeds it quickly.

```js
// before: drag from turn rate, misalignment, and lateral G separately
const turnDrag         = turnRate    * speed * AERO_FEEL.turnDragStrength;
const misalignmentDrag = misalignment * speed * AERO_FEEL.misalignmentStrength;
const gDrag            = gLoad       * speed * AERO_FEEL.gDragStrength;
drag.addScaledVector(velDir, -(turnDrag + misalignmentDrag + gDrag));
```

```js
// after: lift-induced drag only — energy cost comes from G, not rotation rate
const loadFactor      = Math.abs(liftForce) / (AIRCRAFT.mass * GRAVITY);
const inducedTurnDrag = Math.max(0, loadFactor - 1) * dynamicPressure * 0.015;
drag.addScaledVector(velDir, -inducedTurnDrag);
```

6. **F-16 preset: control rates and side force slope updated** — `pitchSpeed` / `rollSpeed` / `yawSpeed` raised to match realistic F-16 control authority. `sideForceSlope` raised from `2.4` to `4.0` for more realistic lateral stability.

```js
// before
sideForceSlope: 2.4,
controls: { pitchSpeed: deg(95), rollSpeed: deg(260), yawSpeed: deg(70), ... }

// after
sideForceSlope: 4.0,
controls: { pitchSpeed: deg(140), rollSpeed: deg(320), yawSpeed: deg(90), ... }
```

---


## **04/06/2026 — Airflow Resistance & Turn Feel Upgrade**

**What changed:** The aircraft already had proper lift/drag/thrust/weight forces, but aggressive rotation could still feel too clean: yank the stick, rotate the nose, and the aircraft did not always feel like it was chewing through air. Added an airflow resistance layer on top of the existing model so tight turns, sideways velocity, and high-G banking bleed energy while the velocity vector eases toward the nose instead of snapping there for free.

1. **Turn, misalignment, and G drag** — extra airflow drag now stacks onto the existing drag vector, always opposite `velDir`. Turn rate punishes hard rotation, nose/velocity misalignment punishes sliding, and lateral lift adds a high-G cost.

```js
// before: only coefficient drag and airbrakes pushed against velocity
drag.copy(velDir).multiplyScalar(-(dragForce + airbrakeDrag));

// after: airflow drag stacks on the same velocity axis
const turnDrag = turnRate * speed * AERO_FEEL.turnDragStrength;
const misalignmentDrag = misalignment * speed * AERO_FEEL.misalignmentStrength;
const gDrag = gLoad * speed * AERO_FEEL.gDragStrength;
drag.addScaledVector(velDir, -(turnDrag + misalignmentDrag + gDrag));
```

2. **High AoA drag bites harder** — flares and aggressive pitch now multiply high-AoA drag by the angle magnitude, so pulling hard at speed costs noticeably more energy.

```js
// before: high AoA drag rose with sin^2 only
const highAoACd = AIRCRAFT.highAoADrag * Math.sin(aoa) * Math.sin(aoa);

// after: high AoA drag gets stronger as AoA grows
const highAoACd = AIRCRAFT.highAoADrag
    * Math.pow(Math.sin(aoa), 2)
    * (1 + 4 * Math.abs(aoa));
```

3. **Velocity alignment lag** — after force integration, velocity now blends toward the aircraft's forward axis at a controlled rate. The plane can still carve into turns, but the movement vector has inertia and the blend itself bleeds energy when nose and velocity disagree.

```js
// before: integrate velocity, then move immediately
velocity.addScaledVector(acceleration, dt);
plane.position.addScaledVector(velocity, dt);

// after: integrate, then let velocity gradually bite toward the nose
velocity.addScaledVector(acceleration, dt);
desiredVelocity.copy(forward).multiplyScalar(postAccelerationSpeed);
velocity.lerp(desiredVelocity, Math.min(1, dt * AERO_FEEL.alignmentRate));
plane.position.addScaledVector(velocity, dt);
```

Debug state now also exposes `airflowDrag`, `turnDrag`, `misalignmentDrag`, and `gDrag`, and the drag formula log includes the airflow breakdown so the new turn-feel costs are visible while tuning.

---

## **02/06/2026 — Artificial Horizon: Full Wraparound Pitch Tape**

**What changed:** The artificial horizon used to max out at ±30° visually: the ladder only had `10/20/30` marks and the pitch translation clamped at ±95px, so loops and steep climbs gave you no extra information once you went past the small normal-flight range. Rebuilt it as a cyclic 360° pitch tape so the sky/ground band wraps back around on itself through vertical, inverted, and back upright again.

1. **Full come-around ladder** — pitch marks now repeat across multiple 360° cycles, with larger 0/90/180 cardinal references and readable 30° labels. The gradient itself repeats too, so the horizon line always has matching sky/ground context.

```js
// before: fixed narrow ladder
[-30, -20, -10, 10, 20, 30].forEach((pitchMark) => {
    mark.style.top = `${200 - pitchMark * 3}px`;
});

// after: repeated 360-degree pitch tape
for (let pitchMark = -720; pitchMark <= 720; pitchMark += 10) {
    const cyclicPitch = ((pitchMark % PITCH_CYCLE_DEG) + PITCH_CYCLE_DEG) % PITCH_CYCLE_DEG;
    mark.style.top = `${HORIZON_CENTER - pitchMark * PITCH_PX_PER_DEG}px`;
}
```

2. **No more pitch end-stop** — removed the ±95px clamp. The instrument now derives a wrapped attitude angle from the plane quaternion, so pulling through vertical keeps moving smoothly instead of pinning the display.

```js
// before: clamps once pitch exceeds the visible range
const pitchDeg = THREE.MathUtils.radToDeg(flight.pitch);
const pitchOffset = THREE.MathUtils.clamp(pitchDeg * 3, -95, 95);

// after: wraps continuously through the full loop
const pitchDeg = THREE.MathUtils.radToDeg(Math.atan2(instrumentForward.y, instrumentUp.y));
const wrappedPitchDeg = wrapSignedDegrees(pitchDeg);
const pitchOffset = wrappedPitchDeg * PITCH_PX_PER_DEG;
```

3. **Readable numbers while inverted** — labels now counter-rotate against the horizon band, so flipping from sky to ground no longer turns the pitch numbers upside down.

```js
// horizon rolls with bank
horizonBand.style.transform = `translateY(${pitchOffset}px) rotate(${-bankDeg}deg)`;

// labels cancel that roll so text stays readable
instrumentPitchLabels.forEach((label) => {
    label.style.transform = `rotate(${bankDeg}deg)`;
});
```

Also added a small bank reference ring and heading readout (`HDG`) to make the instrument useful when the aircraft is steep, inverted, or generally doing crimes against passenger comfort.

---

## **02/06/2026 — Frustum Culling: Steep Mountain Chunks Culled On-Screen**

**What changed:** Far/ultra/horizon LOD height ranges still assumed the old quantized heights (max 400/100/25m). After precision-height removal, all LODs render full terrain (up to ~1500m on peaks), but the frustum test used tight per-LOD ranges — a distant mountain chunk at 800m+ had its bounding box max at 400m (far) or 100m (ultra), so the frustum test failed and the chunk was hidden while clearly on screen.

**Fix:** All LOD height ranges widened to cover full terrain height (1500m). No per-chunk computation needed — just a constant change.

```js
// before: per-LOD ranges from the quantization era
near:  { min: -10, max: 1000 },
mid:   { min: -5,  max: 800 },
far:   { min: -2,  max: 400 },
ultra: { min: -1,  max: 100 },
horizon: { min: -1, max: 25 },

// after: all LODs cover full terrain height
near:  { min: -10, max: 1500 },
mid:   { min: -5,  max: 1500 },
far:   { min: -2,  max: 1500 },
ultra: { min: -1,  max: 1500 },
horizon: { min: -1, max: 1500 },
```

---

## **02/06/2026 — Landing Condition Readout (Debug Scaffolding)**

**What changed:** Landings were extremely difficult, and both me and my friend kept crashing for two hours straight tryna land the damn plane, but failed. So to investigate: added a `READY TO LAND ✓` / `NO LAND ...` indicator in the debug panel that shows exactly which crash conditions are failing (PITCH, BANK, V/S, SPD). Exposes `pitchOk`, `bankOk`, `descOk`, `speedOk`, and `canLand` on `flightState` so the reason for any failed landing is visible in real-time.

```js
// Landing indicator shown between Flight Path and AoA
${flight.canLand ? 'READY TO LAND ✓' : 'NO LAND' +
  (!flight.pitchOk ? ' PITCH' : '') +
  (!flight.bankOk ? ' BANK' : '') +
  (!flight.descOk ? ' V/S' : '') +
  (!flight.speedOk ? ' SPD' : '')}
```

---

## **02/06/2026 — Lowland Rolling Hills (Smooth Landable Terrain)**

**What changed:** Lowlands were a bumpy mess of high-frequency noise (±6m over 50–150m periods) — impossible to land on. Replaced with two changes:

1. **Suppressed high-frequency noise in lowlands** — base and hill octaves scaled to 2% amplitude below profile 40m, so the tight bumpiness vanishes.

2. **Added broad rolling hill layer** — a low-frequency noise octave (scale 0.003, period ~670m, ±8m amplitude) creates gentle swells only in lowlands, fading out as elevation rises. These roll smoothly enough to land on, with lakes naturally filling the depressions below 8m.

```js
// before: tight bumpy noise at all elevations
float base = snoise(warpPos * baseScale) * heightScale * flatnessFactor;
float hill = snoise(warpPos * hillScale) * heightScale * hillHeightMultiplier;
float preDetail = profile + base + hill + mountain;

// after: suppressed high-freq + broad rolling hills in lowlands
float elevationSmooth = min(1.0, profile / 40.0);
float lowlandSmooth = 0.02 + 0.98 * elevationSmooth;
float base = snoise(warpPos * baseScale) * heightScale * flatnessFactor * lowlandSmooth;
float hill = snoise(warpPos * hillScale) * heightScale * hillHeightMultiplier * lowlandSmooth;
float rollingHill = snoise(warpPos * 0.003) * 8.0 * (1.0 - elevationSmooth);
float preDetail = profile + base + hill + mountain + rollingHill;
```

---

## **02/06/2026 — AGL Altitude Display + Aircraft Switch Crash Fix**

**What changed:** Two fixes:

1. **AGL altitude in debug stats** — The debug panel showed only absolute altitude (`plane.position.y`), making flat-looking 70m terrain appear as 70m of clearance. Added an AGL (Above Ground Level) reading via `getHeightScaled()`.

```js
// before: only absolute altitude
Altitude: ${fmt(plane.position.y, 1)} m

// after: absolute + AGL
Altitude: ${fmt(plane.position.y, 1)} m &nbsp; AGL ${fmt(plane.position.y - getHeightScaled(plane.position.x, plane.position.z, 1.0), 1)} m
```

2. **Aircraft switch no longer spawns underground** — Switching from F-16 to Cessna 172 mid-flight (P key) teleported the plane to `(0, 120, 0)` without checking terrain height. If the terrain at the origin exceeded 120m, the plane spawned underground and crashed instantly.

```js
// before: fixed spawn altitude, no terrain check
plane.position.set(0, AIRCRAFT.initialAltitude, 0);

// after: clamped above terrain
plane.position.set(0, AIRCRAFT.initialAltitude, 0);
const terrainY = getHeightScaled(plane.position.x, plane.position.z, 1.0);
plane.position.y = Math.max(plane.position.y, terrainY + 20);
```

---

## **29/05/2026 — Housekeeping: .md docs refactored into `docs/`, devlog tracker created**

**What changed:** The root directory was accumulating standalone `.md` files. All documentation (bug analysis, physics notes, specs, reports, solutions, terrain docs, performance comparisons) now lives under `docs/`. Root keeps only `README.md`, `changelog.md`, `benchmark.md`, `devlogs.md`, and `LICENSE`.

- Created `devlogs.md` — a commit-by-commit tracker with coverage status and notes, organised by theme (Optimisation, Physics, Terrain, etc.), ready for devlog planning.
- All cross-references in `changelog.md` updated to point to the new `docs/` paths.

---

## **30/05/2026 — Freecam Mode (C key)**

**What changed:** Press C to detach the camera from the plane and fly around freely, Roblox-style. Plane **freezes in place** when you enter freecam — press **R** to release it and watch it fly like a remote-controlled drone.

- **Movement:** WASD moves camera position relative to view direction, E/Q moves up/down. Base speed 80 units/sec.
- **Scroll to zoom:** Scrolling in freecam adjusts a speed multiplier (×0.1 to ×50, shown in debug panel). Scroll up to race across the terrain faster, scroll down to creep slowly.
- **Mouse look:** Click and drag rotates camera view (yaw/pitch), not an orbit — true first-person-style freecam.
- **Plane frozen on entry:** Entering freecam freezes the plane mid-air — position locked, velocity zeroed, controls suspended. Display shows `✈FROZEN`.
- **Release with R:** Press R to unfreeze the plane. Controls return to the plane, it resumes flying. Camera **locks in place** — WASDQE, mouse look, and scroll are all disabled. Watch it zoom past like a stationary RC drone spectator. Display shows `✈FREE LOCKED`.
- **Reattach:** Press C again to snap back to chase cam behind the plane. If the plane was frozen, it's unfrozen automatically.
- **Transitions naturally:** If you're in orbit mode (mouse click), pressing C enters freecam instead. Coming back from freecam always returns to chase.

**Files:** `main.js` (enterFreecam/exitFreecam, updateOrbitCamera, mouse drag + key tracking, R key handler), `physics.js` (setFrozen, setSuppressFlightInputs).

---

## **28/05/2026 — Water: Lakes in the 0m Lowland Basins**

**What changed:** The rare 0m lowland basins (~7–10% of terrain) now fill with water. A `waterLevel` is checked in the fragment shader — any terrain below this renders as lake blue.

- Initially set to 5m, but the base+hill+detail noise pushed scattered land above the surface, creating a boggy look. Raised to **8m** — the noise rarely reaches +8m across all three octaves simultaneously (~1% chance), so basins are consistently submerged with only the most extreme peaks poking out as rare islands.
- These lakes are naturally expansive because the 0m lowland tier was designed to be geographically coherent — each basin is a distinct region, not scattered puddles.
- The water is purely a visual fragment-shader effect for now (no physics, no reflections, no transparency). The plane flies straight through it.

This is a temporary placeholder addition because I got bored and didn't know what to do next

**Files:** `world.js` (fragment shader), `terrain.js` (getTerrainColorAt).

---

## **28/05/2026 — Biome Terrain Modifiers: Dunes, Tundra, and Expansive Regions**

**What changed:** Biomes now shape the ground itself, not just colour the surface. Three additions:

1. **Expansive biome field** — a new noise layer at 0.0001 (period ~20000 units, ~100s flyover time) classifies each point into a biome region. A single biome fills most of the visible horizon (5000 units) — you fly into a biome and stay in it, rather than everything mingling on screen. This was initially 0.0004 (period 5000 units, biomes changing every ~12 seconds) which made desert, forest, and mountains all visible at once. Open expanse was the fix.

2. **Desert dunes** — in low-elevation dry regions, `abs(snoise)` produces asymmetric wind-blown dune shapes. Three octaves (0.003 broad swell, 0.006 primary ridges, 0.012 secondary ripples) stack to create a dune field up to ~55m tall stretching across the desert expanse. Mountain mask is reduced by 80% in deserts — flat sand seas shouldn't have peaks.

3. **Tundra ruggedness** — at elevations above 300m, extra ridged noise (0.005, 0.012) carves rugged alpine terrain with sharp rock ridges. These highland regions now feel massive and alpine, hard to cross, abundant with snow at the peaks.

**Colour system updated:** The low-elevation colour palette is now a 3-way blend driven by the biome field: sandy desert, grassland, and rainforest. Within each palette, moisture still provides fine-grained variation (sand→savanna, dry grass→rainforest, etc.).

**Post-fix: 0m lowland basins no longer show desert patches.** The rare lowland basins (future lake beds) were getting the desert palette where biomeField happened to be dry, creating random sand patches in the grass. Fixed by gating the desert palette and dune terrain modifier below 20m elevation — the 0m tier always uses grassland colour and gets no dunes. Now those basins look like grassy depressions, which is both more natural and ready for a future water system.

**Files:** `world.js` (computeHeight, vertex/fragment shader), `terrain.js` (generateTile, getTerrainColorAt).

---

## **28/05/2026 — Height Profile Refinement: Exponential Tapering + Sigmoid Transitions**

**What changed:** Two rounds of tuning after flying the initial height profile:

1. **Exponential tapering** — transition widths now shrink with height (0.30 → 0.20 → 0.15 → 0.07). Lower tiers roll gently; only the top tier is dramatically sharp. This fixed grass-covered cliffs at 200m and 400m that looked like bugs, and made mountain bases feel like real foothills instead of random raised plateaus.

2. **Sigmoid instead of smoothstep** — replaced the cubic Hermite `smoothstep` with a logistic sigmoid for all profile transitions. The sigmoid approaches 0 and 1 asymptotically instead of reaching them exactly at the edges, which means the ground begins its ascent more gradually and settles back into the next plateau more gently. This reduces the "hard band" look where plateau edges visibly start sloping at a clean line.

**Emergent result:** The transition zones between plateaus now form natural mountain-access paths — continuous ramp-like features that look eroded rather than generated. You can follow a streambed from a 200m plateau up a mountain ridge.

**Remaining:** Rare grass cliffs still occur where a sharp transition lands in a dry biome zone (slope right at the ~30° cusp of the rock override). The sigmoid helps slightly by softening the band edges, but this is ultimately a slope-override precision limit — acceptable for now.

---

## **28/05/2026 — Height Profile: Plateau/Terrace Elevation System**

**The problem:** The terrain was generated on a flat base plane — everything started from height 0 and noise was stacked on top. This made the world feel like an endless rumpled blanket: no elevation hierarchy, no levels, just smooth bumps everywhere regardless of where you were. Flying at 200m felt the same as flying at 500m because the terrain underneath was just "more noise." Biome colouring tried to add variety, but colour is just paint — the shape underneath was still flat.

**The fix:** Replace the continent octave (a ±40m noise wobble that was too weak to create any real structure) with a height profile — a staircase function applied to a broad noise field that carves the terrain into 5 distinct elevation tiers:

| Shaping field | Elevation tier | Transition style |
|---|---|---|
| < −0.7 | 0m lowlands (rare — ~7–10% of land) | — |
| −0.4 to −0.1 | 80m mid plateau | Gentle, width 0.3 |
| 0.1 to 0.35 | 200m upper plateau | Moderate, width 0.2 |
| 0.5 to 0.65 | 400m high plateau | Soft, width 0.15 |
| > 0.7 | 600m platform | Dramatic, width 0.05 |

**Why exponential transition widths:** Transition widths decrease with height (0.3 → 0.2 → 0.15 → 0.05) because that's how real terrain works — lower slopes weather into gentle rolling hills, while only the highest tier retains the raw sharpness of tectonic uplift. A sharp 50m cliff in the middle of a grassland looks like a bug, not a feature; at 600m it looks like a mountain escarpment. The 200→400m tier was also slightly too sharp for the grass bands, so it was widened from 0.1 to 0.15.

**Why the 0m lowland tier is rare:** It's the bottom ~15% of the noise field, which in practice means ~7–10% of actual land area. These infrequent basins are the natural place for bodies of water — a separate lake system can slot in later without needing oceans.

**What else changed:** The mountain mask second condition switched from `smoothstep(-10, 20, continent)` (checking against a weak ±40m noise signal) to `smoothstep(50, 200, profile)` (checking actual base elevation). Mountains now only grow on terrain that's already elevated by the profile, which is exactly what you'd expect — no more lone mountain peaks rising out of perfectly flat lowlands.

**Bug fix discovered along the way:** The JS path (`terrain.js`) was still using the old original mountain mask thresholds (`smoothstep(0.1, 0.4, mountainRegion)` × `smoothstep(0, 25, continent)`) while the GLSL path had been updated to the agent-rewritten thresholds (`smoothstep(-0.2, 0.3, mountainRegion)` × `smoothstep(-10, 20, continent)`). CPU and GPU disagreed on where mountains should be. Both now use identical values.

**Files:** `world.js` (computeHeight), `terrain.js` (generateTile).

---

## **28/05/2026 — Fix: Frustum Culling Bottom-Edge Clipping**

**Change:** Fixed over-aggressive frustum culling at the bottom of the screen when flying over mountains.

**Root cause:** The frustum re-evaluation loop (`updateChunks`, line 567) used hardcoded Y bounds of `[-200, 200]` for every chunk's AABB regardless of LOD. Mountains reach 800m+, so directly below the camera at altitude the AABB sat entirely below the view frustum, causing `frustum.intersectsBox()` to return false. The chunk was hidden while still clearly on screen.

**Fix:** Replaced `_frustumBBox` Y bounds with `LOD_HEIGHT_RANGES[entry.lod]` (range.min / range.max). Near/mid chunks now use [−10, 1000] / [−5, 800] — wide enough to always intersect with the frustum when the terrain is visible. Far/ultra/horizon chunks retain their tighter bounds for proper occlusion behind the camera.

**Files:** `world.js` (line 567-568).

---

## **28/05/2026 — Biome System (Moisture × Elevation Colormap)**

**Change:** Replaced the 4-band elevation-only colouring with a 2D biome system that varies terrain colour by moisture and slope:

- **Moisture field:** New `moistureScale` uniform (0.002, period ~3141 units). Single snoise evaluation per vertex, remapped to [0,1]. Climate zones vary within visible range for biome diversity when flying.
- **6 visual biomes** blending along elevation × moisture axes:

  | Elevation | Dry (moisture→0) | → | Wet (moisture→1) |
  |---|---|---|---|
  | Low (0-80m) | Dry grassland → | → | Rainforest green |
  | Mid (80-300m) | Olive shrubland → | → | Temperate forest |
  | High (300-500m) | Tundra (fixed) | — | Tundra |
  | 500m+ | Snow | — | Snow |

- **Slope-aware rock override:** World position passed as varying, slope computed via `dFdx`/`dFdy` cross-product in fragment shader. Slopes >30° blend toward rock colour, over 50° fully rock.
- **Mountain mask widened:** Changed from `smoothstep(0.1, 0.4, mountainRegion)` to `smoothstep(-0.2, 0.3, mountainRegion)` and continent threshold from `smoothstep(0.0, 25.0, continent)` to `smoothstep(-10.0, 20.0, continent)`. Mountains now cover ~40% of terrain instead of ~10%.
- **Removed pure desert sand colour** — replaced with dry grassland (warm tan-green `#9a9a5a`) for the extreme dry end. Eliminates the "everything is desert" look at moderate moisture values. Low band now uses 2-way blend instead of 3-way.
- **CPU path:** Same logic for minimap, minus slope detection.

**Biome walkthrough (how it all fits together):**

The final colour for each fragment is computed in five steps:

1. **Moisture** — Vertex shader samples `snoise(rawPos × 0.002)` (same snoise as the height stack, own frequency), remaps `[-1,1]` → `[0,1]`. No domain warp, so climate zones are stable.

2. **Slope** — Fragment shader derives face normal from `dFdx(vWorldPos) × dFdy(vWorldPos)`. `n.y` gives slope → `smoothstep(30°, 50°)` = `rockMix` (0 on flat, 1 on cliffs).

3. **Elevation bands** — Three `smoothstep` transitions climb the height bands (80m, 300m, 500m thresholds).

4. **Per-band colour** — Low: `mix(dryGrass #9a9a5a, rainforest #2d6b1e, moisture)`. Mid: `mix(shrubland #7a8032, forest #3a7d34, moisture)`. High: fixed tundra `#8a9a8a`.

5. **Layer** — `mix(lowColour, midColour, t1)` → `mix(that, highColour, t2)` → `mix(that, snow, t3)` → `mix(that, rock, rockMix)` where:

   | Factor | `smoothstep` range | What it blends |
   |---|---|---|
   | `t1` | 80–150m | lowColour → midColour |
   | `t2` | 300–500m | mid → highColour |
   | `t3` | 500–650m | highColour → snow |

**Elevation picks the band, moisture picks where within the band, slope overrides to rock on steep faces.**

**Files:** `world.js` (vertex/fragment shader), `terrain.js` (getTerrainColorAt, getColorComponents).

G-force visuals were annoying, so toggle functionality was added, and they were disabled until I improved the physics engine later in an overhaul.

---

## **27/05/2026 — G-Force Calculation + Visual Overlay**

**Change:** Added G-force tracking and visual effects to the flight system:

- **G-force calculation:** `rawG = |acceleration| / 9.81 + 1.0` computed every physics frame from the total acceleration vector. Smoothed with a low-pass filter (8/s blend factor) to prevent jitter. Exposed as `flightState.gForce`.
- **Debug overlay:** G-Force value shown in the Flight State section with a red "!! PULLING G !!" warning when exceeding 5G.
- **Visual overlay:** A full-screen `div` with `pointer-events: none` applies vignette and tunnel vision effects:
  - 0–4G: No effect (normal flight envelope)
  - 4–6G: Edges darken (grey-out begins), mild vignette
  - 6–9G: Tunnel vision narrows progressively, vision darkens toward blackout
  - 9G+: Near-total blackout (tiny central tunnel, very dark)
  - Negative G (push-over, gForce < 0.8): Red-tinted vignette simulating red-out (blood rush to head)
- Effects use `box-shadow: inset` for the vignette ring and `radial-gradient` for the shrinking tunnel. Updated every frame with smooth CSS transitions.

Also, I had failed in an attempt to make crash logic more consistent, as there were still scenarios which should be a crash, but did not crash the plane - for example I could slide along the ground on the nose of the plane - I suspect its because collisions are center of plane compared with heightmap value, so technically the nose could keep the center up above the ground and therefore avoid collisions until a bump crashed it.

---

## **26/05/2026 — Mountain Transition Smoothing (Power Curves)**

**Change:** Applied a squaring curve to the mountain base noise in both the GLSL shader (`world.js`) and the CPU terrain helper (`terrain.js`):
- `mountainBase = max(0.0, snoise(...))^2 * 800.0 * mountainMask`.

**Why:** The previous linear noise clipping caused mountains to rise from the plains with an abrupt, non-zero slope, creating awkward step-like bumps at the bases of ranges. Squaring the positive noise ensures the slope is exactly `0.0` at the boundary, allowing mountains to start perfectly flat and parallel to the grassy plains, before gently curving upwards.

---

## **26/05/2026 — Balanced Terrain Color Bands & Jagged Alpine Peaks**

**Change:** Refined mountain geometry and coloring rules in `world.js` and `terrain.js`:
- **Jagged Peak Detail:** Blended high-frequency, high-amplitude `ridgedNoise` octaves exclusively at high elevations using a `peakMask` (`smoothstep(150.0, 500.0, mountainBase)`). This preserves the bulky earth/rock bases of mountains while carving highly realistic, razor-sharp alpine summits at the tops.
- **Realistic Coloring Bands:** Scaled color thresholds to match the new `800m` mountain altitudes:
  - Lush Valley Grass: up to `80m`, keeping valleys completely green and eliminating flatland brown patches.
  - Hillside Dirt: transitions from `80m` to `150m`.
  - Mountain Rock: slate-grey transitions from `150m` to `300m`.
  - Alpine Snow: transitions from `500m` to `650m`, ensuring low-lying mountains remain rocky and snow-free.

**Why:** Colors were previously thresholded too low, turning all rising land brown and all hills/mountains into white monoliths of snow. Additionally, mountain shapes lacked structural contrast between bulky bases and sharp crests.

---

## **26/05/2026 — Anisotropic Ridge Stretching Eliminates Coiling/Snaking Mountains**

**Change:** Ridged noise for the mountain octave now uses anisotropic coordinate stretching with a slowly-varying direction field. A new `ridgeScale` uniform (0.0003) provides a very broad angle field that rotates the ridge orientation over large regions. The noise coordinates are rotated into a ridge-aligned frame and compressed 3.3× along the strike direction (`* 0.3`), creating mountain ranges that are linear over tens of kilometres with a consistent directional bias instead of coiling and snaking arbitrarily.

**Why:** The previous domain warp bent ridges in all directions equally, creating twisty unrealistic mountain patterns. Real mountain ranges have a dominant strike direction from tectonic compression that's consistent over large regions. The anisotropic stretch models this without simulating tectonics — just a coordinate transform in the noise sampling.

Applied identically to GLSL and JS paths.

---

## **26/05/2026 — Snoise Gradient Fix: Independent X/Y Gradients Eliminate Axis Artifacts**

**The problem:** The Gustavson noise implementation assigns a random gradient vector to each grid cell, but the Y component was derived from the X component (`gy = |gx| - 0.5`). This made the Y component always *smaller* on average than the X component, so gradient vectors statistically pointed more in X than in Y. Across the whole noise field, this created slightly more rapid variation in X and slightly stretched features in Z. The ridged noise (`1 - |noise|`) amplified this subtle bias into visible Z-direction ridge lines.

**The fix:** Each grid cell now gets two fully independent random numbers for the gradient vector (offset by `+0.5` in the fract lookup). Both components are symmetrically corrected to `[-0.5, 0.5]` with `floor(g + 0.5)`. The gradient distribution is now truly isotropic — no preferred axis.

Applied identically to GLSL (`world.js`) and JS (`terrain.js`). Domain warp offset also changed to `vec2(5.2, 1.3)` for better noise field decorrelation.

---

## **26/05/2026 — Phase 3: Continent-Masked Mountains + Elevation-Scaled Detail**

**Change:** Two structural improvements from studying `test.html` (single-mountain example):

- **Continent as mountain mask:** Ridged noise amplitude is now scaled by `smoothstep(-15, 25, continent)`. Low-continent regions (−40 to −15) are flat plains with no mountains. The transition band (−15 to 25) produces rolling hills. High-continent regions (25 to 40) host full mountain ranges with sharp ridged noise. Mountains now cluster into distinct ranges instead of appearing uniformly everywhere.

- **Elevation-scaled detail:** The detail octave (±1m at scale 0.3) is now scaled by `clamp(height / 60, 0, 1)`. Valley floors get zero detail (smooth), peaks get full detail (jagged). This matches the real-world pattern where erosion textures are more pronounced at higher elevations.

GPU and CPU paths updated identically. Added `smoothstep` helper to terrain.js.

---

## **26/05/2026 — LOD Height Quantization Removed (Full-Precision Heights at All LODs)**

**Change:** Removed `floor(h * lodScale)` from the vertex shader. All 5 LODs now compute terrain height at full floating-point precision. The `lodScale` uniform and its 0.001× multiplier for horizon LOD (which snapped heights to 1000m steps) are gone. Geometric LOD (chunk step size) remains — horizon still uses 50m between vertices — but every vertex sits at its correct mountain height.

**Why:** The horizon LOD was producing zero vertical relief — a flat plane at the colour band edges. Faraway mountain silhouettes are now visible because the 4-vertex horizon chunks render at true heights instead of being quantised into oblivion.

**Benchmark:** Cruise 55.0 avgFPS / 165.33ms gen / 40803 chunks / 107.3MB — vs pre-change cruise 77.9fps / 176.95ms gen / 40803 chunks / 103.2MB. FPS dropped ~29%; gen time actually *decreased* 7% (no more `floor` multiply + uniform read). The FPS hit is purely GPU-side: horizon chunks formerly rendered as nearly edge-on flat strips (most triangles back-face culled or sub-pixel), now they stand at full mountain height, every fragment facing the camera and causing overdraw with mid/ultra LOD overlap. CPU gen time unchanged, physics unchanged. Acceptable trade for infinite-horizon mountain silhouettes.

---

## **26/05/2026 — Phase 2: Terrain Noise Replaced (Continent + Ridged + Domain Warp + Detail)**

**Change:** Replaced the three-octave noise stack with a five-octave system that produces actual geography:

- **Continent** (scale=0.0005, ±40m): Broad basin-and-range elevation. Creates distinct regions — high plateaus, low valleys — instead of uniform bumpiness.
- **Domain warp** (scale=0.002, shift=100m): Feeds noise-shifted coordinates into all subsequent octaves. Ridges and valleys flow organically instead of stretching like perlin blobs.
- **Base** (scale=0.02, ±4m): Fine undulation, same as before but warped.
- **Hill** (scale=0.04, ±2m): Small hills, same as before but warped.
- **Mountain** (scale=0.003, 0–80m): Replaced `max(0, noise)` with `ridgedNoise(p) = (1.0 - abs(noise))²`. Sharp V-shaped valleys and knife-edge ridges instead of smooth round bumps.
- **Detail** (scale=0.3, ±1m): High-frequency texture breaking up the plastic look.

GPU and CPU noise paths updated identically (`terrain.js` + `world.js`). `getHeightScaled` no longer floors (full-precision collision height). Removed unused `lodScale` and `snowLevel` uniforms. ComputeHeight signature changed — added `continentScale` and `warpScale` parameters.

---

## **26/05/2026 — Terrain Vertex Colouring: Green→Brown→Grey→Snow**

**Change:** Replaced the old hard-band grey gradient with smooth four-stage terrain colouring via `smoothstep` in the fragment shader. Low grass green (0–4m) blends to brown earth (4–18m), then grey rock (18–35m), then snow white (35m+). No textures, no CPU cost — pure shader math on the existing `vHeight` varying.

**Why:** The previous grey-brown gradient was visually flat — essentially grey terrain with faint green lowlands and white peaks. Rich earthy tones (browns, warm greys) make the terrain look like actual terrain instead of a heightmap visualisation.

---

## **26/05/2026 — Crash Logic Emergent Behavior: Slope Landings Fail Without Slope Checks**

**Cool Interesting Observation:** The three crash triggers (attitude ±15°, vertical speed < -8 m/s, overspeed) naturally prevent slope landings without any terrain-normal sampling. Approaching a slope requires maneuvring (pitch/bank changes) that pushes attitude outside ±15° at contact. Even a perfectly flat approach into a hillside causes the rising terrain to spike `impactSpeed` (overspeed) or produce a negative `velocity.y` as the ground rushes up (hardDesc). The safety net is emergent — none of the checks know about terrain angle, but together they approximate it. Post-landing bumps remain an issue (overspeed trips on horizontal rolling speed into a molehill); deferred to proper terrain-normal-based landing logic.

---

## **26/05/2026 — Throttle Moved to Arrow Keys**

**Change:** Throttle up/down moved from Shift/Ctrl to ArrowUp/ArrowDown. Ctrl is now free for future bindings. Prevents accidental OS shortcut triggers (Ctrl+S, Ctrl+F, etc. already blocked at the document keydown level).

**Why:** Shift and Ctrl overlap with browser shortcuts and modifier-key edge cases. Arrow keys are dedicated, unambiguous, and already prevented from scrolling the page.

---

## **26/05/2026 — Airbrakes (Spacebar)**

**Change:** Hold Spacebar to deploy airbrakes. Adds `q * AIRBRAKE_AREA * 1.0` drag force opposing velocity (flat-plate drag model, `AIRBRAKE_AREA = 2.0`). Doubles total drag at typical approach speeds. Visual indicator in debug panel. Flight state exposes `airbrakes` bool and `airbrakeDrag` force.

**Why:** Needed for controlled landing approaches — allows speed bleed without zero-throttle coasting. Spacebar was already unused and prevented from scrolling.

---

## **26/05/2026 — Crash Logic: From Speed-Only to Orientation + Vertical Speed**

**Change (v1 — speed-only):** Placeholder. If `impactSpeed >= crashSpeed`, you die. Fast = dead, simple. But direction matters — a slow plane falling on its tail should not survive.

**Change (v2 — orientation check):** Added pitch ±15° and bank ±15° margins. If not belly-down flat at ground contact — nose-in, tail-strike, wing-strike — you crash regardless of speed. A level contact lands safely. This felt right... until I learned how to clutch: nose up hard at the last second, level the wings, and survive a 40 m/s vertical slam into the terrain.

**Change (v3 — vertical speed):** Added `velocity.y < -8 m/s` as a third trigger. You cannot flare your way out of a 1600 ft/min descent. Stall-spin pancake, steep approach, uncontrolled drop — caught.

**Change (v4 — overspeed):** Re-added `impactSpeed >= crashSpeed` per-aircraft threshold. Even perfectly level with a gentle descent, landing at 300 knots tears the gear off. Keeps the original placeholder intent — fast ground contact is destructive regardless of composure.

**Final logic:** To survive ground contact, all three must pass: belly-down flat attitude, gentle descent rate, and speed below the aircraft's structural limit.

**Why:** A slow plane falling on its tail should not survive. Speed alone was a naive proxy — direction and descent speed determine whether ground contact is a landing or a crash.

---

## **26/05/2026 — Stall Warning + Pulse/Jitter Visual Indicator**

**Change:** Added a stall warning HUD element that appears when `flightState.stalled` is true. Three-line layout (`AIRSPEED LOW` / `STALL CONDITION` / `RECOVER IMMEDIATELY`) with a pulsed jitter effect that ramps urgency over the first 1.2s. Uses `performance.now()`-based sine modulation for opacity, jitter, scale, border glow, and text color. Hidden on crash recovery.

**Why:** Binary blinking felt like a UI toy, not a flight computer. The steady clinical label with aggressive subtext and physical jitter feels more like an aircraft system.

need to improve later

---

## **26/05/2026 — Horizon LOD: Render Distance Doubled Again (50→100 chunks, 2500→5000 world units)**

**Change:** Added 5th LOD level "horizon" extending render distance from 50 chunks (2500 world units) to 100 chunks (5000 world units). Edge fog blend improves from 71% (was visible) to 92% (near-invisible). At high altitude, the hard square edge is gone — terrain fades naturally into atmospheric haze.

**Why:** At altitudes above 500m, the left/right edges of the loaded square were clearly visible at 2500m — the world felt like a "following square heightmap mesh." The ultra LOD (step=25) was too fine to extend further without massive memory cost. A coarser LOD was needed.

**LOD table:**

| LOD | Step | Verts/Chunk | Scale | Render Distance | Max Chunks |
|---|---|---|---|---|---|
| near | 1 | 50×50 = 2500 | 1.0 | 5 | 250 |
| mid | 5 | 10×10 = 100 | 0.5 | 12 | 700 |
| far | 10 | 5×5 = 25 | 0.1 | 25 | 2400 |
| ultra | 25 | 3×3 = 9 | 0.02 | 50 | 8700 |
| **horizon** | **50** | **2×2 = 4** | **0.001** | **100** | **32000** |

**Memory impact:** Horizon LOD adds only ~2.3MB for vertex buffers (4 verts/chunk × 32000 slots × 12 bytes/vert + index buffer). Peak memory at 40803 chunks: 103.2MB (was 79.4MB without horizon). That's +30% memory for 4× more chunks — the most memory-efficient LOD yet.

**Performance:**
- Gen time: 176.95ms/sample cruise (was 50.81ms) — proportional to the 3.8× increase in scanned positions (11025 → 42025)
- avgFPS: 77.9 cruise (was 64.9) — gen-time-heavy crossing frames dip to ~20 FPS, smooth frames hit 100+ FPS
- Frustum re-eval now iterates 40803 entries → ~0.7ms per rotation event (was ~0.2ms at 10609)

Now it feels a LOT more like an infinite horizon, rather than a following square heightmap mesh

I also realised that I havent implemented any form of asynchronous processing, and that this is a POWERFUL ace card I could use ANYTIME in the future to get fast INSTANT optimisation benefits

---

## **26/05/2026 — Fog Density Tuned (0.0005 → 0.0004)**

**Change:** Reduced `FogExp2` density from 0.0005 to 0.0004 to match the new 5000-world-unit render distance.

**Why:** 0.0005 was tuned for the 2500-unit edge — ground at 2500m was 71% fog-blended. Halving to 0.00025 made the world hypervisible with a harsh hard edge again. 0.0004 is the sweet spot: clear view feels natural at cruise altitudes while still hiding the 5000m edge.

**New visibility at 0.0004:**
- 1000m: 33% fog (was 39%) — subtly clearer at cruise
- 2500m: 63% fog (was 71%) — mid-distance softer but not foggy
- 5000m: 86% fog — edge well hidden, terrain fades naturally

---

## **26/05/2026 — CRITICAL BUG: Respawn Triggers Slot Exhaustion (add-before-remove → remove-before-add)**

**Severity: CRITICAL** — After quadrant removal (single pool per LOD), respawning (teleport from crash site to origin) caused the world to render mostly empty with hundreds of "No free slots in bucket" warnings. Self-healed as the camera flew away.

**Root cause:** The chunk update loop added ALL new chunks before removing old ones (`add → remove`). On a full teleport (~10609 chunks), the pool briefly held 10609 old + 10609 new = 21218 entries across pools sized for ~12050 total. Single-pool per LOD meant every LOD bucket was hit simultaneously — unlike the old 4-quadrant system where respawn at origin distributed chunks evenly.

**Visual symptom:** `addChunkToBucket` returned early (no free slot) → chunk never written to position buffer → `activeChunks` entry missing → frustum re-eval silently skipped it → terrain hole. Only healed on next chunk-boundary crossing when real add-before-remove happened with fewer simultaneous chunks.

**Fix:** Swapped the loops: `remove` old chunks (free slots) → `add` new chunks (use freed slots).

```js
// BEFORE: add then remove — slot count doubles during teleport
for (const item of _toAdd) addChunkToBucket(...);
for (const key of _toRemove) removeChunkFromBucket(...);

// AFTER: remove then add — slot count stays below maxChunks
for (const key of _toRemove) removeChunkFromBucket(...);
for (const item of _toAdd) addChunkToBucket(...);
```

No visible downside: chunks start hidden (Y=-99999), frustum re-eval runs after both phases in the same frame.

---

## **26/05/2026 — Quadrant Removal: Single Pool Per LOD (16 buckets → 4)**

**Change:** Removed the 4-quadrant allocation system (`NE`/`NW`/`SE`/`SW`) from terrain rendering. Each LOD now has a single buffer pool instead of 4 quadrant pools.

**Why:** Quadrants were designed assuming chunks spread evenly across coordinate signs. At extreme world coordinates (e.g., far +X, far +Z), all chunks land in one quadrant (NE), concentrating allocation pressure and wasting 3/4 of the pre-allocated buffer. Required sizing every pool for worst-case single-quadrant load, wasting 3× memory.

**What changed:**
- Deleted `QUADRANTS` constant and `getQuadrantForChunk()` function
- `mergedMeshes[lod]` holds one bucket directly (was `mergedMeshes[lod][quad]`)
- `initMeshes`: single loop per LOD, one mesh, one geometry, one freeSlots stack
- `addChunkToBucket` / `removeChunkFromBucket` / `hideChunkInBucket` / `unhideChunkInBucket`: no quadrant lookup
- `toggleGapMode` / `updateChunks` cleanup: single loop per LOD
- Draw calls: 4 (1 per LOD) vs 12 (1 per LOD×quadrant) before

**Memory impact:**
| Metric | Before (4 quads) | After (1 pool) | Delta |
|---|---|---|---|
| Position buffer | ~60.8 MB | ~21.6 MB | **-64%** 🟢 |
| Draw calls | 12 | 4 | **-67%** 🟢 |
| endMem (cruise) | 118.6 MB | 79.4 MB | **-33%** 🟢 |

**maxChunks recalculated** for single-pool sizing:
| LOD | Old (per quad) | New (single pool) |
|---|---|---|
| near | 150 | 250 |
| mid | 600 | 700 |
| far | 2600 | 2400 |
| ultra | 8700 | 8700 |

**Benchmark** (cruise: F-16, ~200 m/s, 50-chunk render distance):
- avgFPS: 64.9 (was 65.8 pre-ultra) — stable, GPU-bound unchanged
- endMem: 79.4 MB (was 118.6 MB) — **-33%** despite 4× more chunks loaded
- visibleChunks: 2666 (was 614 pre-ultra) — doubled render distance
- Zero slot exhaustion at any coordinate — single pool eliminates concentration problem

---

## **26/05/2026 — Fix: Ultra Slot Exhaustion (8200→8700)**

**Bug:** Ultra NE running out of slots after sustained flight. At extreme world coordinates with diagonal velocity extension (extX=2, extZ=2), one quadrant holds all 8008 ultra chunks. On chunk-boundary crossing, add-before-remove phase temporarily peaks at 8008 + 205 entering + ~50 far→ultra transitions = **8263**. `maxChunks=8200` was 63 short.

**Visual symptom:** Failed `addChunkToBucket` produces blank holes (Y=-99999 vertices) that persist until a different LOD fills the position.

**Fix:** `ultra.maxChunks` 8200→8700.

---

## **25/05/2026 — Ultra-Far LOD: Render Distance Doubled (25→50 chunks)**

**Change:** Added 4th LOD level "ultra" to extend render distance from 25 chunks (1250 world units) to 50 chunks (2500 world units). No GPU vertex cost increase — ultra uses only 3×3 = 9 vertices per chunk (step=25, scale=0.02).

**LOD table:**

| LOD | Step | Verts/Chunk | Scale | Render Distance | Max Chunks/Quadrant |
|---|---|---|---|---|---|
| near | 1 | 50×50 = 2500 | 1.0 | 5 | 150 |
| mid | 5 | 10×10 = 100 | 0.5 | 12 | 600 |
| far | 10 | 5×5 = 25 | 0.1 | 25 | 2600 |
| **ultra** | **25** | **3×3 = 9** | **0.02** | **50** | **8200** |

**New `RENDER_DISTANCE_ULTRA = 50`** drives the chunk scanner bounds. LOD assignment falls through: near → mid → far → ultra. The scan now covers 101×101 = 10201 chunks (was 51×51 = 2601). Ultra ring: ~7600 chunks beyond far distance, each at 9 verts with near-zero height variation (floor(h * 0.02) → -1..1 range).

**Memory impact:** ~3.5MB extra for ultra vertex buffers (8200 slots × 4 quads × 9 verts × 12 bytes). Total pre-loaded chunk memory ~123MB.

**Perf impact:** Chunk-boundary scan iterates 4x more positions + generates ultra ring. Expected `avgGen` ~20ms (vs 15ms at 25 distance). Per-frame frustum re-eval iterates 10201 entries (~0.2ms vs ~0.05ms). FPS unchanged — GPU vertex count barely moves (+78K ultra verts vs 484K existing).

**Wireframe:** U key now cycles through 4 materials (near/mid/far/ultra).

**Depth precision note:** At RENDER_DISTANCE_ULTRA = 50 chunks (2500 world units), THREE.js default depth buffer (logarithmic for perspective) handles this distance at typical camera positions. Fog obscures the far LOD transition, hiding the flat ultra terrain at extreme distance. If z-fighting appears at ultra distance, switched to logarithmic depth buffer.

---

## **25/05/2026 — Benchmark: Pre-Load All Chunks**

**Results** (see [benchmark.md](benchmark.md) for full data):

| Metric | Frustum Cull (cruise) | Pre-Load All (cruise) | Delta |
|---|---|---|---|
| avgFPS | 67.0 | 65.8 | ~stable |
| avgGen(ms) | 4.85 | 15.23 | ↑ (more chunks gen'd) |
| endChunks | 542 | 2703 | ↑ (all buffered) |
| endMem(MB) | 95.3 | 118.6 | +24MB |
| Rotation pop-in | ⚠️ (margin) | ✅ (none) | 🏆 |

**Verdict:** ~24MB memory for zero rotation pop-in. Gen time higher but per-frame average still ~0.25ms. FPS unchanged — bottleneck is GPU vertex throughput, not gen. Ready for scale-up.

---

## **25/05/2026 — Bugfixes: visibleCount Overflow & Slot Exhaustion**

**Bug 1 — visibleCount overflow (debug showed 10000/2703):**
- `addChunkToBucket` incremented `bucket.visibleCount++` while also marking the chunk `hidden: true`
- The re-evaluation then called `unhideChunkInBucket` which incremented `visibleCount++` again
- Result: every chunk double-counted, `visibleCount` ballooned unbounded
- **Fix:** Removed `visibleCount++` from `addChunkToBucket`. New chunks start Y=-99999 (hidden, zero visibleCount). The re-evaluation is the sole path that sets visibility.

**Bug 2 — "No free slots" warning in far bucket (appeared after sustained flight):**
- At extreme world coordinates with velocity extension (extX=2/[-25,+27]), all ~2809 in-range chunks land in a single quadrant
- Far LOD chunks: ~2184 in the quadrant
- On chunk-boundary crossing, `_toAdd` runs before `_toRemove`. During the adds phase, the far bucket temporarily holds:
  - Existing 2184 far chunks + 53 entering (east edge) + ~25 mid→far transitions = ~2262
  - Before removes free the corresponding west-edge + far→mid slots
- `far.maxChunks=2200` < 2262 → slot exhaustion warning
- **Fix:** Bumped `far.maxChunks` from 2200 → 2600. Worst-case peak at extreme+transition is ~2350, leaving 250 headroom.

**Additional fix:** `addChunkToBucket` now sets Y=-99999 instead of Y=0. Prevents a 1-frame flash of visible terrain before the re-evaluation hides out-of-frustum chunks.

---

## **25/05/2026 — Pre-Load All Chunks + Per-Frame Frustum Re-Evaluation** — REAL FIX

**The real fix for rotation pop-in.** Persistent slot allocation (previous entry) only helped if chunks were previously loaded. Fast rotation brings entirely new chunks into view that never had a slot — they still needed full generation.

**Root cause:** The chunk scanner only loaded chunks that passed the frustum test. Chunks behind the camera were never allocated a slot. On rotation, they had to be generated from scratch (noise compute, Float32Array fill, bus upload).

**Fix — Two-part approach:**

1. **Load ALL in-range chunks, not just frustum-passing ones.** The chunk-boundary scan now adds every chunk within render distance to the vertex buffer (all 2601). New chunks start hidden (Y=-99999). Only chunks leaving the render distance square are evicted.

   ```js
   // BEFORE: frustum-gated — only visible chunks got slots
   if (!frustum.intersectsBox(_frustumBBox)) continue;
   _newActive.add(chunkKey);
   if (!globalChunks.has(chunkKey)) { _toAdd.push(...); }

   // AFTER: all chunks get slots, frustum determines visibility only
   _newActive.add(chunkKey);  // every in-range chunk
   if (!globalChunks.has(chunkKey)) { _toAdd.push(...); }
   ```

2. **Per-frame frustum re-evaluation on camera rotation.** Tracks `camera.getWorldDirection()` via dot product. When direction changes >15°, iterates all loaded chunks (2601) and hides/unhides based on current frustum. No generation — only `Float32Array` Y-value toggles.

   ```js
   _camDir.set(0, 0, 0);
   camera.getWorldDirection(_camDir);
   const dirChanged = _frustumDir === null || _camDir.dot(_frustumDir) < 0.965;

   if (dirChanged) {
       globalChunks.forEach((entry) => {
           if (frustum.intersectsBox(bbox)) {
               if (entry.hidden) { unhideChunkInBucket(...); }
           } else {
               if (!entry.hidden) { hideChunkInBucket(...); }
           }
       });
   }
   ```

**Cost analysis:**
- **Chunk-boundary scan (same as before)**: 2601 iterations × string key creation. Only runs on chunk-crossing.
- **Frustum re-eval on rotation**: 2601 iterations × Box3 frustum test (6 plane checks). ~0.05-0.1ms. Only runs when camera rotates >15°.
- **Hidden chunk memory**: 2601 chunks × average ~200 verts × 12 bytes = ~6MB extra vertex data. Acceptable.
- **Zero generation on rotation**. The only buffer write is Y-value fill, which is `O(vertsPerChunk)` per toggled chunk.

**Tradeoff:** Initial load at a new camera position generates all 2601 chunks (~500K vertices total across all LODs) instead of just the ~500 visible ones. This is a one-time cost per chunk-boundary crossing. Subsequent rotation within that area is instant.

**FRUSTUM_MARGIN remains at CHUNK_SIZE (50)** — still useful to prevent frustum-plane edge clipping on individual chunks.

**Stats added:** `getChunkStats().frustumEvalTime` — time spent in frustum re-evaluation (visible in debug overlay on rotation).

---

## **25/05/2026 — Persistent Slot Allocation: Frustum Culling Without Pop-In**

**Severity: ARCHITECTURE** — The fundamental problem with frustum culling is that it frees GPU vertex buffer slots when chunks leave the view frustum. When the camera rotates, those chunks must be regenerated (noise compute, bus write, slot search), causing visible pop-in. The old `FRUSTUM_MARGIN` bandage just hid the problem for slow rotation — orbit cam and fast jets in chase cam easily outpace any margin.

**Root cause:** `removeChunkFromBucket` freed slots and deleted chunk state on frustum exit. Re-entry required full regeneration.

**Fix — Persistent slot allocation:**
- Chunks that leave the frustum but stay within render distance are **hidden** (Y=-99999) but keep their slot, X/Z data, `activeChunks` entry, and `globalChunks` entry
- Chunks that re-enter the frustum are **unhidden** (Y=0) — no slot search, no noise compute, no X/Z write. Just a fast Float32Array Y-fill
- Chunks that leave the render distance entirely are **evicted** normally (slot freed, state deleted)

**New functions:**
```js
// Only writes Y, keeps X/Z data and slot intact
function hideChunkInBucket(chunkX, chunkZ, lod) {
    pos[idx * 3 + 1] = -99999;  // Y only
    bucket.dirty = true;
    bucket.visibleCount--;
}
function unhideChunkInBucket(chunkX, chunkZ, lod) {
    pos[idx * 3 + 1] = 0;  // Y only, GPU shader recomputes height
    bucket.dirty = true;
    bucket.visibleCount++;
}
```

**Modified `updateChunks` removal phase:** the old `_toRemove` loop for all non-active chunks is split:
```
if out of frustum but in render distance → _toHide (keep slot)
if out of render distance            → _toRemove (free slot)
```

**New unhide pass after adds:** chunks already in `globalChunks` that re-entered the frustum get unhidden (was previously impossible because state was deleted).

**Consequences:**
- `FRUSTUM_MARGIN` halved from `CHUNK_SIZE * 2` (100) → `CHUNK_SIZE` (50) — margin no longer masks a regeneration cost, just prevents frustum-plane edge clipping
- `globalChunks` entries now track `hidden: boolean` — persistent across frustum transitions
- Each bucket tracks `visibleCount` (activeChunks minus hidden) for correct visible chunk reporting
- The cost of a frustum exit/re-entry cycle is now just a Y-buffer write (~O(n) for n-chunk verts, no allocation, no noise)

**Tradeoff:** Memory footprint of in-range-but-hidden chunks persists until the camera moves far enough to evict them. At render distance 25, the max in-range square is 51×51 = 2601 chunks. At ~1-2KB per chunk entry + vertex buffer overhead, this adds ~3-5MB peak for hidden chunks. Acceptable.

**One caveat remains:** the scan only runs when the camera crosses a chunk boundary. Pure rotation without chunk-crossing won't trigger unhide. This is the same behavior as before — the old code also only updated on chunk-crossing. If this becomes an issue, the scan trigger can be changed to a timer or frustum-change detection.

**Stats added:** `getChunkStats()` now returns `chunksHidden` and `chunksUnhidden` counters. Shown in debug overlay as `hide:N/unhide:N` when nonzero.

---

## **25/05/2026 — BUG FIX: Chunk Pop-In During Camera Rotation**

**Severity: MAJOR** — frustum culling was too aggressive. Chunks behind the camera were fully unloaded. When the camera turned, they needed to be generated from scratch, causing visible pop-in that broke immersion.

**Fix:** Added `FRUSTUM_MARGIN = CHUNK_SIZE * 2` (100 world units) to the frustum test bounding box in the chunk scanner. Chunks within 2 chunk-widths of the frustum edge remain loaded, ready for seamless rotation.

```js
// before: exact frustum test → pop-in on turn
_frustumBBox.min.set(x * CHUNK_SIZE, -200, z * CHUNK_SIZE);
_frustumBBox.max.set((x + 1) * CHUNK_SIZE, 200, (z + 1) * CHUNK_SIZE);

// after: expanded test → chunks pre-loaded at edges
const FRUSTUM_MARGIN = CHUNK_SIZE * 2;
_frustumBBox.min.set(x * CHUNK_SIZE - FRUSTUM_MARGIN, -200, z * CHUNK_SIZE - FRUSTUM_MARGIN);
_frustumBBox.max.set((x + 1) * CHUNK_SIZE + FRUSTUM_MARGIN, 200, (z + 1) * CHUNK_SIZE + FRUSTUM_MARGIN);
```

Also reverted `CHUNK_SIZE` back to 50 to return to the current flagship configuration.

---

## **25/05/2026 — Frustum Culling (Scan-Level) with Per-LOD Bounds**

**Change:** Two-part frustum culling in `world.js`:

1. **Scan-level culling** — chunk scanner tests each candidate against the camera frustum before adding. Chunks behind the camera or outside the view cone are skipped entirely. This is the primary savings: invisible chunks never reach the merged mesh.

2. **Per-LOD conservative bounds** — each chunk's bounding box uses the theoretical height range for its LOD, not the old flat `maxPossibleHeight=86` for everything:
   - near: `[-10, 90]` (full terrain range)
   - mid: `[-5, 45]` (half scale)
   - far: `[-2, 10]` (tenth scale — tight, many far quadrants get culled)

**What was tried first and reverted:** Sampling every vertex via `getHeight()` in `addChunkToBucket` for per-chunk tight bboxes. Caused the same tile cache thrashing as the CPU-height regression (17,762 tiles gen, 14,000 evicted in 23.8s). Not worth it — the scan-level culling does the heavy lifting.

```js
// scanner: skip chunks outside frustum
_frustumBBox.min.set(x * CHUNK_SIZE, -200, z * CHUNK_SIZE);
_frustumBBox.max.set((x + 1) * CHUNK_SIZE, 200, (z + 1) * CHUNK_SIZE);
if (!frustum.intersectsBox(_frustumBBox)) continue;

// addChunkToBucket: per-LOD bounds, no getHeight calls
const range = LOD_HEIGHT_RANGES[lod];
const bbox = new THREE.Box3(
    new THREE.Vector3(chunkX * CHUNK_SIZE, range.min, chunkZ * CHUNK_SIZE),
    new THREE.Vector3((chunkX + 1) * CHUNK_SIZE, range.max, (chunkZ + 1) * CHUNK_SIZE)
);
```

**Update previous entry merging this into the single frustum culling record.**

---

## **25/05/2026 — Investigated Greedy Meshing & Face Culling for Terrain**

**Assessment:** Both ideas are voxel/block-world techniques. Neither applies to heightmap terrain.

**Greedy meshing** — merges coplanar adjacent faces into larger quads (Minecraft's stone cubes → big slabs). In our terrain, every adjacent triangle has a different height from noise → never coplanar. Zero faces to merge. Index buffer already optimal (shared vertices via `getIndicesForLOD`).

**Face culling by camera direction** — relies on discrete 6-face cubes where back/hidden faces are predetermined. In a continuous heightfield, every triangle face can face any direction and be visible from any angle. THREE.js already does GPU back-face culling per triangle, which is optimal.

**Verdict:** Focus shifted to re-enabling per-chunk frustum culling with tight AABBs — our biggest remaining lever to cut vertex count at CHUNK_SIZE=100.

---

## **25/05/2026 — Stress Test: CHUNK_SIZE 50 → 100**

**Change:** Doubled `CHUNK_SIZE` in `world.js:50` from 50 to 100. Near LOD now has 10,000 verts/chunk (was 2,500), mid 400 (was 100), far 100 (was 25). Total frame vertex count jumped from ~484K to ~1.885M.

**Impact:**
- **Auto-cruise: 66.7fps** — no visible impact at steady flight
- **Active flight: 36.6fps** — `avgPhys` nearly doubled from 3.99ms → 6.79ms, GPU vertex-bound
- Memory tripled: ~112MB → ~307MB (vertex buffer pool scaled with chunk size)
- Zero tile evictions at both profiles (MAX_TILES=4000 holds)
- Gen time unaffected (CPU job, scales with chunk count not vertex count)

**Status:** CHUNK_SIZE=100 kept as new baseline for optimisation stress testing.

```js
// before
const CHUNK_SIZE = 50;
// near: 50×50 = 2500 verts, mid: 10×10 = 100, far: 5×5 = 25

// after
const CHUNK_SIZE = 100;
// near: 100×100 = 10000 verts, mid: 20×20 = 400, far: 10×10 = 100
```

---

## **24/05/2026 — Tile Cache Tuning: MAX_TILES 2000 → 4000**

**Change:** Doubled the terrain tile cache from 2000 to 4000. Eviction batch reduced from 25% to ~12.5% per overflow.

```js
// before
const MAX_TILES = 2000;
const toEvict = MAX_TILES >> 2; // 500 entries (25%)

// after
const MAX_TILES = 4000;
const toEvict = MAX_TILES >> 3; // 500 entries (12.5%)
```

**Impact:**
- **Zero evictions** during aggressive F-16 flight (was 5,000 evictions in 16.4s before)
- avgGen dropped 47% (25.04ms → 13.17ms per sample)
- totalTilesGen dropped 76% (7,488 → 1,818) — tiles generated once, never evicted
- Memory flat (109.9MB → 111.5MB, +1.5% noise) — the extra 2,000 tile slots cost ~20MB theoretical but real usage peaked at 1,818 tiles (well under 4,000)
- Cruise flight also saw evictions drop from 1,000 → 0

No further tuning needed — current cache comfortably holds all tiles touched during a 15s aggressive run.

---

## **24/05/2026 — CRITICAL BUG FIX: Terrain Height Inconsistency**

**Severity: CRITICAL** — CPU collision system and GPU rendering produced completely different terrain. Planes crashed into invisible walls (or clipped through mountains) because `simplex-noise` npm package and GLSL Gustavson noise output different values for the same coordinates.

**Root cause:** Two different simplex noise implementations running simultaneously. `terrain.js` used the `simplex-noise` npm package (JS), while the vertex shader in `world.js` used Stefan Gustavson's GLSL `snoise` — completely different algorithms producing unrelated terrain.

**Fix applied:**
1. **Reverted `world.js`** to GPU noise — chunk gen restored to ~0.065ms/frame
2. **Ported GLSL Gustavson `snoise` to JS** in `terrain.js` — line-for-line match of mod289, permute, taylorInvSqrt, fade, gradient selection ([full breakdown](docs/bug1.md))
3. **Removed `simplex-noise` npm dependency** — zero external deps for terrain.js
4. **Collision now uses `getHeightScaled(..., 1.0)`** — quantized to match near-LOD rendered surface

**Code changes:**

`terrain.js` — Gustavson `snoise2D` JS port (replaces `simplex-noise` import):
```js
function snoise2D(v) {
  const C = { x: 0.211324865405187, y: 0.366025403784439, z: -0.577350269189626, w: 0.024390243902439 };
  const i = Math.floor(v + C.y); const x0 = v - i + C.x;
  const i1 = x0.x > x0.y ? [1,0] : [0,1];
  const x12 = [x0.x + C.x - i1[0], x0.y + C.x - i1[1], x0.x + C.zz, x0.y + C.zz];
  const i = mod289(i); const p = permute(permute(i.y + [0, i1[1], 1]) + i.x + [0, i1[0], 1]);
  // ... exact GLSL match: mod289 → permute → taylorInvSqrt → dot gradients
}
```

`terrain.js` — height with optional scaling (used by collision):
```js
function getHeightScaled(worldX, worldZ, lodScale = 1.0) {
  return Math.floor(getHeight(worldX, worldZ) * lodScale);
}
```

`physics.js` — collision now uses quantized height matching rendering:
```js
const terrainY = getHeightScaled(this.plane.position.x, this.plane.position.z, 1.0);
const alt = this.plane.position.y - terrainY;
if (alt < 0) { /* crash or land */ }
```

**Performance after fix:**
- Chunk gen: ~0.065ms/frame (restored, no regression from GPU noise)
- Collision cost: one noise eval per frame (negligible)
- Tile cache: only used by minimap — no thrashing (0 evictions in final benchmark)
- Zero external dependencies for terrain.js

**See [`docs/bug1.md`](docs/bug1.md) for full root-cause analysis, data flow diagrams, and verification steps.**

---

## **24/05/2026 — Collision System & Crash Effects**
**NEW:** Terrain-aware collision detection using `getHeight()` from terrain.js (no THREE.js dependency, as designed). Plane now crashes into hills and mountains instead of clipping through them.

This is a naive implementation, as in real life, planes crash if they hit at a certain angle and speed, not purely speed, the angle between plane and plane (dimension) also matters greatly, rather than simply speed, a horizontal f16 at 200kmh can land more likely than a nosediving f16 at 20ms. This is more of a placeholder to first make collisions function, before improving crash logic

**Crash vs Landing:**
- `crashSpeed` per aircraft preset: Cessna 172 = 20 m/s, F-16 = 100 m/s
- Contact at speed ≥ crashSpeed = **CRASH** (explosion, invisible, auto-respawn after 3s)
- Contact at speed < crashSpeed = **landing** (gentle clamp to terrain surface)
- Crashing can be toggled using K to enable/disable collisions

**Before:** Flat y=2 ground clamp that let the plane clip through all terrain.
```js
if (plane.position.y < 2) {
    plane.position.y = 2;
    if (velocity.y < 0) velocity.y = 0;
}
```

**After:** Terrain-aware collision with crash/landing distinction.
```js
const terrainY = getHeight(plane.position.x, plane.position.z);
if (plane.position.y < terrainY) {
    if (_collisionsEnabled && speed >= AIRCRAFT.crashSpeed) {
        // CRASH — invoke callbacks, hide plane
        _crashed = true;
        plane.visible = false;
        for (const fn of _crashCallbacks) fn(...);
    } else {
        // Landing — clamp to terrain
        plane.position.y = terrainY;
        if (velocity.y < 0) velocity.y = 0;
    }
}
```

**Explosion effect:** 200-particle `THREE.Points` burst at crash site with additive blending, expanding outward, fading over 2 seconds.

**Controls:**
- **K** toggles collisions on/off for debugging
- Collision state shown in debug overlay (`F5`)

**Exports:** `resetAircraft()`, `getCollisionsEnabled()`, `setCollisionsEnabled(v)`, `isCrashed()`, `getCrashInfo()`, `onCrash(callback)`

---

## **24/05/2026 — Aircraft Presets & Physics Profiling**
**FEAT:** Added two selectable aircraft presets — Cessna 172 (gentle trainer) and F-16 (high-thrust fighter). `setActiveAircraft(key)` swaps the active config mid-flight with optional state reset. `getAircraftPresetList()` + `getActiveAircraftKey()` exported for UI integration.

**Before:** Single hardcoded `AIRCRAFT` object (Cessna-172 parameters).

**After:**
```js
export const AIRCRAFT_PRESETS = {
    cessna172: defineAircraft({ mass: 1100, wingArea: 16.2, maxThrust: 3600, ... }),
    f16: defineAircraft({ mass: 12000, wingArea: 27.9, maxThrust: 129000, ... })
};
```
- `defineAircraft(config)` merges config with defaults (highAoADrag, postStallFadeAngle, controls)
- Aircraft key read from `?aircraft=f16` URL param, defaults to `f16`
- **P key** cycles presets in-game
- Aircraft name shown in debug overlay
- `?aircraft=f16` or `?aircraft=cessna172` via URL

**NEW:** Added physics timing (`_physicsTime`) to `updatePlane()`, exported via `getPhysicsStats()`. Integrated into F8 profiler (per-sample `phys=X.XXms`) and debug overlay. Summary row now includes `avgPhys(ms)` column.

---

## **24/05/2026 — Profiling, Benchmark & Frustum Culling Fix**

### **Frustum Culling — Quadrant Limitation Accepted**
**FIX:** Attempted per-chunk bounding boxes via `getHeightScaled` terrain sampling for frustum culling. After testing three approaches (per-vertex, sparse-11×11, sparse-6×6), all showed 100% visibility. Root cause: merged geometry buckets union all active chunk bounding boxes into a single quadrant-level box — individual chunk tightness is irrelevant. Reverted to flat `maxPossibleHeight` bbox. Culling only hides empty buckets (no active chunks in that quadrant+LOD). The 12 merged draw calls are handled efficiently by the GPU.

**Before:**
```js
const maxPossibleHeight = 20.0 * (0.2 + 0.1 + 4.0);
const bbox = new THREE.Box3(
    new THREE.Vector3(chunkX * CHUNK_SIZE, -10, chunkZ * CHUNK_SIZE),
    new THREE.Vector3((chunkX + 1) * CHUNK_SIZE, maxPossibleHeight + 10, ...)
);
```

**After:**
```js
let minY = Infinity, maxY = -Infinity;
// ... during vertex loop:
const y = getHeightScaled(worldX, worldZ, lodScale);
if (y < minY) minY = y;
if (y > maxY) maxY = y;
const bbox = new THREE.Box3(
    new THREE.Vector3(chunkX * CHUNK_SIZE, minY - 10, ...),
    new THREE.Vector3((chunkX + 1) * CHUNK_SIZE, maxY + 10, ...)
);
```

### **F8 Profiler (Console)**
**OPT:** Added F8 key to start/stop a console profiler. Collects per-frame metrics (FPS, chunk gen time, adds/removes, tile cache stats) sampled every ~60 frames (~1s). Runs for 900 frames (~15s) then auto-stops. Outputs per-sample lines and a CSV summary row for easy copy-paste comparison. Specifically focuses on terrain generation, but physics profiling is done too, as a single time profile.

### **Performance Benchmark File**
**DOC:** Created `benchmark.md` with before/after profiling data comparing baseline (commit `8da2587`, pre-optimisations) vs current GPU terrain. Includes raw data from both runs, explanation of each system, and a comparison table.

---

## **24/05/2026 — GPU Terrain, Predictive Loading & Processing Metrics**

### **Processing Profiling Metrics**
**OPT:** Added per-frame processing metrics to the debug overlay. `world.js` now tracks chunk generation time (ms), chunks added and removed per frame. `terrain.js` tracks tile cache hits/misses, total tiles generated, and LRU evictions. Stats reset each debug interval via `getChunkStats()` and `getTerrainStats()`.

**Before (debug overlay):**
```js
Visible Chunks: 120/800
```

**After (debug overlay):**
```js
Chunk Gen: 0.3 ms  +2/-3
Terrain Cache: 42 tiles  1850H/3M  gen:120 evict:0
```

### **GPU-Based Terrain Shader**
**OPT:** Moved terrain height and color computation from JS (CPU) to a custom vertex/fragment shader (GPU). Replaced CPU vertex calculations with a `MeshStandardMaterial.onBeforeCompile` shader injection.

**Before:**
```js
const material = new THREE.MeshStandardMaterial({ vertexColors: true, ... });
// CPU loops over 2500+ vertices per chunk
const y = getHeightScaled(worldX, worldZ, lodScale);
const { r, g, b } = getColorComponents(y);
```

**After:**
```js
material.onBeforeCompile = (shader) => {
    // Inject GLSL simplex noise
    shader.vertexShader = `... simplex noise GLSL ...` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
         float h = computeHeight(transformed.x, transformed.z...);
         transformed.y = floor(h * lodScale);
         vHeight = h;`
    );
};
```

### **Predictive Chunk Loading**
**OPT:** Extended the chunk generation scan by 1-2 chunks in the direction of camera movement to pre-load terrain before it enters view, reducing visual pop-in.

**Before:**
```js
updateChunks(scene, camera, frustum);
for (let x = cameraChunkX - RENDER_DISTANCE_FAR; x <= cameraChunkX + RENDER_DISTANCE_FAR; x++) { ... }
```

**After:**
```js
updateChunks(scene, camera, frustum, cameraVelocity.x, cameraVelocity.z);
const extX = Math.abs(vx) > 10 ? Math.sign(vx) * 2 : 0;
const minX = cameraChunkX - RENDER_DISTANCE_FAR + Math.min(0, extX);
const maxX = cameraChunkX + RENDER_DISTANCE_FAR + Math.max(0, extX);
for (let x = minX; x <= maxX; x++) { ... }
```
---

## **23/05/2026 — Performance & Rendering Optimisations**

### **Data-Oriented Terrain System**
**OPT:** Extracted all terrain height/color generation into `src/terrain.js` — a standalone module with no THREE.js dependency. Uses a tiled Float32Array heightmap (2000 tiles × 50×50 samples = 5M samples max) instead of a flat per-coordinate Map. Chunk rendering (`world.js`) and minimap (`main.js`) both read from the same terrain data source.

**Architecture change:**
```
Before: world.js owned simplex noise, cache, height/color functions
After:  terrain.js owns data (no rendering deps)
        world.js imports getHeightScaled + getColorComponents for chunk building
        main.js imports getTerrainColorAt for minimap
```

**Before (per-coordinate Map cache in world.js):**
```js
const heightCache = new Map();  // one entry per (worldX, worldZ)
export function getTerrainHeightAt(worldX, worldZ, lodScale) {
    const key = `${worldX},${worldZ}`;
    let h = heightCache.get(key);
    if (h === undefined) {
        h = computeNoise(worldX, worldZ);
        heightCache.set(key, h);
    }
    return Math.floor(h * lodScale);
}
```

**After (tiled Float32Array in terrain.js):**
```js
const tiles = new Map();  // one entry per tile, tile = 50×50 Float32Array
export function getHeight(worldX, worldZ) {
    const tileX = Math.floor(worldX / 50);
    const tileZ = Math.floor(worldZ / 50);
    const tile = ensureTile(tileX, tileZ);  // generates full tile on miss
    return tile[iz * 50 + ix];  // O(1) array lookup
}
```

### **Merged Geometries per LOD (Draw Call Reduction)**
**OPT:** Drastically reduced draw calls from ~2600 to 12 by replacing per-chunk `THREE.Mesh` objects with incrementally-updated, pre-allocated merged geometries.
Uses 12 static meshes (3 LODs × 4 world quadrants) to maintain frustum culling while completely eliminating object creation and chunk pooling. 
*Detailed metrics, benchmarking tables, and architectural explanations are documented in [docs/performance_comparison.md](docs/performance_comparison.md).*

**Before:**
```js
// ~2600 individual meshes rendered per frame
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);
```

**After:**
```js
// 12 static meshes pre-allocated to max LOD size
// Chunks incrementally occupy free slots in the Float32Array buffers
const bucket = mergedMeshes[lod][quad];
const slot = bucket.freeSlots.pop();
// writes vertices directly to buffer at slot offset...
bucket.geometry.attributes.position.needsUpdate = true;
```

### **Missing Chunks Bug Fix**
**BUG:** Certain chunks at the edge of the render distance would entirely fail to render when flying far from the origin.
**Cause:** When the camera moved, the system attempted to add new chunks before removing chunks that had just left the render distance. Because all chunks can fall into a single world quadrant when far from the origin, the pre-allocated buffer for that quadrant hit its maximum capacity. Without freeing the old slots first, there were no free slots available for the new chunks, causing them to be permanently dropped.
**Fix:** 
- Reordered the `updateChunks` logic to strictly process removals *before* additions, ensuring slots are always freed up in time.
- Increased the `maxChunks` buffer limit slightly for added safety margin.
- Updated chunk removal to collapse the $x$, $y$, and $z$ coordinates of vertices to `(0, -99999, 0)`, rendering them as zero-area triangles that the GPU trivially drops.

### **Streaming Terrain System**
**OPT:** Replaced destructive `tiles.clear()` eviction with LRU-style eviction (oldest 25% evicted when cache fills). Added one-element tile cache (`_cachedTileKey`/`_cachedTile`) to avoid redundant Map operations during chunk generation (2500 queries all hit the same tile).

In `updateChunks`, added camera chunk position tracking: the full 2601-iteration scan is skipped when the camera hasn't crossed a chunk boundary. Reusable arrays (`_toAdd`, `_toRemove`) and Set (`_newActive`) replace per-frame allocations, reducing GC pressure.

**Before (terrain.js):**
```js
if (tiles.size >= MAX_TILES) tiles.clear();  // nukes everything
```

**After (terrain.js):**
```js
if (tiles.size >= MAX_TILES) {
    const toEvict = MAX_TILES >> 2;
    let evicted = 0;
    for (const k of tiles.keys()) {
        if (evicted >= toEvict) break;
        tiles.delete(k);  // evict oldest entries only
        evicted++;
    }
}
```

**Before (world.js — per-frame full scan):**
```js
const newActive = new Set();
const toAdd = [];
const toRemove = [];
// ... full scan every frame
```

**After (world.js — skip when camera stationary):**
```js
if (cameraChunkX !== _lastCamCX || cameraChunkZ !== _lastCamCZ) {
    // ... scan only when camera crosses chunk boundary
}
// frustum culling and dirty-flag upload still run every frame
```



### **Chunk Gap Fix & Seamless Toggle**
**FIX:** 
- Mid step changed from 4 → 5 (divides CHUNK_SIZE evenly)
- Dev mode (`showGaps=true`, default): `x <= CHUNK_SIZE - 1` — preserves intentional gaps for debugging
- Player mode (`showGaps=false`): `x <= CHUNK_SIZE` — inclusive range tiles chunks edge-to-edge with no gaps
- **`J` key** toggles between dev (gapped) and player (seamless) mode
- Toggle clears all chunks, pool, and index cache; regenerates on next frame

```js
// Dev mode (J off): x goes 0..48 for step=1
// Player mode (J on): x goes 0..50 for step=1 (seamless)
const maxCoord = showGaps ? CHUNK_SIZE - 1 : CHUNK_SIZE;
for (let x = 0; x <= maxCoord; x += step) { ... }
```

---

### **LOD Stacking Fix**
**BUG:** Chunks at the same (x,z) position but different LODs were all active simultaneously because the key was `${x},${z},${lod}`. When a chunk's LOD changed (camera moves), the old LOD mesh remained visible underneath the new one.

**Fix:** Before creating a chunk at a new LOD, remove any existing chunk at the same (x,z) for any other LOD.

```js
// new: clear stale LOD layers before creating
const prevLODs = ["near", "mid", "far"];
for (const prevLod of prevLODs) {
    if (prevLod !== lod) {
        const prevKey = `${x},${z},${prevLod}`;
        if (chunks.has(prevKey)) {
            scene.remove(entry.mesh);
            chunkPool.push(entry.mesh);
            chunks.delete(prevKey);
        }
    }
}
```

---

### **LOD Rebalance & Bounding Box Optimisation**
**OPT:** Changed LOD steps to meaningful values — mid: step=5 (was 2, now divides CHUNK_SIZE evenly), far: step=10 (was CHUNK_SIZE=50, degenerate single vertex).  
**OPT:** Replaced `geometry.computeBoundingBox()` with manual Box3 construction using already-tracked minY/maxY, avoiding a full pass over vertex data.

| LOD | Before (verts) | After (verts) | Reduction |
|-----|---------------|--------------|-----------|
| near | 50×50 = 2500 | 50×50 = 2500 | 0% |
| mid | 25×25 = 625 | 11×11 = 121 | **-81%** |
| far | 1×1 = 1 (degenerate!) | 6×6 = 36 | **+3500%** (actually useful) |
| **Total** (all active chunks) | **~620K** | **~370K** | **-40%** |

**Before (degenerate far LOD):**
```js
else if (lod === "far") { step = CHUNK_SIZE; lodScale = 0.1; }
// Only 1 vertex, creates a useless single-triangle chunk
vertsPerSide = CHUNK_SIZE / step; // = 1
```

**After (meaningful LODs):**
```js
else if (lod === "mid") { step = 5; lodScale = 0.5; }
else if (lod === "far") { step = 10; lodScale = 0.1; }
vertsPerSide = CHUNK_SIZE / step + 1; // = 11 for mid, 6 for far
```

**Before (expensive bounding box):**
```js
geometry.computeBoundingBox();  // full vertex iteration
const bbox = geometry.boundingBox;
bbox.min.y = Math.min(minY - 10, bbox.min.y);
bbox.max.y = Math.max(maxY + 10, bbox.max.y);
return bbox.clone();
```

**After (direct construction):**
```js
return new THREE.Box3(
    new THREE.Vector3(0, minY - 10, 0),
    new THREE.Vector3(CHUNK_SIZE, maxY + 10, CHUNK_SIZE)
);
```

---

### **Precomputed Indices**
**OPT:** Index buffer computed once per LOD level and shared across all chunks. Eliminates per-chunk index array allocation and `setIndex` creation overhead.

**Before:** indices were regenerated inside the per-vertex loop for every chunk
```js
const indices = [];
for (let x = 0; x < CHUNK_SIZE; x += step) {
    for (let z = 0; z < CHUNK_SIZE; z += step) {
        if (x < CHUNK_SIZE - step && z < CHUNK_SIZE - step) {
            indices.push(idx, idx + vertsPerSide, idx + 1, ...);
        }
        idx++;
    }
}
geometry.setIndex(indices);
```

**After:** computed once per LOD via `getIndices(lod)`, reused as shared constant array
```js
const preIndex = getIndices(lod);
const indexAttr = geometry.index;
if (indexAttr && indexAttr.count === preIndex.length) {
    indexAttr.array.set(preIndex);       // no allocation — writes into existing buffer
    indexAttr.needsUpdate = true;
} else {
    geometry.setIndex(preIndex);
}
```

---

### **Chunk Pooling**
**OPT:** Added chunk pool to reuse mesh/geometry instances instead of dispose+recreate cycle.  
On removal, meshes go into the pool; on creation, pool is checked first — avoids GC churn from allocation/deallocation.

**Before (dispose+recreate on every transition):**
```js
// removal:
scene.remove(entry.mesh);
entry.mesh.geometry.dispose();
// creation: new BufferGeometry(), new Mesh(), new Material()
```

**After (reuse from pool, repopulate buffers):**
```js
const chunkPool = [];
// removal:
chunkPool.push(entry.mesh);
// creation: check pool first, repopulate via buffer writes + needsUpdate
```

---

### **Frustum Culling Optimisation**
**OPT:** Eliminated per‑frame `Box3.clone()` allocations in frustum checks by reusing a shared `_bbox` instance.

**Before:**
```js
function isChunkInFrustum(chunk, frustum) {
    const box = chunk.userData.boundingBox.clone();
    box.applyMatrix4(chunk.matrixWorld);
    return frustum.intersectsBox(box);
}
```

**After:**
```js
const _bbox = new THREE.Box3();

function isChunkInFrustum(chunk, frustum) {
    _bbox.copy(chunk.userData.boundingBox);
    _bbox.applyMatrix4(chunk.matrixWorld);
    return frustum.intersectsBox(_bbox);
}
```

---

### **Vertex Buffer Optimisation**
**OPT:** Replaced dynamic JS arrays with `Float32Array` buffers for vertex positions & colors.  
Uses index‑based writes instead of `push()`, improving memory locality and GC behaviour.

**Before:**
```js
const vertices = [];
const colors = [];
// ...
vertices.push(x, y, z);
colors.push(0.47, 0.8, 0.47);
```

**After:**
```js
const vertsPerSide = CHUNK_SIZE / step;
const vertexCount = vertsPerSide * vertsPerSide;
const positions = new Float32Array(vertexCount * 3);
const colors = new Float32Array(vertexCount * 3);
// ...
const i3 = idx * 3;
positions[i3] = x;
positions[i3 + 1] = y;
positions[i3 + 2] = z;
colors[i3] = 0.47;
colors[i3 + 1] = 0.8;
colors[i3 + 2] = 0.47;
```

---

### **Terrain Height Optimisation**
**OPT:** Added a height‑cache (`Map`) to avoid repeated simplex noise evaluations for identical world coordinates.  
**FIX:** Capped cache at 500,000 entries with auto‑clear to prevent unbounded memory growth (minimap was leaking ~150k entries/sec).

**Before:**
```js
export function getTerrainHeightAt(worldX, worldZ, lodScale = 1.0) {
    const baseHeight = simplex.noise2D(worldX * baseScale, worldZ * baseScale) * heightScale * flatnessFactor;
    const hillHeight = simplex.noise2D(worldX * hillScale, worldZ * hillScale) * heightScale * hillHeightMultiplier;
    const mountainHeight = Math.max(0, simplex.noise2D(worldX * mountainScale, worldZ * mountainScale)) * heightScale * mountainHeightMultiplier;
    return Math.floor((baseHeight + hillHeight + mountainHeight) * lodScale);
}
```

**After:**
```js
const heightCache = new Map();

export function getTerrainHeightAt(worldX, worldZ, lodScale = 1.0) {
    const key = `${worldX},${worldZ}`;
    const cached = heightCache.get(key);
    if (cached !== undefined) {
        return Math.floor(cached * lodScale);
    }
    const baseHeight = simplex.noise2D(worldX * baseScale, worldZ * baseScale) * heightScale * flatnessFactor;
    const hillHeight = simplex.noise2D(worldX * hillScale, worldZ * hillScale) * heightScale * hillHeightMultiplier;
    const mountainHeight = Math.max(0, simplex.noise2D(worldX * mountainScale, worldZ * mountainScale)) * heightScale * mountainHeightMultiplier;
    const height = baseHeight + hillHeight + mountainHeight;
    heightCache.set(key, height);
    return Math.floor(height * lodScale);
}
```

---

## **22/05/2026 — Major Flight Physics Overhaul**

### **Codebase Refactor**
- Migrated to **ES6 modules**
- Extracted `physics.js` and `world.js` from monolithic `main.js`
- Added constants table to debug overlay (mass, wing area, CL max, stall AoA, etc.)

---

### **UI & Camera Improvements**
- Added **Artificial Horizon** instrument (toggle: `F`)
- Added **minimap** with terrain shading + heading indicator (toggle: `M`)
- Replaced `PointerLockControls` with **OrbitControls** for better workflow  
- Added camera modes:
  - **Chase cam** (behind aircraft)
  - **Orbit cam** (free look)
  - Reset orbit cam with `C`

---

### **Force Visualisation**
Added toggleable debug arrows for:

- Velocity  
- Acceleration  
- Lift  
- Drag  
- Thrust  
- Weight  
- Side force  
- Total force  
- Reference axes  

**Toggles:**  
- `F6` — force vectors  
- `F7` — reference axes  

---

### **Instrumentation & Debugging**
Added extensive real‑time flight instrumentation:

- Angle of Attack (AoA)
- Sideslip angle
- Pitch & bank angles
- Dynamic pressure
- Lift‑to‑weight ratio
- Thrust‑to‑drag ratio
- Stall speed & stall warning

Added formula‑level debugging to overlay (live lift/drag/thrust/weight equations).

---

### **Throttle Control**
Added throttle input via **Shift** (increase) and **Ctrl** (decrease), clamped to `[0, 1]`.

**Before:**  
Throttle fixed at `1.0`, no user control.

**After:**
```js
const throttleInput = (keyboard['ShiftLeft'] || keyboard['ShiftRight'] ? 1 : 0) +
    (keyboard['ControlLeft'] || keyboard['ControlRight'] ? -1 : 0);
throttle = THREE.MathUtils.clamp(throttle + throttleInput * dt, 0, 1);
```

---

### **Full Aerodynamics System**
Replaced the old "move forward at constant speed" model with a full aerodynamic simulation including:

- Lift, drag, thrust, weight, side force  
- Cessna‑172‑like aerodynamic parameters  
- Air density model  
- Stall physics & stall AoA  
- CL/CD breakdown  
- Full state tracking (velocities, accelerations, forces)

**Before (simple movement):**
```js
plane.translateZ(-speed * throttle * dt);
if (plane.position.y < 2) plane.position.y = 2;
```

**After (real physics):**
```js
const rho = getAirDensity(plane.position.y);
const dynamicPressure = 0.5 * rho * speed * speed;
const liftForce = dynamicPressure * AIRCRAFT.wingArea * liftCoefficient.cl;
const dragForce = dynamicPressure * AIRCRAFT.wingArea * dragBreakdown.cd;
const thrustForce = throttle * AIRCRAFT.maxThrust;
const weightForce = AIRCRAFT.mass * GRAVITY;
// ... integrate forces into acceleration/velocity
velocity.addScaledVector(acceleration, dt);
plane.position.addScaledVector(velocity, dt);
```

---
