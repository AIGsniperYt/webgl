# Changelog
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

**User verdict:** "HOLY FUCK ITS AMAZING, now it feels a LOT more like infinity, and a lot less like a following square heightmap mesh!"

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

**Results** (see benchmark.md for full data):

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
