// Initialize scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Create the cube with solid gray color
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0x808080 }); // Solid gray color
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

// Set cube position
cube.position.set(0, 0, -5);

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
        case 'KeyW':
            moveForward = true;
            break;
        case 'KeyS':
            moveBackward = true;
            break;
        case 'KeyA': // Move left
            moveLeft = true;
            break;
        case 'KeyD': // Move right
            moveRight = true;
            break;
        case 'KeyE':
            moveUp = true;
            break;
        case 'KeyQ':
            moveDown = true;
            break;
    }
});
document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW':
            moveForward = false;
            break;
        case 'KeyS':
            moveBackward = false;
            break;
        case 'KeyA':
            moveLeft = false;
            break;
        case 'KeyD':
            moveRight = false;
            break;
        case 'KeyE':
            moveUp = false;
            break;
        case 'KeyQ':
            moveDown = false;
            break;
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
    if (moveLeft) velocity.x += speed; // Move left
    if (moveRight) velocity.x -= speed; // Move right
    if (moveUp) velocity.y += speed;
    if (moveDown) velocity.y -= speed;

    controls.moveRight(-velocity.x); // Horizontal movement
    controls.moveForward(-velocity.z); // Forward and backward
    camera.position.y += velocity.y; // Vertical movement

    velocity.x *= 0.9; // Damping for smooth movement
    velocity.z *= 0.9;
    velocity.y *= 0.9;

    renderer.render(scene, camera);
}

animate();
