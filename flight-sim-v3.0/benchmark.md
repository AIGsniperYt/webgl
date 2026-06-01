# Performance Benchmarks

> Run with `F8` to start/stop profiling. Data is sampled every ~60 frames (~1s) for ~900 frames (~15s).
> Fly the plane with moderate inputs during profiling.

---

## Noise Fix Applied: Gustavson `snoise2D` JS Port *(newest)*

**Description:** Noise inconsistency fixed. Ported the exact Stefan Gustavson GLSL `snoise()` function to JavaScript in `terrain.js`. Removed `simplex-noise` npm package dependency. GPU vertex shader keeps original GLSL `snoise`. Both paths now produce identical terrain values for all coordinates.

**Approach:** Instead of moving noise computation to CPU (which caused the 53x regression below), we unified the noise *algorithm* between CPU and GPU. The chunk gen pipeline stays GPU-only (0.065ms), while collision and minimap query terrain.js's JS port of the same Gustavson noise (one eval per frame — negligible).

**Key detail on `gen=XXms` interpretation:** The profiler accumulates all chunk gen time across every frame in a ~1s sample window. `gen=17.27ms` means 17.27ms total across ~60 frames = **~0.29ms/frame average**. The HTML debug panel shows per-frame instantaneous gen time (2-4ms) because gen is bursty—when the camera moves, a few frames do heavy work, most frames do zero. The profiler smoothes this across the whole window.

### Run 1 — Normal cruise (Cessna 172, ~60 m/s)

```
=== PROFILE START ===
S0: 70fps gen=17.50ms phys=4.50ms +738/-738 vis=2582/2703 tiles=1026(36855H/18M/1026G/0E) mem=79.4MB
S1: 69fps gen=11.80ms phys=5.60ms +738/-738 vis=2582/2703 tiles=1134(36855H/18M/1134G/0E) mem=96MB
S2: 62fps gen=12.80ms phys=2.90ms +738/-738 vis=2582/2703 tiles=1242(36836H/36M/1242G/0E) mem=83.7MB
S3: 58fps gen=24.00ms phys=4.20ms +861/-861 vis=2582/2703 tiles=1350(2H/0M/1350G/0E) mem=98.1MB
S4: 59fps gen=13.00ms phys=4.20ms +861/-861 vis=2582/2703 tiles=1494(36830H/36M/1494G/0E) mem=112.1MB
S5: 63fps gen=14.70ms phys=3.70ms +738/-738 vis=2582/2703 tiles=1602(36849H/18M/1602G/0E) mem=96.4MB
S6: 70fps gen=17.60ms phys=4.50ms +861/-861 vis=2582/2703 tiles=1728(36834H/36M/1728G/0E) mem=87.2MB
S7: 61fps gen=16.70ms phys=3.80ms +984/-984 vis=2582/2703 tiles=1854(10H/0M/1854G/0E) mem=113.6MB
S8: 60fps gen=20.10ms phys=4.30ms +861/-861 vis=2582/2703 tiles=1962(12H/0M/1962G/0E) mem=98.3MB
S9: 75fps gen=18.30ms phys=3.30ms +861/-861 vis=2582/2703 tiles=1624(36859H/18M/2124G/500E) mem=116MB
S10: 68fps gen=21.80ms phys=2.60ms +984/-984 vis=2582/2703 tiles=1750(1H/0M/2250G/500E) mem=109.4MB
S11: 79fps gen=14.90ms phys=3.50ms +861/-861 vis=2582/2703 tiles=1894(1H/0M/2394G/500E) mem=114.3MB
S12: 69fps gen=14.50ms phys=3.00ms +984/-984 vis=2582/2703 tiles=1520(2H/0M/2520G/1000E) mem=106MB
S13: 61fps gen=19.90ms phys=3.30ms +984/-984 vis=2582/2703 tiles=1664(5H/0M/2664G/1000E) mem=110.2MB
S14: 58fps gen=21.50ms phys=3.50ms +984/-984 vis=2582/2703 tiles=1808(7H/0M/2808G/1000E) mem=112.9MB
=== PROFILE STOP ===

avgFPS  avgGen(ms)  avgPhys(ms)  +/s     -/s     endChunks  endVisible  peakChunks  avgTileHits/s  avgTileMisses/s  totalTilesGen  totalTilesEvict  endMem(MB)
65.5    17.27       3.793        13038   13038   2703       2582        2703        17197          12               2808           1000             112.9
```

**Notes:**
- Chunk gen per frame: ~0.29ms (17.27ms / 60 frames) — **4x slower than pre-fix peak** but still only 1.7% of frame budget
- Collision system functional: `phys=3.8ms` avg includes full physics sim + crash detection
- First evictions (1000) seen — minimap tile cache reached 2000 limit briefly in later samples
- Memory: 79→113MB, modest growth from more active tiles (minimap + collision queries)
- Tile hit rate: 17197/s — 1400x higher than misses (12/s) — cache effective

### Run 2 — Aggressive F-16 flight (post-respawn, ~200 m/s)

```
main.js:639 Respawned
=== PROFILE START ===
S0: 67fps gen=27.50ms phys=2.30ms +1230/-1230 vis=2078/2703 tiles=1874(3H/0M/4878G/2500E) mem=120.1MB
S1: 61fps gen=31.70ms phys=2.80ms +1230/-1230 vis=2078/2703 tiles=1536(13H/0M/5040G/3000E) mem=132MB
S2: 73fps gen=30.60ms phys=2.90ms +1107/-1107 vis=2078/2703 tiles=1734(1H/0M/5238G/3000E) mem=110.1MB
S3: 60fps gen=21.20ms phys=1.90ms +1230/-1230 vis=2078/2703 tiles=1914(5H/0M/5418G/3000E) mem=99.3MB
S4: 68fps gen=23.80ms phys=2.00ms +1230/-1230 vis=2078/2703 tiles=1576(7H/0M/5580G/3500E) mem=117.1MB
S5: 83fps gen=29.70ms phys=3.80ms +1230/-1230 vis=2078/2703 tiles=1738(8H/0M/5742G/3500E) mem=128.7MB
S6: 63fps gen=26.50ms phys=3.00ms +1230/-1230 vis=2078/2703 tiles=1954(36838H/36M/5958G/3500E) mem=105MB
S7: 62fps gen=22.20ms phys=2.40ms +1230/-1230 vis=2078/2703 tiles=1634(36820H/54M/6138G/4000E) mem=100MB
S8: 72fps gen=25.50ms phys=3.10ms +1353/-1353 vis=2078/2703 tiles=1814(36822H/54M/6318G/4000E) mem=121.2MB
S9: 62fps gen=21.10ms phys=1.50ms +1230/-1230 vis=2078/2703 tiles=1994(4H/0M/6498G/4000E) mem=100.5MB
S10: 67fps gen=18.10ms phys=2.50ms +1230/-1230 vis=2078/2703 tiles=1656(3H/0M/6660G/4500E) mem=107.2MB
S11: 62fps gen=31.60ms phys=3.00ms +1476/-1476 vis=2078/2703 tiles=1872(7H/0M/6876G/4500E) mem=126.6MB
S12: 60fps gen=23.60ms phys=2.50ms +1353/-1353 vis=2078/2703 tiles=1570(6H/0M/7074G/5000E) mem=125.2MB
S13: 64fps gen=24.00ms phys=3.00ms +1230/-1230 vis=2078/2703 tiles=1786(36834H/36M/7290G/5000E) mem=111.3MB
S14: 59fps gen=18.50ms phys=2.00ms +1353/-1353 vis=2078/2703 tiles=1984(36821H/54M/7488G/5000E) mem=109.9MB
=== PROFILE STOP ===

avgFPS  avgGen(ms)  avgPhys(ms)  +/s     -/s     endChunks  endVisible  peakChunks  avgTileHits/s  avgTileMisses/s  totalTilesGen  totalTilesEvict  endMem(MB)
65.6    25.04       2.580        18942   18942   2703       2078        2703        12279          16               7488           5000             109.9
```

**Notes:**
- Higher chunk churn: +18942/s vs +13038/s (F-16 at 3x speed covers 1.5x terrain per second)
- Tile cache thrashing more visible: 7488 tiles generated, 5000 evicted in 16.4s
- Yet gen per frame only ~0.42ms (25.04ms / 60) — even under heavy cache pressure, gen stays reasonable
- Lower physics time (2.58ms vs 3.79ms) — plane was crashed/respawned during part of the run, less time airborne
- Fewer visible chunks (2078 vs 2582) — plane started lower/crashed, reducing horizon view distance

**Takeaway:** The Gustavson port restores GPU-gen performance and scales well even under aggressive flight. Cache thrashing doesn't cripple frame rate — chunk gen stays under 0.5ms/frame even at 2x tile turnover. The pre-fix peak (0.065ms) was on stationary/slow Cessna circuits with minimal terrain change — the 0.29-0.42ms here reflects real flight across vast terrain with collision active.

---

## Attempted Fix: CPU Heights to Vertex Buffer (REVERTED)

**Description:** Attempted to fix noise inconsistency by writing `getHeight(worldX, worldZ)` directly to vertex buffer Y in `addChunkToBucket`, removing GLSL noise computation from the shader. **Catastrophic performance regression — reverted immediately.**

**Root cause of regression:** Every chunk vertex required a `getHeight()` call on the CPU. At F-16 cruise speed (210 m/s = 4.2 chunks/s), the camera crosses chunk boundaries rapidly, triggering mass tile generation in terrain.js. The 2000-tile LRU cache thrashed constantly — tiles generated (`totalTilesGen: 11514`) and evicted (`totalTilesEvict: 10000`) in 15.9s, while only 1514–1978 tiles were live at any point. Each tile generation costs 3 × 2500 = 7500 noise calls. The CPU was drowning in noise evaluations that the GPU handled for free.

```
=== PROFILE START ===
S0: 61fps gen=162.70ms phys=3.30ms +738/-738 vis=2582/2703 tiles=1688(69792H/83M/5188G/3500E) mem=103.2MB
S1: 63fps gen=213.20ms phys=4.40ms +738/-738 vis=2582/2703 tiles=1555(69798H/77M/5555G/4000E) mem=93.9MB
S2: 80fps gen=140.80ms phys=4.10ms +738/-738 vis=2582/2703 tiles=1949(69814H/58M/5949G/4000E) mem=93.8MB
S3: 64fps gen=192.40ms phys=4.80ms +738/-738 vis=2582/2703 tiles=1850(69813H/58M/6350G/4500E) mem=110.6MB
S4: 63fps gen=177.30ms phys=3.30ms +738/-738 vis=2582/2703 tiles=1755(36872H/0M/6755G/5000E) mem=108.1MB
S5: 81fps gen=201.60ms phys=3.00ms +861/-861 vis=2582/2703 tiles=1724(32936H/71M/7224G/5500E) mem=97.8MB
S6: 72fps gen=260.90ms phys=4.70ms +861/-861 vis=2582/2703 tiles=1680(32925H/83M/7680G/6000E) mem=90.5MB
S7: 68fps gen=148.70ms phys=3.60ms +738/-738 vis=2582/2703 tiles=1541(32939H/70M/8041G/6500E) mem=90.6MB
S8: 65fps gen=318.90ms phys=3.60ms +984/-984 vis=2582/2703 tiles=1580(102735H/141M/8580G/7000E) mem=99.3MB
S9: 63fps gen=229.70ms phys=2.90ms +861/-861 vis=2582/2703 tiles=1522(69815H/61M/9022G/7500E) mem=107MB
S10: 73fps gen=186.20ms phys=3.20ms +861/-861 vis=2582/2703 tiles=1978(69815H/58M/9478G/7500E) mem=95.6MB
S11: 65fps gen=188.40ms phys=3.30ms +861/-861 vis=2582/2703 tiles=1949(36871H/0M/9949G/8000E) mem=105.7MB
S12: 69fps gen=216.60ms phys=2.30ms +984/-984 vis=2582/2703 tiles=1966(69811H/58M/10466G/8500E) mem=111.9MB
S13: 60fps gen=238.30ms phys=3.90ms +984/-984 vis=2582/2703 tiles=1987(32950H/58M/10987G/9000E) mem=103MB
S14: 66fps gen=244.40ms phys=3.20ms +984/-984 vis=2582/2703 tiles=1514(32951H/58M/11514G/10000E) mem=100.7MB
=== PROFILE STOP ===

avgFPS  avgGen(ms)  avgPhys(ms)  +/s     -/s     endChunks  endVisible  peakChunks  avgTileHits/s  avgTileMisses/s  totalTilesGen  totalTilesEvict  endMem(MB)
67.6    208.01      3.573        12669   12669   2703       2582        2703        55322          62               11514          10000            100.7
```

**Notes:**
- Chunk gen: **208ms per sample = ~3.5ms/frame** — 53x worse than GPU noise (0.065ms)
- Tile cache thrashing: 11514 tiles generated, 10000 evicted in 15.9s
- Memory misleadingly stable (100.7MB end) because evictions kept freeing space
- Physics time unaffected (~3.6ms) — collision's single `getHeight()` call per frame is fine
- Tile hit rate: 55322/s avg — cache was working hard, just overwhelmed by volume

**Lesson:** Writing CPU-computed heights to the vertex buffer defeats the GPU optimisation. The correct fix is to unify the noise implementation so both CPU and GPU use the same algorithm — same Gustavson `snoise` ported to JS for collision/minimap, while rendering keeps the GPU noise.

---

## Final Optimised (GPU Shaders + No BBox Overhead)

**Description:** Same as GPU version below but with per-chunk bounding box computation removed (reverted to flat `maxPossibleHeight`). This is acceptable because merged geometry buckets union all chunk bounding boxes into one quadrant-level box — individual chunk tightness doesn't affect culling. The 12 draw calls are trivially handled by the GPU at 60fps.

```
=== PROFILE START ===
S0: 69fps gen=2.30ms +123/-123 vis=1989/2703 tiles=558(0H/0M/558G/0E) mem=76.2MB
S1: 68fps gen=4.50ms +246/-246 vis=2091/2703 tiles=576(0H/0M/576G/0E) mem=99.6MB
S2: 72fps gen=1.60ms +123/-123 vis=2142/2703 tiles=612(0H/0M/612G/0E) mem=103MB
S3: 57fps gen=5.60ms +246/-246 vis=2244/2703 tiles=630(0H/0M/630G/0E) mem=100.9MB
S4: 59fps gen=3.50ms +246/-246 vis=2346/2703 tiles=666(0H/0M/666G/0E) mem=97.2MB
S5: 67fps gen=1.70ms +123/-123 vis=2397/2703 tiles=702(36846H/18M/702G/0E) mem=100.7MB
S6: 59fps gen=7.20ms +246/-246 vis=2499/2703 tiles=720(0H/0M/720G/0E) mem=98.4MB
S7: 56fps gen=5.30ms +246/-246 vis=2601/2703 tiles=756(0H/0M/756G/0E) mem=94.7MB
S8: 55fps gen=2.30ms +123/-123 vis=2652/2703 tiles=774(36864H/0M/774G/0E) mem=92MB
S9: 56fps gen=5.90ms +246/-246 vis=2703/2703 tiles=810(36864H/0M/810G/0E) mem=88.2MB
S10: 57fps gen=4.00ms +246/-246 vis=2703/2703 tiles=846(0H/0M/846G/0E) mem=104.1MB
S11: 59fps gen=2.50ms +123/-123 vis=2703/2703 tiles=864(0H/0M/864G/0E) mem=101.9MB
S12: 65fps gen=4.20ms +246/-246 vis=2703/2703 tiles=900(0H/0M/900G/0E) mem=98.3MB
S13: 61fps gen=5.60ms +246/-246 vis=2703/2703 tiles=936(0H/0M/936G/0E) mem=94.5MB
S14: 61fps gen=2.00ms +123/-123 vis=2703/2703 tiles=954(0H/0M/954G/0E) mem=86.8MB
=== PROFILE STOP ===

avgFPS  avgGen(ms)  +/s    -/s    endChunks  endVisible  peakChunks  avgTileHits/s  avgTileMisses/s  totalGen  totalEvict  endMem(MB)
61.4    3.88        2952   2952   2703       2703        2703        7372           1                 954       0           86.8
```

**Notes:**
- Chunk gen per frame: ~0.065ms (3.88ms / 60 frames) — **best ever for GPU-only flight (no collision logic running)**
- Memory: 76→87MB, nearly flat — only tile cache growth
- No evictions (0) — 954 tiles well under 2000 max
- 100% visible is expected — quadrant-level union boxes

---

## GPU Shaders + Merged Meshes — Commit `fdfdac2`

**Description:** Terrain height computed in GLSL vertex shader via `onBeforeCompile`. 12 merged draw calls (3 LODs × 4 quadrants) with pre-allocated Float32Array buffers and slot-based recycling. Camera chunk tracking skips full scan when stationary. Predictive loading extends scan in movement direction. LRU tile eviction for height cache. Gap mode toggle (J key). **At this point: no collision system, no noise fix — but chunk gen at peak performance (no physics overhead).**

```
=== PROFILE START ===
S0: 58fps gen=5.70ms +246/-246 vis=2499/2703 tiles=720(0H/0M/720G/0E) mem=79.7MB
S1: 55fps gen=2.90ms +123/-123 vis=2550/2703 tiles=738(0H/0M/738G/0E) mem=77MB
S2: 58fps gen=4.70ms +246/-246 vis=2652/2703 tiles=774(0H/0M/774G/0E) mem=80MB
S3: 55fps gen=4.00ms +246/-246 vis=2703/2703 tiles=810(0H/0M/810G/0E) mem=79.8MB
S4: 56fps gen=1.90ms +123/-123 vis=2703/2703 tiles=828(0H/0M/828G/0E) mem=79.5MB
S5: 62fps gen=5.80ms +246/-246 vis=2703/2703 tiles=864(0H/0M/864G/0E) mem=82.6MB
S6: 66fps gen=5.00ms +246/-246 vis=2703/2703 tiles=900(0H/0M/900G/0E) mem=82.3MB
S7: 60fps gen=3.30ms +123/-123 vis=2703/2703 tiles=918(0H/0M/918G/0E) mem=81.9MB
S8: 66fps gen=5.90ms +246/-246 vis=2703/2703 tiles=954(36864H/0M/954G/0E) mem=79.2MB
S9: 59fps gen=3.60ms +246/-246 vis=2703/2703 tiles=990(36864H/0M/990G/0E) mem=83MB
S10: 63fps gen=2.50ms +123/-123 vis=2703/2703 tiles=1026(36846H/18M/1026G/0E) mem=81.9MB
S11: 63fps gen=5.00ms +246/-246 vis=2703/2703 tiles=1044(36864H/0M/1044G/0E) mem=81.6MB
S12: 59fps gen=4.50ms +246/-246 vis=2703/2703 tiles=1080(36864H/0M/1080G/0E) mem=84.5MB
S13: 61fps gen=5.60ms +246/-246 vis=2703/2703 tiles=1116(36864H/0M/1116G/0E) mem=84.1MB
S14: 60fps gen=9.10ms +246/-246 vis=2703/2703 tiles=1152(36846H/18M/1152G/0E) mem=86.9MB
=== PROFILE STOP ===

avgFPS  avgGen(ms)  +/s    -/s    endChunks  endVisible  peakChunks  avgTileHits/s  avgTileMisses/s  totalGen  totalEvict  endMem(MB)
60.2    4.63        3198   3198   2703       2703        2703        17201          2                 1152      0           86.9
```

**Notes:**
- Chunk gen time per frame: ~0.08ms (4.63ms / 60 frames) — **60x faster** than baseline
- Memory stable at ~80MB — no growth, pool recycling working
- Chunks capped at 2703 (sum of per-LOD maxChunks limits)
- **BUG: 100% visibility** — frustum culling was broken. Bounding boxes used flat `maxPossibleHeight=86` for every chunk. Fixed after this benchmark.
- Tile cache effective: 17201 hits vs 2 misses per sample window
- No evictions — LRU never triggered (1152 tiles well under 2000 max)

---

## Baseline (pre-optimisation) — Commit `8da2587` *(oldest)*

**Description:** Original terrain system. Every vertex computed via simplex noise on CPU with zero caching. Individual mesh per chunk (2600 meshes), created/destroyed every frame change. LOD far = 1 quad. Dynamic `push()` arrays. `geometry.dispose()` on every removal. `.clone()` per frame for frustum culling.

```
=== PROFILE START ===
S0: 57185fps gen=324.60ms +174/-174 vis=889/3892 tiles=864(36846H/18M/864G/0E) mem=122.8MB
S1: 57182fps gen=277.40ms +87/-87 vis=830/3892 tiles=882(36864H/0M/882G/0E) mem=114.4MB
S2: 57270fps gen=298.60ms +174/-174 vis=855/3892 tiles=918(36864H/0M/918G/0E) mem=105.2MB
S3: 58128fps gen=281.70ms +174/-174 vis=878/3892 tiles=954(0H/0M/954G/0E) mem=125.8MB
S4: 61905fps gen=281.10ms +87/-87 vis=825/3892 tiles=990(36846H/18M/990G/0E) mem=128.1MB
S5: 59359fps gen=304.40ms +174/-174 vis=827/3892 tiles=1008(36864H/0M/1008G/0E) mem=136.0MB
S6: 60112fps gen=305.30ms +174/-174 vis=865/3892 tiles=1044(36864H/0M/1044G/0E) mem=121.3MB
S7: 57700fps gen=313.80ms +174/-174 vis=897/3892 tiles=1080(36846H/18M/1080G/0E) mem=137.5MB
S8: 61035fps gen=289.10ms +87/-87 vis=827/3892 tiles=1098(36864H/0M/1098G/0E) mem=140.8MB
S9: 60515fps gen=315.10ms +174/-174 vis=847/3892 tiles=1134(36864H/0M/1134G/0E) mem=153.8MB
S10: 59763fps gen=314.80ms +174/-174 vis=867/3892 tiles=1170(36846H/18M/1170G/0E) mem=138.7MB
S11: 54711fps gen=357.90ms +174/-174 vis=869/3892 tiles=1206(0H/0M/1206G/0E) mem=149.2MB
S12: 61240fps gen=287.60ms +87/-87 vis=803/3892 tiles=1224(0H/0M/1224G/0E) mem=151.9MB
S13: 58908fps gen=305.00ms +174/-174 vis=810/3892 tiles=1260(0H/0M/1260G/0E) mem=168.8MB
S14: 61749fps gen=298.00ms +174/-174 vis=841/3892 tiles=1296(0H/0M/1296G/0E) mem=157.3MB
=== PROFILE STOP ===

avgFPS   avgGen(ms)  +/s    -/s    endChunks  endVisible  peakChunks  avgTileHits/s  avgTileMisses/s  totalGen  totalEvict  endMem(MB)
(flawed) 300.22      2262   2262   3892       841         3892        (not tracked)                    1296      0           157.3
```

**Notes:**
- FPS counter was buggy (dt treated as ms instead of seconds)
- Approx 300ms gen per sample window = ~5ms per frame spent on chunk gen
- Chunks unbounded at 3892 (no max cap per bucket)
- Memory growing from 105→169MB over 15s (leaking from create/dispose cycle)
- 78% of chunks frustum-culled (841 visible out of 3892) — good culling accuracy
- No tile evictions (0) because LRU cache was never implemented at this point

---

## Comparison Summary

> **Reading left to right = chronological.**
> **Direction indicators:** `↑` higher is better, `↓` lower is better, `—` neutral/informational.

| Metric ↓ (good direction) | Baseline | GPU Merged Meshes | GPU No BBox | CPU Heights (reverted) | Gustavson Fix (cruise) | Gustavson Fix (aggressive) |
|---|---|---|---|---|---|---|
| Chunk gen per frame `↓` | ~5ms | ~0.08ms | ~0.065ms | ~3.5ms | ~0.29ms | ~0.42ms |
| avgGen(ms)/sample `↓` | 300.22 | 4.63 | 3.88 | 208.01 | 17.27 | 25.04 |
| avgFPS `↑` | ~58k (buggy) | 60.2 | 61.4 | 67.6 | 65.5 | 65.6 |
| avgPhys(ms)/sample `↓` | — | — | — | 3.57 | 3.79 | 2.58 |
| Memory growth `↓` | +64MB | +7MB | +11MB | stable (evicting) | +34MB | -10MB |
| Memory peak `↓` | ~169MB | ~87MB | ~104MB | ~111MB | ~116MB | ~132MB |
| Draw calls `↓` | ~2600 | 12 | 12 | 12 | 12 | 12 |
| totalTilesGen `↓` | 1296 | 1152 | 954 | 11514 | 2808 | 7488 |
| totalTilesEvict `↓` (0=best) | 0 | 0 | 0 | 10000 | 1000 | 5000 |
| Noise match CPU↔GPU `—` | ❌ | N/A (GPU only) | N/A (GPU only) | ✅ (CPU writes) | ✅ (same Gustavson) | ✅ (same Gustavson) |
| Collision functional `—` | ❌ | ❌ | ❌ | ✅ (too slow) | ✅ | ✅ |

**Key takeaways:**
- **GPU No BBox** remains the performance peak (0.065ms/frame gen) — no collision logic was running
- **Gustavson Fix** trades ~4x gen time for correct collision + minimap — still only 1.7-2.5% of frame budget
- **CPU Heights** was a dead end: 53x gen regression from cache thrashing
- High `totalTilesEvict` is bad (means tile cache is too small for flight speed × terrain complexity)
- Low `avgPhys` in aggressive run is misleading — plane was crashed/respawned part of the time
