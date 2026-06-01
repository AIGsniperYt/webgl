import SimplexNoise from 'simplex-noise';

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

const simplex = new SimplexNoise();
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
            const base = simplex.noise2D(wx * baseScale, wz * baseScale) * heightScale * flatnessFactor;
            const hill = simplex.noise2D(wx * hillScale, wz * hillScale) * heightScale * hillHeightMultiplier;
            const mountain = Math.max(0, simplex.noise2D(wx * mountainScale, wz * mountainScale)) * heightScale * mountainHeightMultiplier;
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
