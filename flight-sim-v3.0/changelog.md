# Changelog
## **24/05/2026 — CRITICAL BUG FIX: Terrain Height Inconsistency**

**Severity: CRITICAL** — CPU collision system and GPU rendering produced completely different terrain. Planes crashed into invisible walls (or clipped through mountains) because `simplex-noise` npm package and GLSL Gustavson noise output different values for the same coordinates.

**Root cause:** Two different simplex noise implementations running simultaneously. `terrain.js` used the `simplex-noise` npm package (JS), while the vertex shader in `world.js` used Stefan Gustavson's GLSL `snoise` — completely different algorithms producing unrelated terrain.

**Fix applied:**
1. **Reverted `world.js`** to GPU noise — chunk gen restored to ~0.065ms/frame
2. **Ported GLSL Gustavson `snoise` to JS** in `terrain.js` — line-for-line match of mod289, permute, taylorInvSqrt, fade, gradient selection ([full breakdown](bug1.md))
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

**See [`bug1.md`](bug1.md) for full root-cause analysis, data flow diagrams, and verification steps.**

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
*Detailed metrics, benchmarking tables, and architectural explanations are documented in [performance_comparison.md](file:///c:/Users/thahm/OneDrive/Documents/website/webgl/flight-sim/performance_comparison.md).*

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
