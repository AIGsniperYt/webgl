// Scene, Camera, and Renderer setup
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xaaaaaa, 0.015);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// Lighting setup
const ambientLight = new THREE.AmbientLight(0x404040, 1); // Soft light
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
directionalLight.position.set(5, 10, 7.5);
directionalLight.castShadow = true;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
scene.add(directionalLight);

// Block types with lighting materials
const blockTypes = {
    water: new THREE.MeshStandardMaterial({ color: 0x1e90ff, roughness: 0.5, metalness: 0.2 }),
    grass: new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.7, metalness: 0.1 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x696969, roughness: 0.8, metalness: 0.2 }),
};

// Wireframe toggle using 'V' key
let wireframeEnabled = false;
document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyV') {
        wireframeEnabled = !wireframeEnabled;
        for (let block of scene.children) {
            if (block.isMesh) block.material.wireframe = wireframeEnabled;
        }
    }
});

// Generate a single chunk (8x8x8) with random block types
const chunkSize = 8;
function generateChunk(xOffset, yOffset, zOffset) {
    const chunk = new Map();
    for (let x = 0; x < chunkSize; x++) {
        for (let y = 0; y < chunkSize; y++) {
            for (let z = 0; z < chunkSize; z++) {
                const blockPos = `${x},${y},${z}`;
                const blockType = getRandomBlockType();
                chunk.set(blockPos, blockType);
            }
        }
    }

    for (let x = 0; x < chunkSize; x++) {
        for (let y = 0; y < chunkSize; y++) {
            for (let z = 0; z < chunkSize; z++) {
                const blockPos = `${x},${y},${z}`;
                const blockType = chunk.get(blockPos);
                if (blockType === blockTypes.air) continue;

                if (isAir(chunk, x + 1, y, z)) addFace(x + xOffset * chunkSize, y + yOffset * chunkSize, z + zOffset * chunkSize, 'right', blockType);
                if (isAir(chunk, x - 1, y, z)) addFace(x + xOffset * chunkSize, y + yOffset * chunkSize, z + zOffset * chunkSize, 'left', blockType);
                if (isAir(chunk, x, y + 1, z)) addFace(x + xOffset * chunkSize, y + yOffset * chunkSize, z + zOffset * chunkSize, 'top', blockType);
                if (isAir(chunk, x, y - 1, z)) addFace(x + xOffset * chunkSize, y + yOffset * chunkSize, z + zOffset * chunkSize, 'bottom', blockType);
                if (isAir(chunk, x, y, z + 1)) addFace(x + xOffset * chunkSize, y + yOffset * chunkSize, z + zOffset * chunkSize, 'front', blockType);
                if (isAir(chunk, x, y, z - 1)) addFace(x + xOffset * chunkSize, y + yOffset * chunkSize, z + zOffset * chunkSize, 'back', blockType);
            }
        }
    }
    return chunk;
}

function isAir(chunk, x, y, z) {
    if (x < 0 || x >= chunkSize || y < 0 || z < 0 || z >= chunkSize) return true;
    return chunk.get(`${x},${y},${z}`) === blockTypes.air;
}

function addFace(x, y, z, direction, blockType) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const face = new THREE.Mesh(geometry, blockType);
    face.castShadow = true;
    face.receiveShadow = true;

    switch (direction) {
        case 'right': face.position.set(x + 0.5, y, z); face.rotation.y = Math.PI / 2; break;
        case 'left': face.position.set(x - 0.5, y, z); face.rotation.y = -Math.PI / 2; break;
        case 'top': face.position.set(x, y + 0.5, z); face.rotation.x = -Math.PI / 2; break;
        case 'bottom': face.position.set(x, y - 0.5, z); face.rotation.x = Math.PI / 2; break;
        case 'front': face.position.set(x, y, z + 0.5); break;
        case 'back': face.position.set(x, y, z - 0.5); face.rotation.y = Math.PI; break;
    }

    scene.add(face);
}

function getRandomBlockType() {
    const types = [blockTypes.water, blockTypes.grass, blockTypes.stone];
    return types[Math.floor(Math.random() * types.length)];
}

// Chunk Management and Camera Control
const world = new Map();
const chunkDistance = 1;
const loadedChunks = new Map();

function generateChunkAt(xOffset, yOffset, zOffset) {
    const chunkPos = `${xOffset},${yOffset},${zOffset}`;
    if (!loadedChunks.has(chunkPos)) {
        const chunk = generateChunk(xOffset, yOffset, zOffset);
        loadedChunks.set(chunkPos, chunk);
        world.set(chunkPos, chunk);
    }
}

function unloadFarChunks(cameraChunkPos) {
    for (let chunkPos of loadedChunks.keys()) {
        const [chunkX, chunkY, chunkZ] = chunkPos.split(',').map(Number);
        const distX = Math.abs(chunkX - cameraChunkPos.x);
        const distZ = Math.abs(chunkZ - cameraChunkPos.z);

        if (distX > chunkDistance || distZ > chunkDistance) {
            const chunk = loadedChunks.get(chunkPos);
            removeChunkFromScene(chunk);
            loadedChunks.delete(chunkPos);
        }
    }
}

function removeChunkFromScene(chunk) {
    for (let [blockPos, blockType] of chunk) {
        const [x, y, z] = blockPos.split(',').map(Number);
        // Logic to remove block face objects from the scene goes here
    }
}

function getCameraChunkPos() {
    return { x: Math.floor(camera.position.x / chunkSize), z: Math.floor(camera.position.z / chunkSize) };
}

function updateChunks() {
    const cameraChunkPos = getCameraChunkPos();
    for (let dx = -chunkDistance; dx <= chunkDistance; dx++) {
        for (let dz = -chunkDistance; dz <= chunkDistance; dz++) {
            generateChunkAt(cameraChunkPos.x + dx, 0, cameraChunkPos.z + dz);
        }
    }
    unloadFarChunks(cameraChunkPos);
}

// Camera position
camera.position.set(0, 1.6, 10);

// PointerLockControls for movement
const controls = new THREE.PointerLockControls(camera, document.body);
document.addEventListener('click', () => controls.lock());

// Movement with damping and velocity
const keys = { forward: false, backward: false, left: false, right: false, up: false, down: false };
let velocity = { x: 0, y: 0, z: 0 };
const moveSpeed = 0.05;

document.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'KeyW': keys.forward = true; break;
        case 'KeyS': keys.backward = true; break;
        case 'KeyA': keys.left = true; break;
        case 'KeyD': keys.right = true; break;
        case 'KeyE': keys.up = true; break;
        case 'KeyQ': keys.down = true; break;
    }
});

document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW': keys.forward = false; break;
        case 'KeyS': keys.backward = false; break;
        case 'KeyA': keys.left = false; break;
        case 'KeyD': keys.right = false; break;
        case 'KeyE': keys.up = false; break;
        case 'KeyQ': keys.down = false; break;
    }
});

// Update movement
function updateMovement() {
    velocity.x -= velocity.x * 0.1;
    velocity.z -= velocity.z * 0.1;
    velocity.y -= velocity.y * 0.1;

    if (keys.forward) velocity.z -= moveSpeed;
    if (keys.backward) velocity.z += moveSpeed;
    if (keys.left) velocity.x -= moveSpeed;
    if (keys.right) velocity.x += moveSpeed;
    if (keys.up) velocity.y += moveSpeed;
    if (keys.down) velocity.y -= moveSpeed;

    controls.moveRight(velocity.x);
    controls.moveForward(-velocity.z);
    camera.position.y += velocity.y;
}

scene.background = new THREE.Color(0x87CEEB); // Light blue (day)

// Render Loop
function animate() {
    requestAnimationFrame(animate);
    updateMovement();
    updateChunks();
    renderer.render(scene, camera);
}

animate();
