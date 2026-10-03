import * as THREE from 'three';
import { io } from 'socket.io-client';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

let mixer;
let runAction;
let jumpAction;
const clock = new THREE.Clock();

// Simple seeded random number generator
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }
  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Global Game State
const state = {
  socket: null,
  roomId: null,
  playerName: '',
  isHost: false,
  players: {}, 
  ghosts: {},
  gameState: 'lobby', 
  isSolo: false,
  score: 0,
  coinsCollected: 0,
  alive: true,
  lives: 3,
  invincible: false,
  blinkInterval: null,
  seed: 0,
  rng: null,
  speed: 20,
  distance: 0,
  lane: 0, // -1 (left), 0 (middle), 1 (right)
  isJumping: false,
  isSliding: false,
  slideTimer: 0,
  jumpVelocity: 0,
  yPos: 0,
  groundY: 0,
  magnetTimer: 0,
  shieldTimer: 0,
  multiplierTimer: 0,
};

const LANE_WIDTH = 3;
const GRAVITY = -55; // Snappier gravity
const JUMP_FORCE = 22; // Higher jump to clear trains
const SLIDE_DURATION = 0.8;

// UI Elements
const ui = {
  lobby: document.getElementById('lobby-ui'),
  room: document.getElementById('room-ui'),
  game: document.getElementById('game-ui'),
  playerNameInput: document.getElementById('player-name'),
  roomCodeInput: document.getElementById('room-code'),
  btnCreate: document.getElementById('btn-create'),
  btnJoin: document.getElementById('btn-join'),
  btnSolo: document.getElementById('btn-solo'),
  btnStart: document.getElementById('btn-start'),
  btnRestart: document.getElementById('btn-restart'),
  displayRoomCode: document.getElementById('display-room-code'),
  playersList: document.getElementById('players-list'),
  waitingMessage: document.getElementById('waiting-message'),
  scoreDisplay: document.getElementById('scorePill'),
  coinDisplay: document.getElementById('coinPill'),
  livesDisplay: document.getElementById('livesPill'),
  rankDisplay: document.getElementById('rankPill'),
  countdownDisplay: document.getElementById('banner'),
  leaderboardList: document.getElementById('leaderboard-list'),
  stage: document.getElementById('stage'),
  boostFill: document.getElementById('boostFill')
};

// --- Socket.io Setup ---
const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '/';
state.socket = io(socketUrl);

state.socket.on('connect', () => { console.log('Connected to server'); });

state.socket.on('roomUpdate', (data) => {
  state.roomId = data.roomId;
  state.isHost = data.host === state.socket.id;
  state.players = data.players;
  
  if (state.gameState === 'lobby') {
    state.gameState = 'room';
    ui.lobby.classList.add('hide');
    ui.room.classList.remove('hide');
  }

  ui.displayRoomCode.innerText = data.roomId;
  ui.playersList.innerHTML = '';
  for (const [id, p] of Object.entries(data.players)) {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerText = `${p.name} ${id === data.host ? '(Host)' : ''}`;
    ui.playersList.appendChild(div);
  }

  if (state.isHost) {
    ui.btnStart.classList.remove('hide');
    ui.waitingMessage.classList.add('hide');
  } else {
    ui.btnStart.classList.add('hide');
    ui.waitingMessage.classList.remove('hide');
  }
});

state.socket.on('gameStart', (data) => {
  state.seed = data.seed;
  state.rng = new SeededRandom(Math.floor(state.seed * 1000000));
  startGameCountdown();
});

state.socket.on('playerUpdated', (data) => {
  if (state.players[data.id]) {
    Object.assign(state.players[data.id], data);
    updateLeaderboard();
  }
});

// UI Event Listeners
ui.btnCreate.addEventListener('click', () => {
  const name = ui.playerNameInput.value || 'Player' + Math.floor(Math.random() * 1000);
  state.playerName = name;
  state.socket.emit('createRoom', { name });
});

ui.btnJoin.addEventListener('click', () => {
  const name = ui.playerNameInput.value || 'Player' + Math.floor(Math.random() * 1000);
  const code = ui.roomCodeInput.value.toUpperCase();
  if (code) {
    state.playerName = name;
    state.socket.emit('joinRoom', { roomId: code, name });
  }
});

ui.btnSolo.addEventListener('click', () => {
  state.isSolo = true;
  state.seed = Math.random();
  state.rng = new SeededRandom(Math.floor(state.seed * 1000000));
  startGameCountdown();
});

ui.btnStart.addEventListener('click', () => { state.socket.emit('startGame'); });
ui.btnRestart.addEventListener('click', () => { 
  if (state.isSolo) {
    ui.btnRestart.classList.add('hide');
    obstacles.forEach(o => scene.remove(o)); obstacles = [];
    coins.forEach(c => scene.remove(c)); coins = [];
    powerups.forEach(p => scene.remove(p)); powerups = [];
    activeBuildings.forEach(b => scene.remove(b.mesh)); activeBuildings = [];
    nextBuildingZLeft = 40;
    nextBuildingZRight = 40;
    nextBuildingZLeft = spawnBuildingIfNeeded(1, nextBuildingZLeft);
    nextBuildingZRight = spawnBuildingIfNeeded(-1, nextBuildingZRight);
    chunksSpawned = 3;
    playerRig.position.set(0, 0, 0);
    startGameCountdown();
  } else {
    window.location.reload(); 
  }
});


// --- Three.js Setup ---
const scene = new THREE.Scene();
const skyColor = new THREE.Color('#00BFFF'); // Vibrant Sky
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 20, 150);

const camera = new THREE.PerspectiveCamera(60, ui.stage.clientWidth / ui.stage.clientHeight, 0.1, 200);
camera.position.set(0, 4.5, 9); 
camera.lookAt(0, 1.5, -10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(ui.stage.clientWidth, ui.stage.clientHeight);
renderer.shadowMap.enabled = true;
ui.stage.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// Railway Track & Ground
const groundGroup = new THREE.Group();
const groundMat = new THREE.MeshLambertMaterial({ color: '#2f4a45' }); // Exact floor color from snippet
const groundGeo = new THREE.PlaneGeometry(LANE_WIDTH * 3 + 4, 300);
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
groundGroup.add(ground);

// Rails and Sleepers
const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.8, roughness: 0.3 }); // Silver from snippet
const sleeperMat = new THREE.MeshLambertMaterial({ color: 0x1d1f22 }); // Dark sleepers
const railGeo = new THREE.BoxGeometry(0.15, 0.15, 300); 
const sleeperGeo = new THREE.BoxGeometry(2.6, 0.15, 0.5);

for (let i = -1; i <= 1; i++) {
  // Rails
  const railL = new THREE.Mesh(railGeo, railMat);
  railL.position.set(i * LANE_WIDTH - 0.7, 0.05, 0);
  const railR = new THREE.Mesh(railGeo, railMat);
  railR.position.set(i * LANE_WIDTH + 0.7, 0.05, 0);
  groundGroup.add(railL);
  groundGroup.add(railR);
  
  // Sleepers (just visual texture or actual geometry)
  for(let j = 0; j < 150; j++) {
    const sleeper = new THREE.Mesh(sleeperGeo, sleeperMat);
    sleeper.position.set(i * LANE_WIDTH, 0.05, -150 + j * 2.5); // Spaced slightly more
    sleeper.receiveShadow = true;
    groundGroup.add(sleeper);
  }
}

// Add subtle bright lane dividers (like painted stripes)
const dividerGeo = new THREE.PlaneGeometry(0.1, 300);
const dividerMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.5 });
const divL = new THREE.Mesh(dividerGeo, dividerMat);
divL.rotation.x = -Math.PI / 2;
divL.position.set(-LANE_WIDTH / 2, 0.01, 0);
groundGroup.add(divL);

const divR = new THREE.Mesh(dividerGeo, dividerMat);
divR.rotation.x = -Math.PI / 2;
divR.position.set(LANE_WIDTH / 2, 0.01, 0);
groundGroup.add(divR);

groundGroup.position.z = -100;
scene.add(groundGroup);

// Background City Buildings
const buildings = new THREE.Group();
buildings.position.z = -150;
scene.add(buildings);

const bMats = {
  cream: new THREE.MeshLambertMaterial({ color: 0xe7dcc4 }),
  red: new THREE.MeshLambertMaterial({ color: 0xa8362b }),
  wood: new THREE.MeshLambertMaterial({ color: 0x7a5a3a }),
  wood2: new THREE.MeshLambertMaterial({ color: 0xa47d52 }),
  glass: new THREE.MeshLambertMaterial({ color: 0x8fc6d8 }),
  brick: new THREE.MeshLambertMaterial({ color: 0x9c4a38 }),
  grey: new THREE.MeshLambertMaterial({ color: 0x8b9096 }),
  dark: new THREE.MeshLambertMaterial({ color: 0x2b2f33 }),
  blue: new THREE.MeshLambertMaterial({ color: 0x4b6f96 }),
  steel: new THREE.MeshLambertMaterial({ color: 0x6f8aa3 }),
  steel2: new THREE.MeshLambertMaterial({ color: 0x8ba3b8 }),
  grass: new THREE.MeshLambertMaterial({ color: 0x7a9a63 }),
  stone: new THREE.MeshLambertMaterial({ color: 0xb8b3a6 }),
  white: new THREE.MeshLambertMaterial({ color: 0xf3efe6 })
};

function addBox(g, x, z, w, h, d, c, y = 0, rX = 0) {
  const S = 0.1;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w*S, h*S, d*S), bMats[c]);
  mesh.position.set(x*S, (y + h/2)*S, z*S);
  mesh.rotation.x = -rX * Math.PI / 180;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
}
function addGable(g, x, z, w, d, y, c) {
  const L = (d/2 + 5) / 0.848;
  const o = (d/2 + 5) / 2;
  const cy = y + L * 0.53 / 2;
  addBox(g, x, z + o, w, 4, L, c, cy - 2, 32); 
  addBox(g, x, z - o, w, 4, L, c, cy - 2, -32);
}

const bldGens = [
  { gen: function createCottage() { const g = new THREE.Group(); addBox(g, 0,0,150,4,130,'grass',-4); addBox(g, 0,0,80,50,60,'cream',0); addGable(g, 0,0,92,60,50,'red'); addBox(g, 0,31,16,28,2,'wood',0); addBox(g, -25,31,16,16,2,'glass',20); addBox(g, 25,31,16,16,2,'glass',20); addBox(g, -25,-31,16,16,2,'glass',20); addBox(g, 25,-31,16,16,2,'glass',20); addBox(g, 25,-12,10,34,10,'brick',44); return g; }, w: 15, d: 13 },
  { gen: function createStation() { const g = new THREE.Group(); addBox(g, 0,0,260,4,130,'stone',-4); addBox(g, 0,-15,160,56,50,'cream',0); addBox(g, 0,-15,170,5,56,'red',56); addBox(g, -70,38,6,50,6,'dark',0); addBox(g, 0,38,6,50,6,'dark',0); addBox(g, 70,38,6,50,6,'dark',0); addBox(g, 0,10,190,5,76,'red',50); addBox(g, 60,-15,28,52,28,'cream',61); addBox(g, 60,0.5,14,14,2,'white',82); addBox(g, 60,-15,34,6,34,'red',113); addBox(g, 60,-15,22,8,22,'red',119); addBox(g, 60,-15,10,8,10,'red',127); addBox(g, -30,10.5,24,28,2,'glass',8); addBox(g, 30,10.5,24,28,2,'glass',8); return g; }, w: 26, d: 13 },
  { gen: function createShop() { const g = new THREE.Group(); addBox(g, 0,0,100,4,90,'stone',-4); addBox(g, 0,0,70,90,56,'blue',0); addBox(g, 0,0,76,5,62,'dark',90); addBox(g, 0,28.5,60,26,2,'glass',6); addBox(g, 0,38,66,4,24,'red',38,-20); return g; }, w: 10, d: 9 },
  { gen: function createSkyscraper() { const g = new THREE.Group(); addBox(g, 0,0,120,4,120,'stone',-4); addBox(g, 0,0,88,24,88,'dark',0); addBox(g, 0,0,70,176,70,'steel',24); addBox(g, 0,0,50,40,50,'steel2',200); addBox(g, 0,0,30,20,30,'dark',240); addBox(g, 0,0,4,50,4,'dark',260); return g; }, w: 12, d: 12 },
  { gen: function createFactory() { const g = new THREE.Group(); addBox(g, 0,0,160,4,120,'stone',-4); addBox(g, 0,0,140,56,90,'brick',0); addGable(g, 0,0,146,90,56,'grey'); addBox(g, -50,-25,16,90,16,'brick',0); addBox(g, -50,-25,20,6,20,'dark',90); addBox(g, -25,-25,16,70,16,'brick',0); addBox(g, -25,-25,20,6,20,'dark',70); addBox(g, 35,45.5,40,30,2,'dark',0); return g; }, w: 16, d: 12 },
  { gen: function createTower() { const g = new THREE.Group(); addBox(g, 0,0,100,4,100,'grass',-4); addBox(g, -20,-20,5,50,5,'wood',0); addBox(g, 20,-20,5,50,5,'wood',0); addBox(g, -20,20,5,50,5,'wood',0); addBox(g, 20,20,5,50,5,'wood',0); addBox(g, 0,0,60,4,60,'wood',50); addBox(g, 0,0,50,40,50,'wood2',54); addBox(g, 0,0,56,6,56,'red',94); addBox(g, 0,0,36,8,36,'red',100); addBox(g, 0,0,14,8,14,'red',108); return g; }, w: 10, d: 10 }
];

const buildingPool = bldGens.map(b => ({ mesh: b.gen(), w: b.w, d: b.d }));

let activeBuildings = [];
let nextBuildingZLeft = 40;
let nextBuildingZRight = 40;

function spawnBuildingIfNeeded(side, nextZ) {
  // Keep spawning until we have covered the horizon (e.g. -300)
  while (nextZ > -300) {
    const bTemplate = buildingPool[Math.floor(Math.random() * buildingPool.length)];
    const building = bTemplate.mesh.clone();
    const zDepth = bTemplate.w;
    const xWidth = bTemplate.d;
    
    // Exactly contiguous alignment
    const zCenter = nextZ - (zDepth / 2);
    // Flush with the track edge (6.5)
    const xCenter = side * (6.5 + (xWidth / 2));
    
    building.position.set(xCenter, 0, zCenter);
    building.rotation.y = side === 1 ? -Math.PI/2 : Math.PI/2;
    
    scene.add(building);
    activeBuildings.push({ mesh: building });
    
    nextZ -= zDepth; // Shift the spawn pointer by the exact width of the building
  }
  return nextZ;
}

// Initial Spawn
nextBuildingZLeft = spawnBuildingIfNeeded(1, nextBuildingZLeft);
nextBuildingZRight = spawnBuildingIfNeeded(-1, nextBuildingZRight);

// Advanced Player Rig
const playerRig = new THREE.Group();
playerRig.scale.set(0.012, 0.012, 0.012); // Adjust scale for Mixamo FBX (usually in cm)
scene.add(playerRig);

const loader = new FBXLoader();
// Add a timestamp to bypass Vite's aggressive static asset caching!
const cacheBuster = '?v=' + Date.now();

loader.load('/Running.fbx' + cacheBuster, (fbx) => {
  fbx.traverse(child => { 
    if (child.isMesh) { 
      child.castShadow = true; 
      child.receiveShadow = true; 
    } 
  });
  
  fbx.position.y = 0; 
  fbx.rotation.y = Math.PI; // Rotate 180 degrees to face forward
  playerRig.add(fbx);
  
  // Bulletproof "In Place" hack: Forcefully strip X and Z movement from the Hips
  if (fbx.animations && fbx.animations.length > 0) {
    const anim = fbx.animations[0];
    anim.tracks.forEach(track => {
      if (track.name.match(/mixamorigHips.*\.position/)) {
        for (let i = 0; i < track.values.length; i += 3) {
          track.values[i] = 0;     // Lock X
          track.values[i+2] = 0;   // Lock Z
        }
      }
    });
  }
  
  mixer = new THREE.AnimationMixer(fbx);
  runAction = mixer.clipAction(fbx.animations[0]);
  runAction.play();
  
  // Load Jump
  loader.load('/Jump.fbx' + cacheBuster, (jumpFbx) => {
    jumpAction = mixer.clipAction(jumpFbx.animations[0]);
    // Configure jump animation not to loop
    jumpAction.setLoop(THREE.LoopOnce);
    jumpAction.clampWhenFinished = true;
  });
});

// Game Objects Arrays
let obstacles = [];
let coins = [];
let powerups = [];

// Materials for generation
const barrierGeo = new THREE.BoxGeometry(2.4, 1.2, 0.5);
const barrierMat = new THREE.MeshLambertMaterial({ color: 0xFFA000 });

const highBarrierGeo = new THREE.BoxGeometry(2.4, 0.5, 0.5);
const highBarrierMat = new THREE.MeshLambertMaterial({ color: 0xFF0055 });

const coinGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.15, 16);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xFFEA00, emissive: 0x886600, metalness: 1.0, roughness: 0.1 });

const magnetGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
const magnetMat = new THREE.MeshLambertMaterial({ color: 0x9C27B0 });

function createSteamTrain() {
  const train = new THREE.Group();
  
  const mGreen = new THREE.MeshLambertMaterial({ color: 0x2f5d50 });
  const mRed = new THREE.MeshLambertMaterial({ color: 0xa8362b });
  const mBlack = new THREE.MeshLambertMaterial({ color: 0x1d1f22 });
  const mYellow = new THREE.MeshBasicMaterial({ color: 0xf2c14e }); 
  const mBlue = new THREE.MeshLambertMaterial({ color: 0x3c6e9e });
  const mWhite = new THREE.MeshLambertMaterial({ color: 0xe8e1d0 });
  const mWin = new THREE.MeshLambertMaterial({ color: 0xcfeaf3 });

  // Engine Base
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 8), mBlack);
  base.position.set(0, -0.8, 8); 
  train.add(base);
  
  // Boiler
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 5), mGreen);
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 0.1, 9.5);
  train.add(boiler);
  
  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 3), mRed);
  cabin.position.set(0, 0.4, 5.5);
  train.add(cabin);
  
  // Cabin Window
  const win1 = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), mWin);
  win1.position.set(0, 0.8, 7.01);
  train.add(win1);
  
  // Cabin Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 3.2), mBlack);
  roof.position.set(0, 1.5, 5.5);
  train.add(roof);

  // Chimney
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.4, 1.2), mBlack);
  chimney.position.set(0, 1.0, 11);
  train.add(chimney);

  // Headlight
  const light = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), mYellow);
  light.position.set(0, -0.6, 12.01);
  train.add(light);
  
  // Carriage 1 (Blue)
  const car1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 7.5), mBlue);
  car1.position.set(0, -0.1, 0);
  train.add(car1);
  const c1Roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 7.6), mWhite);
  c1Roof.position.set(0, 1.1, 0);
  train.add(c1Roof);

  // Carriage 2 (White)
  const car2 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 7.5), mWhite);
  car2.position.set(0, -0.1, -8);
  train.add(car2);
  const c2Roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 7.6), mBlack);
  c2Roof.position.set(0, 1.1, -8);
  train.add(c2Roof);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 2.5, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const zPositions = [11, 9, 6, 4,  2, 0, -2,  -6, -8, -10];
  for(let z of zPositions) {
     const wheel = new THREE.Mesh(wheelGeo, mBlack);
     wheel.position.set(0, -1.0, z);
     train.add(wheel);
  }
  
  train.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return train;
}

function spawnObstacleChunk(zPos) {
  if (!state.rng) return;
  const lanes = [-1, 0, 1];
  const rand = state.rng.next();
  
  // Track occupied lanes to prevent coins from spawning inside trains or barriers
  let occupiedLanes = [];
  
  // Decide what to spawn
  if (rand < 0.25) {
    // Stationary Train
    const lane = lanes[Math.floor(state.rng.next() * 3)];
    spawnTrain(lane, zPos, false);
    occupiedLanes.push(lane);
  } else if (rand < 0.45) {
    // Moving Train
    const lane = lanes[Math.floor(state.rng.next() * 3)];
    spawnTrain(lane, zPos, true);
    occupiedLanes.push(lane);
  } else if (rand < 0.70) {
    // Low Barriers (Jump)
    lanes.sort(() => state.rng.next() - 0.5);
    for (let i = 0; i < 2; i++) {
      const barrier = new THREE.Mesh(barrierGeo, barrierMat);
      barrier.position.set(lanes[i] * LANE_WIDTH, 0.6, zPos);
      barrier.castShadow = true;
      barrier.userData = { type: 'barrier', hitBox: new THREE.Box3() };
      scene.add(barrier);
      obstacles.push(barrier);
      occupiedLanes.push(lanes[i]);
    }
  } else if (rand < 0.85) {
    // High Barriers (Slide)
    const lane = lanes[Math.floor(state.rng.next() * 3)];
    const hBarrier = new THREE.Mesh(highBarrierGeo, highBarrierMat);
    hBarrier.position.set(lane * LANE_WIDTH, 2.0, zPos); // High up
    hBarrier.castShadow = true;
    
    // Add side posts
    const postGeo = new THREE.BoxGeometry(0.2, 2.5, 0.2);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const p1 = new THREE.Mesh(postGeo, postMat); p1.position.set(-1.1, -1.0, 0); hBarrier.add(p1);
    const p2 = new THREE.Mesh(postGeo, postMat); p2.position.set(1.1, -1.0, 0); hBarrier.add(p2);
    
    hBarrier.userData = { type: 'high_barrier', hitBox: new THREE.Box3() };
    scene.add(hBarrier);
    obstacles.push(hBarrier);
    occupiedLanes.push(lane);
  }

  // Coins & Powerups
  const itemRand = state.rng.next();
  // Find a free lane
  const freeLanes = lanes.filter(l => !occupiedLanes.includes(l));
  if (freeLanes.length === 0) return; // All lanes blocked!
  
  const itemLane = freeLanes[Math.floor(state.rng.next() * freeLanes.length)];

  if (itemRand < 0.1 && state.magnetTimer <= 0) {
    // Spawn Magnet
    const mag = new THREE.Mesh(magnetGeo, magnetMat);
    mag.position.set(itemLane * LANE_WIDTH, 1, zPos - 5);
    mag.userData = { type: 'magnet', active: true };
    scene.add(mag);
    powerups.push(mag);
  } else if (itemRand < 0.6) {
    // Coin Pattern
    const isArch = state.rng.next() > 0.5;
    for(let i=0; i<4; i++) {
      const coin = new THREE.Mesh(coinGeo, coinMat);
      coin.rotation.x = Math.PI / 2;
      const yOffset = isArch ? Math.sin((i/3)*Math.PI)*2 : 0;
      coin.position.set(itemLane * LANE_WIDTH, 1 + yOffset, zPos - i*2);
      coin.userData = { type: 'coin', active: true };
      scene.add(coin);
      coins.push(coin);
    }
  }
}

function spawnTrain(lane, zPos, isMoving) {
  const train = createSteamTrain();
  train.position.set(lane * LANE_WIDTH, 1.4, zPos);
  
  train.userData = { type: 'train', isMoving, speed: isMoving ? 30 : 0, hitBox: new THREE.Box3() };
  scene.add(train);
  obstacles.push(train);
}

let chunksSpawned = 3; 

function manageChunks(delta) {
  while (state.distance + 200 > chunksSpawned * 25) {
    let overshoot = (state.distance + 200) - (chunksSpawned * 25);
    spawnObstacleChunk(-200 + overshoot);
    chunksSpawned++;
  }

  // Move and cleanup objects
  const moveDist = state.speed * delta;
  
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    let obsMove = moveDist;
    if (obs.userData.isMoving) obsMove += obs.userData.speed * delta;
    
    obs.position.z += obsMove;
    if (obs.position.z > 40) { // Increased removal distance for longer trains
      scene.remove(obs);
      obstacles.splice(i, 1);
    }
  }
  
  for (let i = coins.length - 1; i >= 0; i--) {
    const coin = coins[i];
    coin.position.z += moveDist;
    coin.rotation.y += delta * 5;
    
    // Magnet effect
    if (state.magnetTimer > 0 && coin.userData.active) {
      const distToPlayerZ = coin.position.z - playerRig.position.z;
      if (distToPlayerZ > -40 && distToPlayerZ < 10) {
        coin.position.lerp(playerRig.position, 10 * delta);
      }
    }
    
    if (coin.position.z > 10) {
      scene.remove(coin);
      coins.splice(i, 1);
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.position.z += moveDist;
    p.rotation.y += delta * 3;
    p.rotation.x += delta * 3;
    if (p.position.z > 10) {
      scene.remove(p);
      powerups.splice(i, 1);
    }
  }

  // Moving environment
  groundGroup.position.z = -100 + (state.distance % 2);
  
  // Move all dynamically generated buildings
  for (let i = activeBuildings.length - 1; i >= 0; i--) {
    const b = activeBuildings[i];
    b.mesh.position.z += moveDist;
    if (b.mesh.position.z > 50) {
      scene.remove(b.mesh);
      activeBuildings.splice(i, 1);
    }
  }
  
  // Advance the spawn pointers by the distance we just moved
  nextBuildingZLeft += moveDist;
  nextBuildingZRight += moveDist;
  
  // Spawn new buildings to fill any space that opened up in the distance
  nextBuildingZLeft = spawnBuildingIfNeeded(1, nextBuildingZLeft);
  nextBuildingZRight = spawnBuildingIfNeeded(-1, nextBuildingZRight);
}

// Input Handling
function jump() {
  if (!state.isJumping && !state.isSliding) {
    state.isJumping = true;
    state.jumpVelocity = JUMP_FORCE;
    
    // Play jump animation
    if (jumpAction && runAction) {
      jumpAction.reset();
      jumpAction.play();
      jumpAction.crossFadeFrom(runAction, 0.2, false);
    }
  }
}

function slide() {
  if (!state.isSliding && !state.isJumping) {
    state.isSliding = true;
    state.slideTimer = SLIDE_DURATION;
  } else if (state.isJumping) {
    // Fast fall
    state.jumpVelocity = -JUMP_FORCE;
  }
}

window.addEventListener('keydown', (e) => {
  if (state.gameState !== 'playing' || !state.alive) return;
  if ((e.key === 'ArrowLeft' || e.key === 'a') && state.lane > -1) state.lane--;
  else if ((e.key === 'ArrowRight' || e.key === 'd') && state.lane < 1) state.lane++;
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') jump();
  else if (e.key === 'ArrowDown' || e.key === 's') slide();
});

let touchStartX = 0; let touchStartY = 0;
window.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
});
window.addEventListener('touchend', e => {
  if (state.gameState !== 'playing' || !state.alive) return;
  const dx = e.changedTouches[0].screenX - touchStartX;
  const dy = e.changedTouches[0].screenY - touchStartY;
  
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 30 && state.lane < 1) state.lane++;
    else if (dx < -30 && state.lane > -1) state.lane--;
  } else {
    if (dy < -30) jump();
    else if (dy > 30) slide();
  }
});

function startGameCountdown() {
  ui.lobby.classList.add('hide');
  ui.room.classList.add('hide');
  ui.game.classList.remove('hide');
  state.gameState = 'countdown';
  
  if (ui.stage.clientWidth && ui.stage.clientHeight) {
    camera.aspect = ui.stage.clientWidth / ui.stage.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(ui.stage.clientWidth, ui.stage.clientHeight);
  }
  
  ui.countdownDisplay.classList.remove('hide');
  let count = 3;
  ui.countdownDisplay.innerHTML = '<b>' + count + '</b>';
  
  const interval = setInterval(() => {
    count--;
    if (count > 0) ui.countdownDisplay.innerHTML = '<b>' + count + '</b>';
    else if (count === 0) ui.countdownDisplay.innerHTML = '<b>GO!</b>';
    else {
      clearInterval(interval);
      ui.countdownDisplay.innerHTML = '';
      if (state.blinkInterval) clearInterval(state.blinkInterval);
      playerRig.visible = true;
      state.gameState = 'playing';
      state.alive = true;
      state.lives = 3;
      state.invincible = false;
      state.score = 0;
      state.coinsCollected = 0;
      state.distance = 0;
      state.speed = 20;
      state.yPos = 0;
      state.groundY = 0;
      state.magnetTimer = 0;
      ui.scoreDisplay.innerText = '⭐ 0';
      ui.coinDisplay.innerText = '🪙 0';
      ui.livesDisplay.innerText = '❤️ 3';
      document.getElementById('game-over-ui').classList.add('hide');
    }
  }, 1000);
}

function checkCollisions() {
  const pBox = new THREE.Box3().setFromObject(playerRig);
  pBox.expandByScalar(-0.15); // Forgiveness
  
  // Custom height for sliding
  if (state.isSliding) {
    pBox.max.y -= 1.0; 
  }

  let newGroundY = 0;

  // Obstacles
  for (const obs of obstacles) {
    obs.userData.hitBox.setFromObject(obs);
    
    // Evaluate if we are running on top of a train
    if (obs.userData.type === 'train') {
      if (pBox.max.x > obs.userData.hitBox.min.x && pBox.min.x < obs.userData.hitBox.max.x &&
          pBox.max.z > obs.userData.hitBox.min.z && pBox.min.z < obs.userData.hitBox.max.z) {
        // We are within the horizontal bounds of the train
        if (state.yPos >= obs.userData.hitBox.max.y - 0.6) {
          newGroundY = Math.max(newGroundY, obs.userData.hitBox.max.y);
        }
      }
    }
    
    // Custom hitbox adjustments
    if (obs.userData.type === 'high_barrier') obs.userData.hitBox.min.y += 1.0; 
    
    if (pBox.intersectsBox(obs.userData.hitBox)) {
      if (obs.userData.type === 'train') {
        // If we are safely above the train (running on it or landing), ignore intersection
        if (pBox.min.y >= obs.userData.hitBox.max.y - 0.6) {
          continue;
        }
      }

      if (state.invincible) continue;

      state.lives--;
      ui.livesDisplay.innerText = '❤️ ' + state.lives;

      if (state.lives <= 0) {
        state.alive = false;
        state.gameState = 'gameover';
        // Camera shake
        camera.position.y += 0.5;
        camera.rotation.z += 0.1;
        
        showGameOver();
        if (!state.isSolo) state.socket.emit('updatePlayer', { alive: false, score: state.score });
        return;
      } else {
        // Lost a life, keep running with invincibility
        state.invincible = true;
        // Visual blink
        let blinks = 0;
        if (state.blinkInterval) clearInterval(state.blinkInterval);
        state.blinkInterval = setInterval(() => {
          playerRig.visible = !playerRig.visible;
          blinks++;
          if (blinks >= 10) {
            clearInterval(state.blinkInterval);
            playerRig.visible = true;
            state.invincible = false;
          }
        }, 200);
        
        // Minor camera shake
        camera.position.y += 0.3;
        if (!state.isSolo) state.socket.emit('updatePlayer', { alive: true, score: state.score });
      }
    }
  }
  
  state.groundY = newGroundY;

  // Coins
  for (const coin of coins) {
    if (!coin.userData.active) continue;
    const cBox = new THREE.Box3().setFromObject(coin);
    if (pBox.intersectsBox(cBox)) {
      coin.userData.active = false;
      coin.visible = false;
      state.score += 10 * (state.multiplierTimer > 0 ? 2 : 1);
      state.coinsCollected++;
      ui.coinDisplay.innerText = '🪙 ' + state.coinsCollected;
    }
  }

  // Powerups
  for (const p of powerups) {
    if (!p.userData.active) continue;
    const pBox2 = new THREE.Box3().setFromObject(p);
    if (pBox.intersectsBox(pBox2)) {
      p.userData.active = false;
      p.visible = false;
      if (p.userData.type === 'magnet') state.magnetTimer = 10.0;
    }
  }
}

function showGameOver() {
  ui.countdownDisplay.innerHTML = '';
  document.getElementById('game-over-ui').classList.remove('hide');
  document.getElementById('final-score').innerText = Math.floor(state.score);
  ui.btnRestart.innerText = state.isSolo ? 'Retry' : 'Back to menu';
  ui.btnRestart.classList.remove('hide');
}

function updateLeaderboard() {
  if (state.gameState !== 'playing' && state.gameState !== 'gameover') return;
  let allPlayers = [{ name: state.playerName, score: state.score, alive: state.alive, id: state.socket.id }];
  for (const [id, p] of Object.entries(state.players)) if (id !== state.socket.id) allPlayers.push({ ...p, id });
  allPlayers.sort((a, b) => b.score - a.score);
  
  const rank = allPlayers.findIndex(p => p.id === state.socket.id) + 1;
  if(ui.rankDisplay) ui.rankDisplay.innerText = `🏅 ${rank}/${allPlayers.length}`;

  ui.leaderboardList.innerHTML = '';
  allPlayers.forEach(p => {
    const li = document.createElement('div');
    li.className = 'pl';
    li.innerHTML = `<span>${p.alive ? '🟢' : '💀'} ${p.name} ${p.id === state.socket.id ? '(you)' : ''}</span><span class="mut">${Math.floor(p.score)} pts</span>`;
    ui.leaderboardList.appendChild(li);
  });
}

function updateGhosts() {
  for (const [id, p] of Object.entries(state.players)) {
    if (id === state.socket.id) continue;
    if (!state.ghosts[id]) {
      const gMat = new THREE.MeshLambertMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
      const gMesh = new THREE.Mesh(new THREE.BoxGeometry(1,2,1), gMat);
      scene.add(gMesh);
      state.ghosts[id] = gMesh;
    }
    const ghost = state.ghosts[id];
    if (p.alive) {
      ghost.position.x = THREE.MathUtils.lerp(ghost.position.x, p.x, 0.2);
      ghost.position.y = THREE.MathUtils.lerp(ghost.position.y, p.y || 1, 0.2);
      ghost.position.z = THREE.MathUtils.lerp(ghost.position.z, p.z - state.distance, 0.2);
    } else {
      ghost.visible = false;
    }
  }
}

// Day/Night Cycle
function updateEnvironmentColors() {
  const cycle = (state.distance % 10000) / 10000; 
  // 0 to 0.4: Day, 0.4 to 0.5: Sunset, 0.5 to 0.9: Night, 0.9 to 1.0: Sunrise
  let targetSky, targetLight;
  if (cycle < 0.4) { targetSky = new THREE.Color('#00BFFF'); targetLight = 0.8; }
  else if (cycle < 0.5) { targetSky = new THREE.Color('#FF3366'); targetLight = 0.5; }
  else if (cycle < 0.9) { targetSky = new THREE.Color('#0A0A2A'); targetLight = 0.2; }
  else { targetSky = new THREE.Color('#FF3366'); targetLight = 0.5; }
  
  scene.background.lerp(targetSky, 0.01);
  scene.fog.color.copy(scene.background);
  dirLight.intensity = THREE.MathUtils.lerp(dirLight.intensity, targetLight, 0.01);
}

let lastTime = 0;
function animate(time) {
  requestAnimationFrame(animate);
  if (!lastTime) lastTime = time;
  let delta = (time - lastTime) / 1000;
  lastTime = time;
  if (isNaN(delta) || delta > 0.1) delta = 0.016; // Prevent huge jumps
  
  const animDelta = clock.getDelta();
  
  // Only play animations when the game is actively running
  if (mixer && state.gameState === 'playing') {
    mixer.update(animDelta);
  }

  if (state.gameState === 'playing' && state.alive) {
    state.speed += delta * 0.3; // Gradual difficulty
    const moveDist = state.speed * delta;
    state.distance += moveDist;
    state.score += moveDist * 0.1; 
    
    ui.scoreDisplay.innerText = `⭐ ${Math.floor(state.score)}`;
    if(ui.boostFill) ui.boostFill.style.width = Math.min(100, (state.speed - 20) / 40 * 100) + '%';

    // Timers
    if (state.magnetTimer > 0) state.magnetTimer -= delta;
    if (state.slideTimer > 0) {
      state.slideTimer -= delta;
      if (state.slideTimer <= 0) state.isSliding = false;
    }

    // Lane Movement (Smooth)
    const targetX = state.lane * LANE_WIDTH;
    playerRig.position.x = THREE.MathUtils.lerp(playerRig.position.x, targetX, 12 * delta);
    // Lean effect
    playerRig.rotation.z = (targetX - playerRig.position.x) * -0.15;

    // Jump / Slide Physics & Animation
    if (state.isJumping) {
      state.jumpVelocity += GRAVITY * delta;
      state.yPos += state.jumpVelocity * delta;
      if (state.yPos <= state.groundY) {
        state.yPos = state.groundY;
        state.isJumping = false;
        state.jumpVelocity = 0;
        
        // Transition back to running animation
        if (jumpAction && runAction) {
          runAction.reset().play();
          runAction.crossFadeFrom(jumpAction, 0.2, false);
        }
      }
    } else {
      if (state.yPos > state.groundY) {
        // Player ran off an edge (like falling off a train)
        state.isJumping = true;
        state.jumpVelocity = 0;
      } else {
        state.yPos = state.groundY;
      }
    }
    playerRig.position.y = state.yPos;
    
    // Slide Animation (shrink and tilt forward)
    if (state.isSliding) {
      playerRig.scale.y = THREE.MathUtils.lerp(playerRig.scale.y, 0.006, 15 * delta); // 50% of 0.012
      playerRig.rotation.x = THREE.MathUtils.lerp(playerRig.rotation.x, 0.5, 15 * delta);
    } else {
      playerRig.scale.y = THREE.MathUtils.lerp(playerRig.scale.y, 0.012, 15 * delta);
      playerRig.rotation.x = THREE.MathUtils.lerp(playerRig.rotation.x, 0.0, 15 * delta);
    }

    manageChunks(delta);
    checkCollisions();
    updateEnvironmentColors();

    if (!state.isSolo && Math.random() < 0.1) {
      state.socket.emit('updatePlayer', { 
        x: playerRig.position.x, y: playerRig.position.y, z: state.distance, score: state.score, alive: state.alive
      });
    }
  }
  
  if (state.gameState === 'playing' && !state.isSolo) {
     updateGhosts();
     if (Math.random() < 0.05) updateLeaderboard();
  }

  // Camera follow (Dynamic)
  if (state.alive) {
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, playerRig.position.x * 0.4, 5 * delta);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 4.5 + state.yPos * 0.5, 5 * delta);
    camera.lookAt(playerRig.position.x * 0.2, 1.5, playerRig.position.z - 10);
  }
  
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  if (ui.stage.clientWidth && ui.stage.clientHeight) {
    camera.aspect = ui.stage.clientWidth / ui.stage.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(ui.stage.clientWidth, ui.stage.clientHeight);
  }
});

animate();
