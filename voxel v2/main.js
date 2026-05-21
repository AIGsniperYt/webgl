// Initialize scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Initialize the world as a hashmap
const world = {};

// Function to set a block at a specific position
function setBlock(x, y, z, blockType) {
    const key = `${x},${y},${z}`;
    if (blockType === null) {
        delete world[key]; // Remove block
    } else {
        world[key] = blockType; // Add block
    }
}

// Function to get a block at a specific position
function getBlock(x, y, z) {
    const key = `${x},${y},${z}`;
    return world[key] || null;
}

class Chunk {
    constructor(x, y, z) {
        this.position = { x, y, z };
        this.blocks = {};
        this.gridSize = 32; // 32x32x32 chunks
        this.generateMesh(); // Generate and populate blocks upon creation
    }

    // Set a block in this chunk
    setBlock(x, y, z, blockType) {
        const key = `${x},${y},${z}`;
        if (blockType === null) {
            delete this.blocks[key];
        } else {
            this.blocks[key] = blockType;
        }
    }

    // Get a block from this chunk
    getBlock(x, y, z) {
        const key = `${x},${y},${z}`;
        return this.blocks[key] || null;
    }

    // Generate random mesh
    generateMesh() {
        for (let x = 0; x < this.gridSize; x++) {
            for (let y = 0; y < this.gridSize; y++) {
                for (let z = 0; z < this.gridSize; z++) {
                    const rand = Math.random();
                    let blockType;
                    if (rand < 0.5) blockType = 1; // Grass
                    else if (rand < 0.8) blockType = 2; // Stone
                    else blockType = 3; // Water
                    this.setBlock(x, y, z, blockType);
                }
            }
        }
    }
}

// Example usage:
const chunk = new Chunk(0, 0, 0); // 32x32x32 chunk is automatically populated
//console.log(chunk.blocks); // Logs the blocks generated in this chunk


// Create a 20x3x20 grid of blocks (only storing non-empty blocks)
const cubeSize = 1; // Size of each cube
const gridSizeX = 20;
const gridSizeY = 3;
const gridSizeZ = 20;

for (let x = 0; x < gridSizeX; x++) {
    for (let y = 0; y < gridSizeY; y++) {
        for (let z = 0; z < gridSizeZ; z++) {
            const rand = Math.random();
            let blockType;
            if (rand < 0.5) blockType = 1; // Grass
            else if (rand < 0.8) blockType = 2; // Stone
            else blockType = 3; // Water
            setBlock(x, y, z, blockType);
        }
    }
}

// Function to create a block mesh using BufferGeometry
function createBlock(x, y, z, blockType) {
    const geometry = new THREE.BufferGeometry(); // Use BufferGeometry for optimization
    const color = blockType === 1 ? 0x00ff00 : blockType === 2 ? 0x808080 : 0x0000ff; // Grass, stone, water colors
    const material = new THREE.MeshBasicMaterial({ color: color, wireframe: false });

    // Cube vertices
    const halfSize = cubeSize / 2;
    const v = [
        new THREE.Vector3(-halfSize, -halfSize, halfSize),  // 0: front-bottom-left
        new THREE.Vector3(halfSize, -halfSize, halfSize),   // 1: front-bottom-right
        new THREE.Vector3(halfSize, halfSize, halfSize),    // 2: front-top-right
        new THREE.Vector3(-halfSize, halfSize, halfSize),   // 3: front-top-left
        new THREE.Vector3(-halfSize, -halfSize, -halfSize), // 4: back-bottom-left
        new THREE.Vector3(halfSize, -halfSize, -halfSize),  // 5: back-bottom-right
        new THREE.Vector3(halfSize, halfSize, -halfSize),   // 6: back-top-right
        new THREE.Vector3(-halfSize, halfSize, -halfSize),  // 7: back-top-left
    ];

    // Initialize arrays for vertices and indices
    const vertices = [];
    const indices = [];

    // Helper function to add a face (two triangles) to the geometry
    function addFace(v0, v1, v2, v3) {
        const idx = vertices.length / 3; // Calculate current vertex index
        vertices.push(v0.x, v0.y, v0.z);
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(v2.x, v2.y, v2.z);
        vertices.push(v3.x, v3.y, v3.z);

        indices.push(idx, idx + 1, idx + 2); // First triangle
        indices.push(idx + 2, idx + 3, idx); // Second triangle
    }

    // Check neighbors and add faces only if no adjacent block exists
    // naive culling 
    if (!getBlock(x, y, z + 1)) { // Front face
        addFace(v[0], v[1], v[2], v[3]);
    }
    if (!getBlock(x, y, z - 1)) { // Back face
        addFace(v[5], v[4], v[7], v[6]);
    }
    if (!getBlock(x + 1, y, z)) { // Right face
        addFace(v[1], v[5], v[6], v[2]);
    }
    if (!getBlock(x - 1, y, z)) { // Left face
        addFace(v[4], v[0], v[3], v[7]);
    }
    if (!getBlock(x, y + 1, z)) { // Top face
        addFace(v[3], v[2], v[6], v[7]);
    }
    if (!getBlock(x, y - 1, z)) { // Bottom face
        addFace(v[4], v[5], v[1], v[0]);
    }

    // Set the vertices and indices to the geometry
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const cube = new THREE.Mesh(geometry, material);

    // Set position of the block
    cube.position.set(
        x * cubeSize - (gridSizeX * cubeSize) / 2,
        y * cubeSize - (gridSizeY * cubeSize) / 2,
        z * cubeSize - (gridSizeZ * cubeSize) / 2
    );
    scene.add(cube);
    return cube; // Return the created cube mesh for reference
}

// Generate and add blocks to the scene based on the world hashmap
const blocks = []; // Store block references to manage wireframe mode
for (let x = 0; x < gridSizeX; x++) {
    for (let y = 0; y < gridSizeY; y++) {
        for (let z = 0; z < gridSizeZ; z++) {
            const blockType = getBlock(x, y, z);
            if (blockType) {
                const block = createBlock(x, y, z, blockType);
                blocks.push(block); // Keep track of each block
            }
        }
    }
}

// Set the camera position
camera.position.set(0, 5, 10);

// Pointer lock controls for camera
const controls = new THREE.PointerLockControls(camera, document.body);
scene.add(controls.getObject()); // Attach the camera to PointerLockControls

// Movement parameters
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, moveUp = false, moveDown = false;
const velocity = new THREE.Vector3();
const speed = 0.02; // Reduced speed for camera movement

// Event listeners for WASD and EQ keys
document.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'KeyE': moveUp = true; break;
        case 'KeyQ': moveDown = true; break;
    }
});
document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
        case 'KeyE': moveUp = false; break;
        case 'KeyQ': moveDown = false; break;
    }
});

// Toggle wireframe mode with "V"
let isWireframe = false;
document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyV') {
        isWireframe = !isWireframe; // Toggle wireframe mode
        blocks.forEach(block => block.material.wireframe = isWireframe);
    }
});

// Click to start pointer lock
document.addEventListener('click', () => {
    controls.lock();
});

// Update function to animate cube and camera movement
function animate() {
    requestAnimationFrame(animate);

    // Camera movement
    if (moveForward) velocity.z -= speed;
    if (moveBackward) velocity.z += speed;
    if (moveLeft) velocity.x += speed;
    if (moveRight) velocity.x -= speed;
    if (moveUp) velocity.y += speed;
    if (moveDown) velocity.y -= speed;

    controls.moveRight(-velocity.x); // Horizontal movement
    controls.moveForward(-velocity.z); // Forward and backward
    camera.position.y += velocity.y; // Vertical movement

    // Reset velocity after applying movement
    velocity.x *= 0.9;
    velocity.z *= 0.9;
    velocity.y *= 0.9;

    renderer.render(scene, camera);
}

// Start animation
animate();