import * as THREE from 'three';
import { clearCache as clearTerrainCache } from './terrain.js';

const simplexNoiseGLSL = `
// GLSL textureless classic 2D noise "cnoise",
// with an RSL-style periodic variant "pnoise".
// Author:  Stefan Gustavson (stefan.gustavson@liu.se)
// Version: 2011-08-22
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }
float snoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0 ;
  vec4 gy = fract(i * (1.0 / 41.0) + 0.5) * 2.0 - 1.0 ;
  vec4 tx = floor(gx + 0.5);
  vec4 ty = floor(gy + 0.5);
  gx = gx - tx;
  gy = gy - ty;
  vec2 g00 = vec2(gx.x,gy.x);
  vec2 g10 = vec2(gx.y,gy.y);
  vec2 g01 = vec2(gx.z,gy.z);
  vec2 g11 = vec2(gx.w,gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  float n_xy = mix(n_x.x, n_x.y, fade_xy.y);
  return 2.3 * n_xy;
}

float ridgedNoise(vec2 p) {
    float n = 1.0 - abs(snoise(p));
    return n * n;
}

// Softer alternative to smoothstep: logistic sigmoid with adjustable steepness.
// Approaches 0/1 asymptotically, making transitions begin and end more gradually.
// This reduces the "hard band" look where plateau edges start sloping abruptly.
float sigmoidStep(float edge0, float edge1, float x) {
    float mid = (edge0 + edge1) * 0.5;
    float k = 5.0 / (edge1 - edge0);
    float t = clamp((x - mid) * k, -10.0, 10.0);
    return 1.0 / (1.0 + exp(-t));
}

float computeHeight(float wx, float wz, float baseScale, float hillScale, float mountainScale, float heightScale, float flatnessFactor, float hillHeightMultiplier, float mountainHeightMultiplier, float continentScale, float warpScale, float ridgeScale) {
    vec2 pos = vec2(wx, wz);

    // Height profile — a shaping field passed through a staircase function.
    // Transition widths decrease exponentially with height (0.3 → 0.2 → 0.15 → 0.07)
    // so lower tiers roll gently and only the highest tier is dramatically sharp.
    // The 0m lowland tier is kept rare so it can hold lakes.
    float pf = snoise(pos * 0.0003);
    float profile = 0.0;
    float t;
    t = sigmoidStep(-0.7, -0.4, pf);  profile = mix(0.0, 80.0, t);
    t = sigmoidStep(-0.1, 0.1, pf);   profile = mix(profile, 200.0, t);
    t = sigmoidStep(0.35, 0.5, pf);   profile = mix(profile, 400.0, t);
    t = sigmoidStep(0.64, 0.71, pf);  profile = mix(profile, 600.0, t);

    float warpX = snoise(pos * warpScale) * 100.0;
    float warpZ = snoise(pos * warpScale + vec2(5.2, 1.3)) * 100.0;
    vec2 warpPos = pos + vec2(warpX, warpZ);
    
    float base = snoise(warpPos * baseScale) * heightScale * flatnessFactor;
    float hill = snoise(warpPos * hillScale) * heightScale * hillHeightMultiplier;

    float mountainRegion = snoise(pos * 0.0005);
    float continentCheck = snoise(pos * continentScale) * heightScale * 2.0;
    float mountainMask = smoothstep(-0.2, 0.3, mountainRegion) * smoothstep(50.0, 200.0, profile);

    // Large-scale biome field: controls terrain shape modifiers (desert dunes, tundra ruggedness)
    // Period ~20000 units — takes ~100 seconds to fly across at cruise speed.
    // A single biome fills most of the visible horizon (5000 units).
    float biomeField = snoise(pos * 0.0001);

    // Desert: low elevation + dry biome field value
    // Exclude the 0m lowlands (future lake beds) — no dunes in basins
    float desertMix = (1.0 - smoothstep(60.0, 150.0, profile)) * (1.0 - smoothstep(-0.2, 0.1, biomeField)) * smoothstep(10.0, 30.0, profile);
    // Reduce mountains in deserts (flat sand seas shouldn't have peaks)
    mountainMask *= (1.0 - desertMix * 0.8);

    float rawMountain = max(0.0, snoise(warpPos * 0.0003));
    float mountainBase = rawMountain * rawMountain * 800.0 * mountainMask;

    float n1 = snoise(warpPos * 0.001) * 150.0;
    float n2 = snoise(warpPos * 0.003) * 50.0;
    float n3 = snoise(warpPos * 0.009) * 15.0;
    float n4 = ridgedNoise(warpPos * 0.015) * 10.0;
    float rockyDetail = n1 + n2 + n3 + n4;
    
    float r1 = ridgedNoise(warpPos * 0.002) * 150.0;
    float r2 = ridgedNoise(warpPos * 0.006) * 60.0;
    float r3 = ridgedNoise(warpPos * 0.015) * 15.0;
    float peakJaggedness = r1 + r2 + r3;
    float peakMask = smoothstep(150.0, 500.0, mountainBase);
    
    float mountainDetail = rockyDetail * smoothstep(10.0, 200.0, mountainBase) + peakJaggedness * peakMask;
    float mountain = mountainBase + mountainDetail;

    float preDetail = profile + base + hill + mountain;
    float elevationFactor = clamp(preDetail / (heightScale * 6.0), 0.0, 1.0);
    float detail = snoise(warpPos * 0.3) * 1.0 * elevationFactor;

    // --- Biome terrain modifiers ---
    // Desert dunes: asymmetric abs-noise creates wind-blown dune shapes
    float duneNoise = 0.0;
    duneNoise += snoise(warpPos * 0.003) * 20.0;     // broad dune base
    duneNoise += abs(snoise(warpPos * 0.006)) * 25.0; // primary dune ridges
    duneNoise += abs(snoise(warpPos * 0.012)) * 10.0; // secondary dune ripples

    // Tundra: extra ridged noise for rugged alpine terrain at high elevation
    float tundraMix = smoothstep(300.0, 500.0, profile);
    float tundraNoise = 0.0;
    tundraNoise += ridgedNoise(warpPos * 0.005) * 40.0;
    tundraNoise += ridgedNoise(warpPos * 0.012) * 15.0;

    float biomeHeight = duneNoise * desertMix + tundraNoise * tundraMix;
    return preDetail + detail + biomeHeight;
}
`;

const CHUNK_SIZE = 50;
const RENDER_DISTANCE_NEAR = 5;
const RENDER_DISTANCE_MID = 12;
const RENDER_DISTANCE_FAR = 25;
const RENDER_DISTANCE_ULTRA = 50;
const RENDER_DISTANCE_HORIZON = 100;

let visibleChunks = 0;
let showGaps = false;

const LOD_CONFIGS = {
    near: { step: 1, scale: 1.0, maxChunks: 250 },
    mid: { step: 5, scale: 0.5, maxChunks: 700 },
    far: { step: 10, scale: 0.1, maxChunks: 2400 },
    ultra: { step: 25, scale: 0.02, maxChunks: 8700 },
    horizon: { step: 50, scale: 0.001, maxChunks: 32000 }
};

const LOD_HEIGHT_RANGES = {
    near: { min: -10, max: 1000 },
    mid: { min: -5, max: 800 },
    far: { min: -2, max: 400 },
    ultra: { min: -1, max: 100 },
    horizon: { min: -1, max: 25 }
};
const FRUSTUM_MARGIN = CHUNK_SIZE;

const mergedMeshes = { near: {}, mid: {}, far: {}, ultra: {}, horizon: {} };
const globalChunks = new Map();
const precomputedIndices = {};
let initialized = false;
let _lastCamCX = null, _lastCamCZ = null;
const _newActive = new Set();
const _toAdd = [];
const _toRemove = [];
let _chunkGenTime = 0, _chunksAdded = 0, _chunksRemoved = 0, _chunksHidden = 0, _chunksUnhidden = 0;
const _terrainMaterials = [];
const _frustumBBox = new THREE.Box3();
let _frustumDir = null;
const _camDir = new THREE.Vector3();
let _frustumEvalTime = 0;

export function toggleWireframe() {
    const on = !_terrainMaterials[0]?.wireframe;
    for (const m of _terrainMaterials) m.wireframe = on;
    return on;
}
export function getWireframe() {
    return _terrainMaterials[0]?.wireframe ?? false;
}

export function getChunkSize() {
    return CHUNK_SIZE;
}

export function getChunkStats() {
    const stats = {
        visibleChunks,
        totalChunks: globalChunks.size,
        chunkGenTime: _chunkGenTime,
        chunksAdded: _chunksAdded,
        chunksRemoved: _chunksRemoved,
        chunksHidden: _chunksHidden,
        chunksUnhidden: _chunksUnhidden,
        frustumEvalTime: _frustumEvalTime
    };
    _chunkGenTime = 0;
    _chunksAdded = 0;
    _chunksRemoved = 0;
    _chunksHidden = 0;
    _chunksUnhidden = 0;
    _frustumEvalTime = 0;
    return stats;
}

export function getShowGaps() {
    return showGaps;
}

export function toggleGapMode(scene) {
    showGaps = !showGaps;
    
    if (initialized) {
        for (const lod of ["near", "mid", "far", "ultra", "horizon"]) {
            const bucket = mergedMeshes[lod];
            scene.remove(bucket.mesh);
            bucket.geometry.dispose();
            bucket.mesh.material.dispose();
        }
        initialized = false;
    }

    for (const key in precomputedIndices) {
        delete precomputedIndices[key];
    }
    globalChunks.clear();
    clearTerrainCache();
    _lastCamCX = null;
    return showGaps;
}

function getIndicesForLOD(lod) {
    const cacheKey = `${lod}_${showGaps ? 'g' : 's'}`;
    if (precomputedIndices[cacheKey]) return precomputedIndices[cacheKey];

    const config = LOD_CONFIGS[lod];
    const step = config.step;
    const vertsPerSide = showGaps
        ? CHUNK_SIZE / step
        : CHUNK_SIZE / step + 1;
    const indices = [];

    for (let row = 0; row < vertsPerSide - 1; row++) {
        for (let col = 0; col < vertsPerSide - 1; col++) {
            const a = row * vertsPerSide + col;
            const b = (row + 1) * vertsPerSide + col;
            const c = row * vertsPerSide + col + 1;
            const d = (row + 1) * vertsPerSide + col + 1;
            indices.push(a, b, c, b, d, c);
        }
    }

    precomputedIndices[cacheKey] = indices;
    return indices;
}

function initMeshes(scene) {
    for (const lod of ['near', 'mid', 'far', 'ultra', 'horizon']) {
        const config = LOD_CONFIGS[lod];
        
        const vertsPerSide = showGaps ? CHUNK_SIZE / config.step : CHUNK_SIZE / config.step + 1;
        const vertsPerChunk = vertsPerSide * vertsPerSide;
        const chunkIndices = getIndicesForLOD(lod);
        const indicesPerChunk = chunkIndices.length;
        
        const material = new THREE.MeshStandardMaterial({
            flatShading: true,
            side: THREE.DoubleSide,
            fog: true
        });
        _terrainMaterials.push(material);

        material.onBeforeCompile = (shader) => {
            shader.uniforms.baseScale = { value: 0.02 };
            shader.uniforms.hillScale = { value: 0.04 };
            shader.uniforms.mountainScale = { value: 0.003 };
            shader.uniforms.heightScale = { value: 20.0 };
            shader.uniforms.flatnessFactor = { value: 0.2 };
            shader.uniforms.hillHeightMultiplier = { value: 0.1 };
            shader.uniforms.mountainHeightMultiplier = { value: 4.0 };
            shader.uniforms.continentScale = { value: 0.0005 };
            shader.uniforms.warpScale = { value: 0.002 };
            shader.uniforms.ridgeScale = { value: 0.001 };
            shader.uniforms.moistureScale = { value: 0.002 };

            shader.vertexShader = `
                ${simplexNoiseGLSL}
                uniform float baseScale;
                uniform float hillScale;
                uniform float mountainScale;
                uniform float heightScale;
                uniform float flatnessFactor;
                uniform float hillHeightMultiplier;
                uniform float mountainHeightMultiplier;
                uniform float continentScale;
                uniform float warpScale;
                uniform float ridgeScale;
                uniform float moistureScale;
                varying float vHeight;
                varying float vMoisture;
                varying float vBiomeField;
                varying vec3 vWorldPos;
                ${shader.vertexShader}
            `;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                vec3 transformed = vec3( position );
                float h = computeHeight(transformed.x, transformed.z, baseScale, hillScale, mountainScale, heightScale, flatnessFactor, hillHeightMultiplier, mountainHeightMultiplier, continentScale, warpScale, ridgeScale);
                transformed.y = h;
                vHeight = h;
                vMoisture = snoise(vec2(transformed.x, transformed.z) * moistureScale) * 0.5 + 0.5;
                vBiomeField = snoise(vec2(transformed.x, transformed.z) * 0.0001);
                vWorldPos = vec3(transformed.x, h, transformed.z);
                `
            );

            shader.fragmentShader = `
                uniform float heightScale;
                varying float vHeight;
                varying float vMoisture;
                varying float vBiomeField;
                varying vec3 vWorldPos;
                ${shader.fragmentShader}
            `;

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `
                #include <color_fragment>
                float h = vHeight;
                float moisture = clamp(vMoisture, 0.0, 1.0);

                vec3 dx = dFdx(vWorldPos);
                vec3 dz = dFdy(vWorldPos);
                vec3 n = normalize(cross(dx, dz));
                float slopeDeg = degrees(acos(clamp(n.y, 0.0, 1.0)));
                float rockMix = smoothstep(30.0, 50.0, slopeDeg);

                vec3 sand = vec3(0.831, 0.706, 0.514);
                vec3 savanna = vec3(0.722, 0.659, 0.290);
                vec3 dryGrass = vec3(0.604, 0.584, 0.353);
                vec3 rainforest = vec3(0.176, 0.420, 0.118);
                vec3 shrubland = vec3(0.478, 0.502, 0.196);
                vec3 forest = vec3(0.227, 0.490, 0.204);
                vec3 tundra = vec3(0.541, 0.604, 0.541);
                vec3 rock = vec3(0.420, 0.420, 0.420);
                vec3 snow = vec3(0.941, 0.941, 0.961);

                // Biome field selects low-elevation colour palette
                // The very lowest elevations (0m basins, future lake beds) always use grassland
                float bf = vBiomeField;
                float lowlandBlend = smoothstep(10.0, 30.0, h);
                float desertW = 1.0 - smoothstep(-0.4, -0.1, bf);
                float rainforestW = smoothstep(0.1, 0.4, bf);
                float grasslandW = 1.0 - desertW - rainforestW;
                vec3 desertPalette = mix(sand, savanna, moisture);
                vec3 grasslandPalette = mix(dryGrass, rainforest, moisture);
                vec3 rainforestPalette = mix(shrubland, rainforest, moisture);
                vec3 biomeLowCol = desertPalette * desertW + grasslandPalette * grasslandW + rainforestPalette * rainforestW;
                vec3 lowCol = mix(grasslandPalette, biomeLowCol, lowlandBlend);
                vec3 midCol = mix(shrubland, forest, moisture);
                vec3 highCol = tundra;

                float t1 = smoothstep(80.0, 150.0, h);
                float t2 = smoothstep(300.0, 500.0, h);
                float t3 = smoothstep(500.0, 650.0, h);

                vec3 col = mix(lowCol, midCol, t1);
                col = mix(col, highCol, t2);
                col = mix(col, snow, t3);
                col = mix(col, rock, rockMix);
                diffuseColor.rgb = col;
                `
            );
        };

        const maxChunks = config.maxChunks;
        const totalVerts = maxChunks * vertsPerChunk;
        const totalIndices = maxChunks * indicesPerChunk;

        const positions = new Float32Array(totalVerts * 3);
        const indices = new Uint32Array(totalIndices);

        for (let i = 0; i < maxChunks; i++) {
            const indexOffset = i * indicesPerChunk;
            const vertexOffset = i * vertsPerChunk;
            for (let j = 0; j < indicesPerChunk; j++) {
                indices[indexOffset + j] = chunkIndices[j] + vertexOffset;
            }
            
            for (let j = 0; j < vertsPerChunk; j++) {
                positions[(vertexOffset + j) * 3] = 0;
                positions[(vertexOffset + j) * 3 + 1] = -99999;
                positions[(vertexOffset + j) * 3 + 2] = 0;
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
        
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,0,0), 1000000); 

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false; 
        scene.add(mesh);

        const freeSlots = [];
        for (let i = maxChunks - 1; i >= 0; i--) freeSlots.push(i);

        mergedMeshes[lod] = {
            mesh,
            geometry,
            freeSlots,
            activeChunks: new Map(), 
            vertsPerChunk,
            bounds: new THREE.Box3(),
            changed: false,
            dirty: false,
            visibleCount: 0
        };
    }
    initialized = true;
    _lastCamCX = null;
}

function addChunkToBucket(scene, chunkX, chunkZ, lod) {
    if (!initialized) initMeshes(scene);
    
    const bucket = mergedMeshes[lod];
    const slot = bucket.freeSlots.pop();
    
    if (slot === undefined) {
        console.warn("No free slots in bucket", lod);
        return;
    }

    const pos = bucket.geometry.attributes.position.array;

    const config = LOD_CONFIGS[lod];
    const step = config.step;
    const lodScale = config.scale;
    const maxCoord = showGaps ? CHUNK_SIZE - 1 : CHUNK_SIZE;

    let idx = slot * bucket.vertsPerChunk;

    for (let x = 0; x <= maxCoord; x += step) {
        for (let z = 0; z <= maxCoord; z += step) {
            const worldX = x + chunkX * CHUNK_SIZE;
            const worldZ = z + chunkZ * CHUNK_SIZE;

            const i3 = idx * 3;
            pos[i3] = worldX;
            pos[i3 + 1] = -99999;
            pos[i3 + 2] = worldZ;

            idx++;
        }
    }

    bucket.dirty = true;
    bucket.changed = true;

    const range = LOD_HEIGHT_RANGES[lod];
    const bbox = new THREE.Box3(
        new THREE.Vector3(chunkX * CHUNK_SIZE, range.min, chunkZ * CHUNK_SIZE),
        new THREE.Vector3((chunkX + 1) * CHUNK_SIZE, range.max, (chunkZ + 1) * CHUNK_SIZE)
    );

    const chunkKey = `${chunkX},${chunkZ}`;
    bucket.activeChunks.set(chunkKey, { slot, bbox });
}

function removeChunkFromBucket(chunkX, chunkZ, lod, skipVisDec = false) {
    const bucket = mergedMeshes[lod];
    const chunkKey = `${chunkX},${chunkZ}`;
    const chunkData = bucket.activeChunks.get(chunkKey);
    
    if (!chunkData) return;

    const pos = bucket.geometry.attributes.position.array;
    const slot = chunkData.slot;
    let idx = slot * bucket.vertsPerChunk;

    for (let i = 0; i < bucket.vertsPerChunk; i++) {
        pos[idx * 3] = 0;
        pos[idx * 3 + 1] = -99999;
        pos[idx * 3 + 2] = 0;
        idx++;
    }

    bucket.dirty = true;
    bucket.changed = true;
    bucket.freeSlots.push(slot);
    bucket.activeChunks.delete(chunkKey);
    if (!skipVisDec) bucket.visibleCount--;
}

function hideChunkInBucket(chunkX, chunkZ, lod) {
    const bucket = mergedMeshes[lod];
    const chunkKey = `${chunkX},${chunkZ}`;
    const chunkData = bucket.activeChunks.get(chunkKey);
    if (!chunkData) return;

    const pos = bucket.geometry.attributes.position.array;
    const slot = chunkData.slot;
    let idx = slot * bucket.vertsPerChunk;

    for (let i = 0; i < bucket.vertsPerChunk; i++) {
        pos[idx * 3 + 1] = -99999;
        idx++;
    }

    bucket.dirty = true;
    bucket.visibleCount--;
}

function unhideChunkInBucket(chunkX, chunkZ, lod) {
    const bucket = mergedMeshes[lod];
    const chunkKey = `${chunkX},${chunkZ}`;
    const chunkData = bucket.activeChunks.get(chunkKey);
    if (!chunkData) return;

    const pos = bucket.geometry.attributes.position.array;
    const slot = chunkData.slot;
    let idx = slot * bucket.vertsPerChunk;

    for (let i = 0; i < bucket.vertsPerChunk; i++) {
        pos[idx * 3 + 1] = 0;
        idx++;
    }

    bucket.dirty = true;
    bucket.visibleCount++;
}

export function updateChunks(scene, camera, frustum, vx = 0, vz = 0) {
    if (!initialized) initMeshes(scene);

    const cameraChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const cameraChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    const vThreshold = 10;
    const extX = Math.abs(vx) > vThreshold ? Math.sign(vx) * 2 : 0;
    const extZ = Math.abs(vz) > vThreshold ? Math.sign(vz) * 2 : 0;

    const minX = cameraChunkX - RENDER_DISTANCE_HORIZON + Math.min(0, extX);
    const maxX = cameraChunkX + RENDER_DISTANCE_HORIZON + Math.max(0, extX);
    const minZ = cameraChunkZ - RENDER_DISTANCE_HORIZON + Math.min(0, extZ);
    const maxZ = cameraChunkZ + RENDER_DISTANCE_HORIZON + Math.max(0, extZ);

    // Full scan on chunk boundary change: load ALL in-range chunks into buckets
    if (cameraChunkX !== _lastCamCX || cameraChunkZ !== _lastCamCZ) {
        _lastCamCX = cameraChunkX;
        _lastCamCZ = cameraChunkZ;

        const _start = performance.now();

        _newActive.clear();
        _toAdd.length = 0;

        for (let x = minX; x <= maxX; x++) {
            for (let z = minZ; z <= maxZ; z++) {
                const dx = Math.abs(x - cameraChunkX);
                const dz = Math.abs(z - cameraChunkZ);
                let lod = "horizon";
                if (dx <= RENDER_DISTANCE_NEAR && dz <= RENDER_DISTANCE_NEAR) lod = "near";
                else if (dx <= RENDER_DISTANCE_MID && dz <= RENDER_DISTANCE_MID) lod = "mid";
                else if (dx <= RENDER_DISTANCE_FAR && dz <= RENDER_DISTANCE_FAR) lod = "far";
                else if (dx <= RENDER_DISTANCE_ULTRA && dz <= RENDER_DISTANCE_ULTRA) lod = "ultra";

                const chunkKey = `${x},${z},${lod}`;
                _newActive.add(chunkKey);

                if (!globalChunks.has(chunkKey)) {
                    _toAdd.push({ x, z, lod, chunkKey });
                }
            }
        }

        _toRemove.length = 0;
        globalChunks.forEach((entry, key) => {
            if (!_newActive.has(key)) {
                _toRemove.push(key);
            }
        });

        for (const key of _toRemove) {
            const entry = globalChunks.get(key);
            removeChunkFromBucket(entry.chunkX, entry.chunkZ, entry.lod, entry.hidden);
            globalChunks.delete(key);
        }

        for (const item of _toAdd) {
            addChunkToBucket(scene, item.x, item.z, item.lod);
            globalChunks.set(item.chunkKey, { chunkX: item.x, chunkZ: item.z, lod: item.lod, hidden: true });
            _chunksHidden++;
        }

        _chunkGenTime = performance.now() - _start;
        _chunksAdded = _toAdd.length;
        _chunksRemoved = _toRemove.length;

        _frustumDir = null;
    }

    // Frustum re-evaluation: shows/hides chunks based on camera facing
    // Runs when camera rotates significantly (direction dot < 0.965 ≈ 15°)
    _camDir.set(0, 0, 0);
    camera.getWorldDirection(_camDir);
    const dirChanged = _frustumDir === null || _camDir.dot(_frustumDir) < 0.965;

    if (dirChanged) {
        if (!_frustumDir) _frustumDir = new THREE.Vector3();
        _frustumDir.copy(_camDir);

        _chunksHidden = 0;
        _chunksUnhidden = 0;

        const reEvalStart = performance.now();

        globalChunks.forEach((entry) => {
            const x = entry.chunkX, z = entry.chunkZ;
            const range = LOD_HEIGHT_RANGES[entry.lod];

            _frustumBBox.min.set(x * CHUNK_SIZE - FRUSTUM_MARGIN, range.min, z * CHUNK_SIZE - FRUSTUM_MARGIN);
            _frustumBBox.max.set((x + 1) * CHUNK_SIZE + FRUSTUM_MARGIN, range.max, (z + 1) * CHUNK_SIZE + FRUSTUM_MARGIN);

            if (frustum.intersectsBox(_frustumBBox)) {
                if (entry.hidden) {
                    unhideChunkInBucket(x, z, entry.lod);
                    entry.hidden = false;
                    _chunksUnhidden++;
                }
            } else {
                if (!entry.hidden) {
                    hideChunkInBucket(x, z, entry.lod);
                    entry.hidden = true;
                    _chunksHidden++;
                }
            }
        });

        _frustumEvalTime = performance.now() - reEvalStart;
    }

    visibleChunks = 0;

    for (const lod of ["near", "mid", "far", "ultra", "horizon"]) {
        const bucket = mergedMeshes[lod];
        if (bucket.dirty) {
            bucket.geometry.attributes.position.needsUpdate = true;
            bucket.dirty = false;
        }
        if (bucket.changed) {
            bucket.bounds.makeEmpty();
            for (const chunk of bucket.activeChunks.values()) {
                bucket.bounds.union(chunk.bbox);
            }
            bucket.changed = false;
        }

        bucket.mesh.visible = bucket.visibleCount > 0 && frustum.intersectsBox(bucket.bounds);
        if (bucket.mesh.visible) {
            visibleChunks += bucket.visibleCount;
        }
    }
}
