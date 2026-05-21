// Constants and initializations
const CHUNK_SIZE = 50;
const RENDER_DISTANCE = 5;
const heightScale = 20;
const baseScale = 0.02; // Base terrain scale for gentle variation
const mountainScale = 0.003; // Lower scale for more spread-out mountains
const hillScale = 0.04; // Smaller scale for rolling hills
const flatnessFactor = 0.2; // Slight undulation for base terrain
const mountainHeightMultiplier = 4.0; // Higher multiplier for dramatic peaks
const hillHeightMultiplier = 0.1; // Lower multiplier for gentle hills
const snowLevel = 0.99 * heightScale * 2; // Snow at the top 10% of the height
const chunks = new Map();

// Constants for water generation
const WATER_LEVEL = heightScale * 0.1; // Water level height
const LAKE_FREQUENCY = 0.1; // Frequency of lakes
const LAKE_SIZE = 10; // Size of lakes

// Constants for deep valley generation
const VALLEY_FREQUENCY = 0.01; // Increased frequency for very rare valleys
const VALLEY_DEPTH_MULTIPLIER = 2.0; // Reduced depth of valleys

// Simplex noise for terrain generation
const simplex = new SimplexNoise();

// Set up scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.y = 10;

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Pointer lock controls for mouse look
const controls = new THREE.PointerLockControls(camera, renderer.domElement);
document.addEventListener('click', () => controls.lock());

// Add lighting
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(50, 100, 50).normalize();
scene.add(light);



// Generate terrain chunk
function generateChunk(chunkX, chunkZ) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const colors = [];
    const indices = [];

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = x + chunkX * CHUNK_SIZE;
            const worldZ = z + chunkZ * CHUNK_SIZE;

            // Generate base uneven terrain
            const baseHeight = simplex.noise2D(worldX * baseScale, worldZ * baseScale) * heightScale * flatnessFactor;

            // Generate rolling hills
            const hillHeight = simplex.noise2D(worldX * hillScale, worldZ * hillScale) * heightScale * hillHeightMultiplier;

            // Generate tall, rare mountains
            const mountainHeight = Math.max(0, simplex.noise2D(worldX * mountainScale, worldZ * mountainScale)) * heightScale * mountainHeightMultiplier;

            // Combine base, hills, and mountains for final height
            const y = Math.floor(baseHeight + hillHeight + mountainHeight);

            vertices.push(x, y, z);

            // Set colors based on height for a biome effect
            if (y < heightScale * 0.3) {
                colors.push(0.47, 0.8, 0.47); // Green (grass)
            } else if (y < snowLevel) {
                colors.push(0.5, 0.5, 0.5); // Grey (stone)
            } else {
                colors.push(1.0, 1.0, 1.0); // White (snow)
            }

            // Add indices for faces
            if (x < CHUNK_SIZE - 1 && z < CHUNK_SIZE - 1) {
                const a = x + z * CHUNK_SIZE;
                const b = x + (z + 1) * CHUNK_SIZE;
                const c = (x + 1) + z * CHUNK_SIZE;
                const d = (x + 1) + (z + 1) * CHUNK_SIZE;
                indices.push(a, b, c, b, d, c);
            }
        }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE);
    scene.add(mesh);

    return mesh;
}

// Load chunks based on the player's position
function updateChunks() {
    const cameraChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const cameraChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    // Loop through the render distance around the player
    for (let x = cameraChunkX - RENDER_DISTANCE; x <= cameraChunkX + RENDER_DISTANCE; x++) {
        for (let z = cameraChunkZ - RENDER_DISTANCE; z <= cameraChunkZ + RENDER_DISTANCE; z++) {
            const chunkKey = `${x},${z}`;
            if (!chunks.has(chunkKey)) {
                const chunk = generateChunk(x, z);
                chunks.set(chunkKey, chunk);
            }
        }
    }

    // Remove chunks that are out of the render distance
    chunks.forEach((chunk, key) => {
        const [chunkX, chunkZ] = key.split(',').map(Number);
        if (Math.abs(chunkX - cameraChunkX) > RENDER_DISTANCE || Math.abs(chunkZ - cameraChunkZ) > RENDER_DISTANCE) {
            scene.remove(chunk);
            chunk.geometry.dispose();
            chunks.delete(key);
        }
    });
}

// Handle keyboard controls for movement
const keyboard = {};
document.addEventListener('keydown', (event) => {
    keyboard[event.code] = true;
});
document.addEventListener('keyup', (event) => {
    keyboard[event.code] = false;
});

// Animate the scene
function animate() {
    requestAnimationFrame(animate);

    updateChunks();

    // Camera movement relative to direction
    const speed = 20;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; // Lock y movement to only x and z

    if (keyboard['KeyW']) camera.position.addScaledVector(forward, speed);
    if (keyboard['KeyS']) camera.position.addScaledVector(forward, -speed);

    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    if (keyboard['KeyA']) camera.position.addScaledVector(right, -speed);
    if (keyboard['KeyD']) camera.position.addScaledVector(right, speed);

    if (keyboard['KeyE']) camera.position.y += speed; // Move up
    if (keyboard['KeyQ']) camera.position.y -= speed; // Move down

    renderer.render(scene, camera);
}

// Initialize animation
animate();
