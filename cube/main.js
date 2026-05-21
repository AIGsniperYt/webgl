const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl");

// Check if WebGL is supported
if (!gl) {
  alert("WebGL not supported");
}

// Set the clear color to black and enable depth testing
gl.clearColor(0.0, 0.0, 0.0, 1.0);
gl.enable(gl.DEPTH_TEST);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

// Define the cube vertices
const vertices = new Float32Array([
  // Front face
  -0.5, -0.5,  0.5,
   0.5, -0.5,  0.5,
   0.5,  0.5,  0.5,
  -0.5,  0.5,  0.5,

  // Back face
  -0.5, -0.5, -0.5,
   0.5, -0.5, -0.5,
   0.5,  0.5, -0.5,
  -0.5,  0.5, -0.5
]);

// Define colors for each vertex (distinct colors for each face)
const colors = new Float32Array([
    // Front face (red)
    1.0, 0.0, 0.0, 1.0,  // Bottom-left
    1.0, 0.0, 0.0, 1.0,  // Bottom-right
    1.0, 0.0, 0.0, 1.0,  // Top-right
    1.0, 0.0, 0.0, 1.0,  // Top-left
  
    // Back face (yellow)
    1.0, 1.0, 0.0, 1.0,  // Bottom-left
    1.0, 1.0, 0.0, 1.0,  // Bottom-right
    1.0, 1.0, 0.0, 1.0,  // Top-right
    1.0, 1.0, 0.0, 1.0,  // Top-left
  
    // Top face (purple)
    0.5, 0.0, 0.5, 1.0,  // Top-left
    0.5, 0.0, 0.5, 1.0,  // Top-right
    0.5, 0.0, 0.5, 1.0,  // Bottom-right
    0.5, 0.0, 0.5, 1.0,  // Bottom-left
  
    // Bottom face (blue)
    0.0, 0.0, 1.0, 1.0,  // Bottom-left
    0.0, 0.0, 1.0, 1.0,  // Bottom-right
    0.0, 0.0, 1.0, 1.0,  // Top-right
    0.0, 0.0, 1.0, 1.0,  // Top-left
  
    // Right face (orange)
    1.0, 0.5, 0.0, 1.0,  // Bottom-left
    1.0, 0.5, 0.0, 1.0,  // Bottom-right
    1.0, 0.5, 0.0, 1.0,  // Top-right
    1.0, 0.5, 0.0, 1.0,  // Top-left
  
    // Left face (green)
    0.0, 1.0, 0.0, 1.0,  // Bottom-left
    0.0, 1.0, 0.0, 1.0,  // Bottom-right
    0.0, 1.0, 0.0, 1.0,  // Top-right
    0.0, 1.0, 0.0, 1.0   // Top-left
  ]);
  
  

// Define the indices for each face (two triangles per face)
const indices = new Uint16Array([
  // Front face
  0, 1, 2,  0, 2, 3,
  // Back face
  4, 5, 6,  4, 6, 7,
  // Top face
  3, 2, 6,  3, 6, 7,
  // Bottom face
  0, 1, 5,  0, 5, 4,
  // Right face
  1, 2, 6,  1, 6, 5,
  // Left face
  0, 3, 7,  0, 7, 4
]);

// Create a vertex buffer and bind it
const vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

// Create a color buffer and bind it
const colorBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

// Create an index buffer and bind it
const indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

// Vertex shader code
const vertCode = `
  attribute vec4 coordinates;
  attribute vec4 color;
  uniform mat4 u_matrix;
  varying vec4 vColor;

  void main(void) {
    gl_Position = u_matrix * coordinates;
    vColor = color; // Pass the color to the fragment shader
  }
`;

// Create and compile the vertex shader
const vertShader = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vertShader, vertCode);
gl.compileShader(vertShader);

// Fragment shader code
const fragCode = `
    precision mediump float;
    varying vec4 vColor;

    void main(void) {
        gl_FragColor = vColor; // Use the interpolated color from the vertex shader
    }

`;

// Create and compile the fragment shader
const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fragShader, fragCode);
gl.compileShader(fragShader);

// Create and link the shader program
const shaderProgram = gl.createProgram();
gl.attachShader(shaderProgram, vertShader);
gl.attachShader(shaderProgram, fragShader);
gl.linkProgram(shaderProgram);
gl.useProgram(shaderProgram);

// Bind vertex buffer and set attribute pointer
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
const coord = gl.getAttribLocation(shaderProgram, "coordinates");
gl.vertexAttribPointer(coord, 3, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(coord);

// Bind color buffer and set attribute pointer
gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
const color = gl.getAttribLocation(shaderProgram, "color");
gl.vertexAttribPointer(color, 4, gl.FLOAT, false, 0, 0);
gl.enableVertexAttribArray(color);


// Create a matrix for 3D transformations using glMatrix
const matrix = mat4.create();
let angle = 0;

// Get the location of the matrix uniform in the shader
const uMatrixLocation = gl.getUniformLocation(shaderProgram, "u_matrix");

// Render loop
function drawScene() {
  // Clear the color and depth buffers
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  console.log(gl.getShaderInfoLog(vertShader));
  console.log(gl.getShaderInfoLog(fragShader));


  // Rotate the cube around the y-axis and tilt it downwards
  mat4.identity(matrix);
  angle += 0.01;
  mat4.rotateY(matrix, matrix, angle);
  mat4.rotateX(matrix, matrix, -0.3); // Tilt downwards by 0.3 radians

  // Pass the matrix to the shader
  gl.uniformMatrix4fv(uMatrixLocation, false, matrix);

  // Draw the cube using the element array
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

  // Request the next frame
  requestAnimationFrame(drawScene);
}

// Start rendering
drawScene();
