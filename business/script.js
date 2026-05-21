const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Grid properties
const gridSize = 178;
let tileSize = 32;
const minTileSize = 16;
const maxTileSize = 64;
let offsetX = 0, offsetY = 0;

// Add a buffer for smoother panning outside the official grid boundaries
const buffer = 200;

// Generate grid data structure
const grid = Array.from({ length: gridSize }, () =>
  Array.from({ length: gridSize }, () => ({ type: 'empty', color: '#1c1c1c' }))
);

// Resource nodes and their colors
const resourceNodes = {
  crystal: { color: '#FF0000', count: 300 }, // Red for crystal
  wood: { color: '#8B4513', count: 200 }, // Brown for wood
  iron: { color: '#7E7B7A', count: 150 }, // Dull grey for iron
  diamond: { color: '#5B9BD5', count: 100 }, // Nice cyan blue for diamond
  uranium: { color: '#4CAF50', count: 50 }, // Decent green for uranium
};


// Function to scatter resources randomly on the map
function generateResources() {
  for (const resource in resourceNodes) {
    const { color, count } = resourceNodes[resource];
    for (let i = 0; i < count; i++) {
      const x = Math.floor(Math.random() * gridSize);
      const y = Math.floor(Math.random() * gridSize);
      grid[x][y] = { type: resource, color: color };
    }
  }
}

// Call to generate resources initially
generateResources();

// Set canvas dimensions to fullscreen
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  drawGrid();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Draw the grid from data structure
function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      const tile = grid[x][y];
      const posX = x * tileSize + offsetX;
      const posY = y * tileSize + offsetY;

      // Render grid only if within canvas view
      if (posX + tileSize > 0 && posX < canvas.width && posY + tileSize > 0 && posY < canvas.height) {
        ctx.fillStyle = tile.color;
        ctx.fillRect(posX, posY, tileSize, tileSize);

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.strokeRect(posX, posY, tileSize, tileSize);
      }
    }
  }
}

// WASD panning control
const panSpeed = 20;
window.addEventListener('keydown', (event) => {
  switch (event.key) {
    case 'w': offsetY += panSpeed; break;
    case 's': offsetY -= panSpeed; break;
    case 'a': offsetX += panSpeed; break;
    case 'd': offsetX -= panSpeed; break;
  }
  clampOffset();
  drawGrid();
});

// Mouse panning control
let isDragging = false;
let lastMouseX, lastMouseY;

canvas.addEventListener('mousedown', (event) => {
  isDragging = true;
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
});

canvas.addEventListener('mousemove', (event) => {
  if (isDragging) {
    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;
    offsetX += deltaX;
    offsetY += deltaY;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    clampOffset();
    drawGrid();
  }
});

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('mouseleave', () => { isDragging = false; });

// Zoom control with mouse wheel
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const zoomAmount = event.deltaY * -0.01;
  const newTileSize = Math.max(minTileSize, Math.min(maxTileSize, tileSize + zoomAmount * tileSize));
  
  // Adjust offset to zoom towards the mouse position
  const mouseX = event.clientX;
  const mouseY = event.clientY;
  offsetX = mouseX - ((mouseX - offsetX) * newTileSize) / tileSize;
  offsetY = mouseY - ((mouseY - offsetY) * newTileSize) / tileSize;

  tileSize = newTileSize;
  clampOffset();
  drawGrid();
});

// Keep the camera within bounds, allowing buffer room
function clampOffset() {
  offsetX = Math.max(canvas.width - gridSize * tileSize - buffer, Math.min(buffer, offsetX));
  offsetY = Math.max(canvas.height - gridSize * tileSize - buffer, Math.min(buffer, offsetY));
}

// Initial draw
drawGrid();
