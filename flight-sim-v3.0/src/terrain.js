const TILE_SIZE = 50;
const MAX_TILES = 2000;

const heightScale = 20;
const baseScale = 0.02;
const mountainScale = 0.003;
const hillScale = 0.04;
const flatnessFactor = 0.2;
const mountainHeightMultiplier = 4.0;
const hillHeightMultiplier = 0.1;

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
    const gy0 = Math.abs(gx0) - 0.5, gy1 = Math.abs(gx1) - 0.5;
    const gy2 = Math.abs(gx2) - 0.5, gy3 = Math.abs(gx3) - 0.5;

    const tx0 = Math.floor(gx0 + 0.5), tx1 = Math.floor(gx1 + 0.5);
    const tx2 = Math.floor(gx2 + 0.5), tx3 = Math.floor(gx3 + 0.5);

    const gx0f = gx0 - tx0, gx1f = gx1 - tx1;
    const gx2f = gx2 - tx2, gx3f = gx3 - tx3;

    const n0 = taylorInvSqrt(gx0f * gx0f + gy0 * gy0);
    const n1 = taylorInvSqrt(gx2f * gx2f + gy2 * gy2);
    const n2 = taylorInvSqrt(gx1f * gx1f + gy1 * gy1);
    const n3 = taylorInvSqrt(gx3f * gx3f + gy3 * gy3);

    const g00x = gx0f * n0, g00y = gy0 * n0;
    const g10x = gx1f * n2, g10y = gy1 * n2;
    const g01x = gx2f * n1, g01y = gy2 * n1;
    const g11x = gx3f * n3, g11y = gy3 * n3;

    const n00 = g00x * fx0 + g00y * fy0;
    const n10 = g10x * fx1 + g10y * fy1;
    const n01 = g01x * fx2 + g01y * fy2;
    const n11 = g11x * fx3 + g11y * fy3;

    const fadeX = fade(Pf0), fadeY = fade(Pf1);
    const nx0 = n00 + (n10 - n00) * fadeX;
    const nx1 = n01 + (n11 - n01) * fadeX;
    return 2.3 * (nx0 + (nx1 - nx0) * fadeY);
}

const tiles = new Map();
let _cachedTileKey = null;
let _cachedTile = null;
let _tileHits = 0, _tileMisses = 0, _tilesGenerated = 0, _tileEvictions = 0;

function generateTile(tileX, tileZ) {
    const data = new Float32Array(TILE_SIZE * TILE_SIZE);
    const originX = tileX * TILE_SIZE;
    const originZ = tileZ * TILE_SIZE;
    let i = 0;
    for (let z = 0; z < TILE_SIZE; z++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const wx = x + originX;
            const wz = z + originZ;
            const base = snoise2D(wx * baseScale, wz * baseScale) * heightScale * flatnessFactor;
            const hill = snoise2D(wx * hillScale, wz * hillScale) * heightScale * hillHeightMultiplier;
            const mountain = Math.max(0, snoise2D(wx * mountainScale, wz * mountainScale)) * heightScale * mountainHeightMultiplier;
            data[i++] = base + hill + mountain;
        }
    }
    return data;
}

export function getHeight(worldX, worldZ) {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileZ = Math.floor(worldZ / TILE_SIZE);
    const ix = Math.floor(worldX - tileX * TILE_SIZE);
    const iz = Math.floor(worldZ - tileZ * TILE_SIZE);

    const key = `${tileX},${tileZ}`;
    let tile = key === _cachedTileKey ? _cachedTile : tiles.get(key);

    if (!tile) {
        _tileMisses++;
        if (tiles.size >= MAX_TILES) {
            const toEvict = MAX_TILES >> 2;
            let evicted = 0;
            for (const k of tiles.keys()) {
                if (evicted >= toEvict) break;
                tiles.delete(k);
                evicted++;
            }
            _tileEvictions += toEvict;
        }
        tile = generateTile(tileX, tileZ);
        _tilesGenerated++;
        tiles.set(key, tile);
    } else if (key !== _cachedTileKey) {
        _tileHits++;
        tiles.delete(key);
        tiles.set(key, tile);
    } else {
        _tileHits++;
    }

    _cachedTileKey = key;
    _cachedTile = tile;
    return tile[iz * TILE_SIZE + ix];
}

export function getHeightScaled(worldX, worldZ, lodScale = 1.0) {
    return Math.floor(getHeight(worldX, worldZ) * lodScale);
}

export function getTerrainColorAt(worldX, worldZ) {
    const y = getHeight(worldX, worldZ);

    if (y < heightScale * 0.3) {
        return { r: 120, g: 204, b: 120 };
    }

    if (y < snowLevel) {
        const shade = Math.max(120, Math.min(190, 128 + y * 1.5));
        return { r: shade, g: shade, b: shade };
    }

    return { r: 245, g: 245, b: 245 };
}

export function getTerrainStats() {
    const stats = {
        tiles: tiles.size,
        tileHits: _tileHits,
        tileMisses: _tileMisses,
        tilesGenerated: _tilesGenerated,
        tileEvictions: _tileEvictions
    };
    _tileHits = 0;
    _tileMisses = 0;
    return stats;
}

export function clearCache() {
    tiles.clear();
    _cachedTileKey = null;
    _cachedTile = null;
}

export function getColorComponents(y) {
    if (y < heightScale * 0.3) return { r: 0.47, g: 0.8, b: 0.47 };
    if (y < snowLevel) return { r: 0.5, g: 0.5, b: 0.5 };
    return { r: 1.0, g: 1.0, b: 1.0 };
}
