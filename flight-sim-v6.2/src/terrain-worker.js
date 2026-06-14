const TILE_SIZE = 50;
const MAX_TILES = 4000;

const heightScale = 20;
const baseScale = 0.02;
const mountainScale = 0.003;
const hillScale = 0.04;
const flatnessFactor = 0.2;
const mountainHeightMultiplier = 4.0;
const hillHeightMultiplier = 0.1;
const continentScale = 0.0005;
const warpScale = 0.002;
const ridgeScale = 0.001;
const snowLevel = 0.99 * heightScale * 2;

function snoise2D(x, y) {
    const mod289 = (v) => v - Math.floor(v * (1 / 289)) * 289;
    const permute = (v) => mod289((v * 34 + 1) * v);
    const taylorInvSqrt = (r) => 1.79284291400159 - 0.85373472095314 * r;
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

    const Pi0 = Math.floor(x), Pi1 = Math.floor(y);
    const Pi2 = Math.floor(x) + 1, Pi3 = Math.floor(y) + 1;
    const Pf0 = x - Pi0, Pf1 = y - Pi1;
    const Pf2 = x - Pi2, Pf3 = y - Pi3;

    const p0 = mod289(Pi0), p1 = mod289(Pi1), p2 = mod289(Pi2), p3 = mod289(Pi3);

    const ix0 = p0, ix1 = p2, ix2 = p0, ix3 = p2;
    const iy0 = p1, iy1 = p1, iy2 = p3, iy3 = p3;
    const fx0 = Pf0, fx1 = Pf2, fx2 = Pf0, fx3 = Pf2;
    const fy0 = Pf1, fy1 = Pf1, fy2 = Pf3, fy3 = Pf3;

    let i0 = mod289(permute(permute(ix0) + iy0));
    let i1 = mod289(permute(permute(ix1) + iy1));
    let i2 = mod289(permute(permute(ix2) + iy2));
    let i3 = mod289(permute(permute(ix3) + iy3));

    const gx0 = (i0 * (1 / 41) - Math.floor(i0 * (1 / 41))) * 2 - 1;
    const gx1 = (i1 * (1 / 41) - Math.floor(i1 * (1 / 41))) * 2 - 1;
    const gx2 = (i2 * (1 / 41) - Math.floor(i2 * (1 / 41))) * 2 - 1;
    const gx3 = (i3 * (1 / 41) - Math.floor(i3 * (1 / 41))) * 2 - 1;
    const gy0 = ((i0 * (1 / 41) + 0.5) - Math.floor(i0 * (1 / 41) + 0.5)) * 2 - 1;
    const gy1 = ((i1 * (1 / 41) + 0.5) - Math.floor(i1 * (1 / 41) + 0.5)) * 2 - 1;
    const gy2 = ((i2 * (1 / 41) + 0.5) - Math.floor(i2 * (1 / 41) + 0.5)) * 2 - 1;
    const gy3 = ((i3 * (1 / 41) + 0.5) - Math.floor(i3 * (1 / 41) + 0.5)) * 2 - 1;

    const tx0 = Math.floor(gx0 + 0.5), tx1 = Math.floor(gx1 + 0.5);
    const tx2 = Math.floor(gx2 + 0.5), tx3 = Math.floor(gx3 + 0.5);
    const ty0 = Math.floor(gy0 + 0.5), ty1 = Math.floor(gy1 + 0.5);
    const ty2 = Math.floor(gy2 + 0.5), ty3 = Math.floor(gy3 + 0.5);

    const gx0f = gx0 - tx0, gx1f = gx1 - tx1;
    const gx2f = gx2 - tx2, gx3f = gx3 - tx3;
    const gy0f = gy0 - ty0, gy1f = gy1 - ty1;
    const gy2f = gy2 - ty2, gy3f = gy3 - ty3;

    const n0 = taylorInvSqrt(gx0f * gx0f + gy0f * gy0f);
    const n1 = taylorInvSqrt(gx2f * gx2f + gy2f * gy2f);
    const n2 = taylorInvSqrt(gx1f * gx1f + gy1f * gy1f);
    const n3 = taylorInvSqrt(gx3f * gx3f + gy3f * gy3f);

    const g00x = gx0f * n0, g00y = gy0f * n0;
    const g10x = gx1f * n2, g10y = gy1f * n2;
    const g01x = gx2f * n1, g01y = gy2f * n1;
    const g11x = gx3f * n3, g11y = gy3f * n3;

    const n00 = g00x * fx0 + g00y * fy0;
    const n10 = g10x * fx1 + g10y * fy1;
    const n01 = g01x * fx2 + g01y * fy2;
    const n11 = g11x * fx3 + g11y * fy3;

    const fadeX = fade(Pf0), fadeY = fade(Pf1);
    const nx0 = n00 + (n10 - n00) * fadeX;
    const nx1 = n01 + (n11 - n01) * fadeX;
    return 2.3 * (nx0 + (nx1 - nx0) * fadeY);
}

function ridgedNoise(x, y) {
    const n = 1.0 - Math.abs(snoise2D(x, y));
    return n * n;
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

function sigmoidStep(edge0, edge1, x) {
    const mid = (edge0 + edge1) * 0.5;
    const k = 5.0 / (edge1 - edge0);
    const t = Math.max(-10, Math.min(10, (x - mid) * k));
    return 1.0 / (1.0 + Math.exp(-t));
}

const tiles = new Map();
let _tilesGenerated = 0;

function generateTile(tileX, tileZ) {
    const data = new Float32Array(TILE_SIZE * TILE_SIZE);
    const originX = tileX * TILE_SIZE;
    const originZ = tileZ * TILE_SIZE;
    let i = 0;
    for (let z = 0; z < TILE_SIZE; z++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const wx = x + originX;
            const wz = z + originZ;

            const pf = snoise2D(wx * 0.0003, wz * 0.0003);
            let profile = 0.0;
            let t;
            t = sigmoidStep(-0.7, -0.4, pf); profile += (80.0 - profile) * t;
            t = sigmoidStep(-0.1, 0.1, pf);  profile += (200.0 - profile) * t;
            t = sigmoidStep(0.35, 0.5, pf);  profile += (400.0 - profile) * t;
            t = sigmoidStep(0.64, 0.71, pf); profile += (600.0 - profile) * t;

            const warpX = snoise2D(wx * warpScale, wz * warpScale) * 100.0;
            const warpZ = snoise2D(wx * warpScale + 5.2, wz * warpScale + 1.3) * 100.0;
            const wwx = wx + warpX;
            const wwz = wz + warpZ;

            const elevationSmooth = Math.min(1.0, profile / 40.0);
            const lowlandSmooth = 0.02 + 0.98 * elevationSmooth;
            const base = snoise2D(wwx * baseScale, wwz * baseScale) * heightScale * flatnessFactor * lowlandSmooth;
            const hill = snoise2D(wwx * hillScale, wwz * hillScale) * heightScale * hillHeightMultiplier * lowlandSmooth;

            const mountainRegion = snoise2D(wx * 0.0005, wz * 0.0005);
            let mountainMask = smoothstep(-0.2, 0.3, mountainRegion) * smoothstep(50.0, 200.0, profile);

            const biomeField = snoise2D(wx * 0.0001, wz * 0.0001);
            const desertMix = (1.0 - smoothstep(60.0, 150.0, profile)) * (1.0 - smoothstep(-0.2, 0.1, biomeField)) * smoothstep(10.0, 30.0, profile);
            mountainMask *= (1.0 - desertMix * 0.8);

            const rawMountain = Math.max(0, snoise2D(wwx * 0.0003, wwz * 0.0003));
            const mountainBase = rawMountain * rawMountain * 800.0 * mountainMask;

            const n1 = snoise2D(wwx * 0.001, wwz * 0.001) * 150.0;
            const n2 = snoise2D(wwx * 0.003, wwz * 0.003) * 50.0;
            const n3 = snoise2D(wwx * 0.009, wwz * 0.009) * 15.0;
            const n4 = ridgedNoise(wwx * 0.015, wwz * 0.015) * 10.0;
            const rockyDetail = n1 + n2 + n3 + n4;

            const r1 = ridgedNoise(wwx * 0.002, wwz * 0.002) * 150.0;
            const r2 = ridgedNoise(wwx * 0.006, wwz * 0.006) * 60.0;
            const r3 = ridgedNoise(wwx * 0.015, wwz * 0.015) * 15.0;
            const peakJaggedness = r1 + r2 + r3;
            const peakMask = smoothstep(150.0, 500.0, mountainBase);

            const mountainDetail = rockyDetail * smoothstep(10.0, 200.0, mountainBase) + peakJaggedness * peakMask;
            const mountain = mountainBase + mountainDetail;

            const rollingHill = snoise2D(wwx * 0.003, wwz * 0.003) * 8.0 * (1.0 - elevationSmooth);
            const preDetail = profile + base + hill + mountain + rollingHill;
            const elevationFactor = Math.max(0, Math.min(1, preDetail / (heightScale * 6.0)));
            const detail = snoise2D(wwx * 0.3, wwz * 0.3) * 1.0 * elevationFactor;

            let duneNoise = 0;
            duneNoise += snoise2D(wwx * 0.003, wwz * 0.003) * 20.0;
            duneNoise += Math.abs(snoise2D(wwx * 0.006, wwz * 0.006)) * 25.0;
            duneNoise += Math.abs(snoise2D(wwx * 0.012, wwz * 0.012)) * 10.0;

            const tundraMix = smoothstep(300.0, 500.0, profile);
            let tundraNoise = 0;
            tundraNoise += ridgedNoise(wwx * 0.005, wwz * 0.005) * 40.0;
            tundraNoise += ridgedNoise(wwx * 0.012, wwz * 0.012) * 15.0;

            const biomeHeight = duneNoise * desertMix + tundraNoise * tundraMix;
            data[i++] = preDetail + detail + biomeHeight;
        }
    }
    return data;
}

function getTile(tileX, tileZ) {
    const key = `${tileX},${tileZ}`;
    let tile = tiles.get(key);
    if (!tile) {
        if (tiles.size >= MAX_TILES) {
            const toEvict = MAX_TILES >> 3;
            let evicted = 0;
            for (const k of tiles.keys()) {
                if (evicted >= toEvict) break;
                tiles.delete(k);
                evicted++;
            }
        }
        tile = generateTile(tileX, tileZ);
        _tilesGenerated++;
        tiles.set(key, tile);
    } else {
        tiles.delete(key);
        tiles.set(key, tile);
    }
    return tile;
}

function getHeight(worldX, worldZ) {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileZ = Math.floor(worldZ / TILE_SIZE);
    const ix = Math.floor(worldX - tileX * TILE_SIZE);
    const iz = Math.floor(worldZ - tileZ * TILE_SIZE);
    const tile = getTile(tileX, tileZ);
    return tile[iz * TILE_SIZE + ix];
}

const clampVal = (val, min, max) => Math.max(min, Math.min(max, val));
const smoothstepVal = (edge0, edge1, x) => {
    const t = clampVal((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
};
const mixColors = (c1, c2, t) => ({
    r: c1.r + (c2.r - c1.r) * t,
    g: c1.g + (c2.g - c1.g) * t,
    b: c1.b + (c2.b - c1.b) * t
});
const addWeighted = (c1, w1, c2, w2, c3, w3) => ({
    r: c1.r * w1 + c2.r * w2 + c3.r * w3,
    g: c1.g * w1 + c2.g * w2 + c3.g * w3,
    b: c1.b * w1 + c2.b * w2 + c3.b * w3
});

function getTerrainColorAt(worldX, worldZ) {
    const h = getHeight(worldX, worldZ);
    const moisture = snoise2D(worldX * 0.002, worldZ * 0.002) * 0.5 + 0.5;
    const m = Math.max(0, Math.min(1, moisture));
    const bf = snoise2D(worldX * 0.0001, worldZ * 0.0001);

    const sand = { r: 0.831, g: 0.706, b: 0.514 };
    const savanna = { r: 0.722, g: 0.659, b: 0.290 };
    const dryGrass = { r: 0.604, g: 0.584, b: 0.353 };
    const rainforest = { r: 0.176, g: 0.420, b: 0.118 };
    const shrubland = { r: 0.478, g: 0.502, b: 0.196 };
    const forest = { r: 0.227, g: 0.490, b: 0.204 };
    const tundra = { r: 0.541, g: 0.604, b: 0.541 };
    const snow = { r: 0.941, g: 0.941, b: 0.961 };

    const lowlandBlend = smoothstepVal(10.0, 30.0, h);
    const desertW = 1.0 - smoothstepVal(-0.4, -0.1, bf);
    const rainforestW = smoothstepVal(0.1, 0.4, bf);
    const grasslandW = 1.0 - desertW - rainforestW;
    const desertPalette = mixColors(sand, savanna, m);
    const grasslandPalette = mixColors(dryGrass, rainforest, m);
    const rainforestPalette = mixColors(shrubland, rainforest, m);
    const biomeLowCol = addWeighted(desertPalette, desertW, grasslandPalette, grasslandW, rainforestPalette, rainforestW);
    const lowCol = mixColors(grasslandPalette, biomeLowCol, lowlandBlend);
    const midCol = mixColors(shrubland, forest, m);
    const highCol = tundra;

    const t1 = smoothstepVal(80.0, 150.0, h);
    const t2 = smoothstepVal(300.0, 500.0, h);
    const t3 = smoothstepVal(500.0, 650.0, h);

    let col = mixColors(lowCol, midCol, t1);
    col = mixColors(col, highCol, t2);
    col = mixColors(col, snow, t3);

    if (h < 8.0) {
        col = { r: 0.0, g: 0.25, b: 0.45 };
    }

    return {
        r: Math.round(col.r * 255),
        g: Math.round(col.g * 255),
        b: Math.round(col.b * 255)
    };
}

function getTileStats() {
    return { tiles: tiles.size, tilesGenerated: _tilesGenerated };
}

self.onmessage = function(e) {
    const msg = e.data;

    switch (msg.type) {
        case 'getHeight':
            const h = getHeight(msg.x, msg.z);
            self.postMessage({ type: 'heightResult', id: msg.id, height: h });
            break;

        case 'getTile': {
            const key = `${msg.tileX},${msg.tileZ}`;
            let tile = tiles.get(key);
            if (!tile) {
                tile = getTile(msg.tileX, msg.tileZ);
            }
            const copy = new Float32Array(tile);
            self.postMessage({
                type: 'tileResult',
                tileX: msg.tileX,
                tileZ: msg.tileZ,
                data: copy.buffer
            }, [copy.buffer]);
            break;
        }

        case 'getColor': {
            const c = getTerrainColorAt(msg.x, msg.z);
            self.postMessage({ type: 'colorResult', id: msg.id, r: c.r, g: c.g, b: c.b });
            break;
        }

        case 'getMinimap': {
            const { id, centerX, centerZ, width, height, step, halfMap } = msg;
            const data = new Uint8ClampedArray(width * height * 4);
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const wx = centerX + x * step - halfMap;
                    const wz = centerZ + y * step - halfMap;
                    const c = getTerrainColorAt(wx, wz);
                    const idx = (x + y * width) * 4;
                    data[idx] = c.r;
                    data[idx + 1] = c.g;
                    data[idx + 2] = c.b;
                    data[idx + 3] = 255;
                }
            }
            self.postMessage({ type: 'minimapResult', id, data: data.buffer }, [data.buffer]);
            break;
        }

        case 'prefetch': {
            const { px, pz, radius } = msg;
            const tileCX = Math.floor(px / TILE_SIZE);
            const tileCZ = Math.floor(pz / TILE_SIZE);
            const tileRadius = Math.ceil(radius / TILE_SIZE);
            const generated = [];

            for (let tx = tileCX - tileRadius; tx <= tileCX + tileRadius; tx++) {
                for (let tz = tileCZ - tileRadius; tz <= tileCZ + tileRadius; tz++) {
                    const key = `${tx},${tz}`;
                    if (!tiles.has(key)) {
                        if (tiles.size >= MAX_TILES) {
                            const toEvict = MAX_TILES >> 3;
                            let evicted = 0;
                            for (const k of tiles.keys()) {
                                if (evicted >= toEvict) break;
                                tiles.delete(k);
                                evicted++;
                            }
                        }
                        const tile = generateTile(tx, tz);
                        _tilesGenerated++;
                        tiles.set(key, tile);
                        generated.push({ tileX: tx, tileZ: tz, data: tile.buffer });
                    }
                }
            }

            if (generated.length > 0) {
                const tileCopies = generated.map(g => ({
                    tileX: g.tileX,
                    tileZ: g.tileZ,
                    data: new Float32Array(tiles.get(`${g.tileX},${g.tileZ}`)).buffer
                }));
                const transfers = tileCopies.map(g => g.data);
                self.postMessage({ type: 'prefetchTiles', tiles: tileCopies, tileCount: tiles.size, tilesGenerated: _tilesGenerated }, transfers);
            } else {
                self.postMessage({ type: 'prefetchTiles', tiles: [], tileCount: tiles.size, tilesGenerated: _tilesGenerated });
            }
            break;
        }

        case 'clearCache':
            tiles.clear();
            _tilesGenerated = 0;
            break;
    }
};
