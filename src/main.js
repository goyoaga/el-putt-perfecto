import * as THREE from 'three';
import './style.css';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const sceneEl = $('scene');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const GREEN_W = 10.8;
const GREEN_L = 6.6;
const BALL_R = 0.13;
const HOLE_R = 0.19;
const MIN_DRAG = 0.28;
const MAX_DRAG = 2.15;
const FRICTION = 1.02;
const WIND_ACCEL_MAX = 0.12;
const SLOPE_ACCEL_MIN = 0.07;
const SLOPE_ACCEL_MAX = 0.17;
const CUP_CAPTURE_SPEED = 0.92;

let renderer, camera, world, ball, holeDisc, holeRing, flagGroup, aimLine, pullLine, raycaster, pointer, groundPlane, clock, slopeGroup;
let phase = 'ready';
let roundNumber = 0;
let dragging = false;
let dragPoint = new THREE.Vector3();
let shotVelocity = new THREE.Vector2();
let wind = { speed: 0, angle: 0, vector: new THREE.Vector2() };
let slope = { strength: 0.1, angle: Math.PI / 2, vector: new THREE.Vector2(0, 0.1) };
let hole = new THREE.Vector2(3.3, 0);
let holed = false;
let sinkT = 0;
let audioOn = false;
let audioContext = null;
let best = Infinity;
let passedCupFast = false;

try {
  const saved = Number(localStorage.getItem('el-putt-perfecto-best'));
  if (Number.isFinite(saved) && saved >= 0) best = saved;
} catch {}

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  world = new THREE.Scene();
  world.background = new THREE.Color('#dfe8de');
  world.fog = new THREE.Fog('#dfe8de', 13, 25);

  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 8.2, 6.8);
  camera.lookAt(0, 0, 0);

  world.add(new THREE.AmbientLight(0xfff7e8, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0cf, 2.5);
  sun.position.set(-4.5, 8.5, 5.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  world.add(sun);

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(GREEN_W + 1.15, GREEN_L + 1.15),
    new THREE.MeshStandardMaterial({ color: '#4f7657', roughness: 1 })
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.025;
  surround.receiveShadow = true;
  world.add(surround);

  const green = new THREE.Mesh(
    new THREE.PlaneGeometry(GREEN_W, GREEN_L),
    new THREE.MeshStandardMaterial({ color: '#74a078', roughness: 0.96 })
  );
  green.rotation.x = -Math.PI / 2;
  green.receiveShadow = true;
  world.add(green);

  const stripeColors = ['#7ca57b', '#6f9a72'];
  const stripeW = GREEN_W / 8;
  for (let i = 0; i < 8; i++) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(stripeW - 0.02, GREEN_L - 0.05),
      new THREE.MeshBasicMaterial({ color: stripeColors[i % 2], transparent: true, opacity: 0.22 })
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(-GREEN_W / 2 + stripeW * (i + 0.5), 0.004, 0);
    world.add(stripe);
  }

  const borderMat = new THREE.MeshStandardMaterial({ color: '#456b4f', roughness: 1 });
  const borderGeoH = new THREE.BoxGeometry(GREEN_W + 0.24, 0.07, 0.12);
  const borderGeoV = new THREE.BoxGeometry(0.12, 0.07, GREEN_L + 0.24);
  for (const z of [-GREEN_L / 2 - 0.06, GREEN_L / 2 + 0.06]) {
    const edge = new THREE.Mesh(borderGeoH, borderMat); edge.position.set(0, 0.025, z); edge.castShadow = true; world.add(edge);
  }
  for (const x of [-GREEN_W / 2 - 0.06, GREEN_W / 2 + 0.06]) {
    const edge = new THREE.Mesh(borderGeoV, borderMat); edge.position.set(x, 0.025, 0); edge.castShadow = true; world.add(edge);
  }

  const shrubGeo = new THREE.DodecahedronGeometry(0.26, 0);
  const shrubMatA = new THREE.MeshStandardMaterial({ color: '#466f53', roughness: 1, flatShading: true });
  const shrubMatB = new THREE.MeshStandardMaterial({ color: '#5e855d', roughness: 1, flatShading: true });
  const shrubPositions = [
    [-4.7, -3.72, .28], [-2.9, 3.73, .24], [-.7, -3.74, .31],
    [1.7, 3.75, .27], [4.4, -3.74, .30], [5.55, 2.2, .25]
  ];
  shrubPositions.forEach(([x, z, s], i) => {
    const shrub = new THREE.Mesh(shrubGeo, i % 2 ? shrubMatA : shrubMatB);
    shrub.scale.setScalar(0.85 + s);
    shrub.position.set(x, 0.18, z);
    shrub.castShadow = true;
    world.add(shrub);
  });

  ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 28, 20),
    new THREE.MeshStandardMaterial({ color: '#fffdf6', roughness: 0.28, metalness: 0.02 })
  );
  ball.castShadow = true;
  world.add(ball);

  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(HOLE_R * 0.86, HOLE_R * 0.92, 0.18, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: '#13291f', roughness: 1, side: THREE.DoubleSide })
  );
  cup.position.y = -0.085;
  world.add(cup);

  holeDisc = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R, 40), new THREE.MeshBasicMaterial({ color: '#10261d' }));
  holeDisc.rotation.x = -Math.PI / 2;
  holeDisc.position.y = 0.006;
  world.add(holeDisc);

  holeRing = new THREE.Mesh(
    new THREE.RingGeometry(HOLE_R, HOLE_R + 0.045, 48),
    new THREE.MeshStandardMaterial({ color: '#efe5cd', roughness: 0.75, side: THREE.DoubleSide })
  );
  holeRing.rotation.x = -Math.PI / 2;
  holeRing.position.y = 0.009;
  world.add(holeRing);

  flagGroup = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 1.48, 10),
    new THREE.MeshStandardMaterial({ color: '#f6f0dd', roughness: 0.55 })
  );
  pole.position.y = 0.74;
  pole.castShadow = true;
  flagGroup.add(pole);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: '#e3c66f', roughness: 0.5 }));
  cap.position.y = 1.49;
  flagGroup.add(cap);

  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0); flagShape.lineTo(0.76, -0.18); flagShape.lineTo(0, -0.39); flagShape.closePath();
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), new THREE.MeshBasicMaterial({ color: '#b75a42', side: THREE.DoubleSide }));
  flag.position.set(0.02, 1.44, 0);
  flag.rotation.y = -0.20;
  flagGroup.add(flag);
  world.add(flagGroup);

  aimLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: '#fff7db', dashSize: 0.16, gapSize: 0.11, transparent: true, opacity: 0.95 })
  );
  pullLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#b75a42', transparent: true, opacity: 0.92 })
  );
  aimLine.visible = pullLine.visible = false;
  world.add(aimLine, pullLine);

  slopeGroup = new THREE.Group();
  const slopeMat = new THREE.LineBasicMaterial({ color: '#dfead5', transparent: true, opacity: 0.38 });
  const marks = [[-1.7,-1.35],[-0.2,1.15],[1.25,-.7],[2.55,.7]];
  marks.forEach(([x,z]) => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.24,0.022,0), new THREE.Vector3(0.25,0.022,0),
      new THREE.Vector3(0.10,0.022,-0.12), new THREE.Vector3(0.25,0.022,0),
      new THREE.Vector3(0.10,0.022,0.12), new THREE.Vector3(0.25,0.022,0)
    ]);
    const line = new THREE.LineSegments(geo, slopeMat);
    line.position.set(x,0,z);
    slopeGroup.add(line);
  });
  world.add(slopeGroup);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  clock = new THREE.Clock();
  resize();
  window.addEventListener('resize', resize);
  renderer.setAnimationLoop(tick);
}

function resize() {
  if (!renderer || !camera) return;
  const rect = sceneEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function setHolePosition(x, z) {
  hole.set(x, z);
  holeDisc.position.set(x, 0.006, z);
  holeRing.position.set(x, 0.009, z);
  flagGroup.position.set(x, 0, z);
}

function arrowFor(angle) {
  const deg = ((angle * 180 / Math.PI) + 360) % 360;
  const arrows = ['→','↘','↓','↙','←','↖','↑','↗'];
  return arrows[Math.round(deg / 45) % 8];
}

function windLabel() {
  if (wind.speed < 0.5) return 'CALMA · 0 km/h';
  return `${arrowFor(wind.angle)} ${Math.round(wind.speed)} km/h`;
}

function slopeLabel() {
  const strength = slope.strength < 0.10 ? 'SUAVE' : slope.strength < 0.14 ? 'MEDIA' : 'MARCADA';
  return `${arrowFor(slope.angle)} ${strength}`;
}

function startRound() {
  roundNumber++;
  phase = 'ready';
  dragging = false;
  holed = false;
  sinkT = 0;
  passedCupFast = false;
  shotVelocity.set(0, 0);
  ball.visible = true;
  ball.scale.setScalar(1);
  ball.rotation.set(0, 0, 0);

  ball.position.set(rand(-3.72, -3.30), BALL_R, rand(-0.42, 0.42));
  setHolePosition(rand(2.70, 3.88), rand(-1.58, 1.58));

  const speed = Math.random() < 0.14 ? 0 : rand(1.5, 8);
  let angle;
  if (Math.random() < 0.78) angle = (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + rand(-0.32, 0.32);
  else angle = rand(0, Math.PI * 2);
  const magnitude = (speed / 8) * WIND_ACCEL_MAX;
  wind = { speed, angle, vector: new THREE.Vector2(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude) };

  const slopeAngle = (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + rand(-0.55, 0.55);
  const slopeStrength = rand(SLOPE_ACCEL_MIN, SLOPE_ACCEL_MAX);
  slope = {
    strength: slopeStrength,
    angle: slopeAngle,
    vector: new THREE.Vector2(Math.cos(slopeAngle) * slopeStrength, Math.sin(slopeAngle) * slopeStrength)
  };
  if (slopeGroup) slopeGroup.rotation.y = -slopeAngle;

  aimLine.visible = pullLine.visible = false;
  $('power').hidden = true;
  $('round-label').textContent = `PUTT ${String(roundNumber).padStart(2, '0')}`;
  $('wind').textContent = windLabel();
  $('slope').textContent = slopeLabel();
  $('scene-label').textContent = 'ARRASTRA LA BOLA HACIA LA IZQUIERDA Y SUELTA';
  $('ready').hidden = false;
  $('rolling').hidden = true;
  $('result').hidden = true;
  $('scene-overlay').replaceChildren();
}

function pointerToGreen(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}

function setLine(line, points) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points);
  if (line.computeLineDistances) line.computeLineDistances();
}

function updateAim(point) {
  const bx = ball.position.x;
  const bz = ball.position.z;
  const pull = new THREE.Vector2(bx - point.x, bz - point.z);
  const rawLength = pull.length();
  const length = clamp(rawLength, 0, MAX_DRAG);
  const power = clamp((length - MIN_DRAG) / (MAX_DRAG - MIN_DRAG), 0, 1);
  if (rawLength > 0.001) pull.setLength(length);

  dragPoint.set(bx - pull.x, 0.03, bz - pull.y);
  setLine(pullLine, [new THREE.Vector3(bx, 0.04, bz), dragPoint.clone()]);
  pullLine.visible = true;

  const dir = pull.lengthSq() > 0.001 ? pull.clone().normalize() : new THREE.Vector2(1, 0);
  const guideLength = 0.85 + power * 1.85;
  setLine(aimLine, [new THREE.Vector3(bx, 0.045, bz), new THREE.Vector3(bx + dir.x * guideLength, 0.045, bz + dir.y * guideLength)]);
  aimLine.visible = true;

  $('power').hidden = false;
  $('power-value').textContent = `${Math.round(power * 100)}%`;
  return { dir, rawLength, power };
}

function onPointerDown(event) {
  if (phase !== 'ready') return;
  const point = pointerToGreen(event);
  if (!point) return;
  if (Math.hypot(point.x - ball.position.x, point.z - ball.position.z) > 0.78) return;
  dragging = true;
  sceneEl.setPointerCapture?.(event.pointerId);
  dragPoint.copy(point);
  updateAim(point);
  event.preventDefault();
}

function onPointerMove(event) {
  if (!dragging || phase !== 'ready') return;
  const point = pointerToGreen(event);
  if (!point) return;
  dragPoint.copy(point);
  updateAim(point);
  event.preventDefault();
}

function onPointerUp(event) {
  if (!dragging || phase !== 'ready') return;
  dragging = false;
  sceneEl.releasePointerCapture?.(event.pointerId);
  const point = pointerToGreen(event) || dragPoint;
  const shot = updateAim(point);

  if (shot.rawLength < MIN_DRAG) {
    aimLine.visible = pullLine.visible = false;
    $('power').hidden = true;
    $('scene-label').textContent = 'ARRASTRA UN POCO MÁS';
    setTimeout(() => { if (phase === 'ready') $('scene-label').textContent = 'ARRASTRA LA BOLA HACIA LA IZQUIERDA Y SUELTA'; }, 900);
    return;
  }

  if (shot.dir.x < 0.12) {
    aimLine.visible = pullLine.visible = false;
    $('power').hidden = true;
    $('scene-label').textContent = 'EL GOLPE DEBE IR HACIA LA DERECHA';
    setTimeout(() => { if (phase === 'ready') $('scene-label').textContent = 'ARRASTRA LA BOLA HACIA LA IZQUIERDA Y SUELTA'; }, 1000);
    return;
  }

  const speed = 1.48 + shot.power * 3.08;
  shotVelocity.set(shot.dir.x * speed, shot.dir.y * speed);
  phase = 'rolling';
  aimLine.visible = pullLine.visible = false;
  $('power').hidden = true;
  $('ready').hidden = true;
  $('rolling').hidden = false;
  $('scene-label').textContent = 'UN SOLO GOLPE · AHORA MIRA';
  tone(180, 0.045, 0.08);
  event.preventDefault();
}

function physics(dt) {
  if (phase !== 'rolling' || holed) return;
  const speed = shotVelocity.length();
  if (speed < 0.07) return finish(false);

  const friction = shotVelocity.clone().normalize().multiplyScalar(-FRICTION);
  const accel = friction.add(wind.vector).add(slope.vector);
  const previousSpeed = speed;
  shotVelocity.addScaledVector(accel, dt);

  if (shotVelocity.length() > previousSpeed + 0.08 && previousSpeed < 0.15) shotVelocity.set(0, 0);

  ball.position.x += shotVelocity.x * dt;
  ball.position.z += shotVelocity.y * dt;
  ball.rotation.z -= shotVelocity.x * dt / BALL_R;
  ball.rotation.x += shotVelocity.y * dt / BALL_R;

  const dx = ball.position.x - hole.x;
  const dz = ball.position.z - hole.y;
  const dist = Math.hypot(dx, dz);
  const currentSpeed = shotVelocity.length();

  if (dist < HOLE_R * 0.74) {
    if (currentSpeed <= CUP_CAPTURE_SPEED) return beginSink();
    passedCupFast = true;
  }

  if (Math.abs(ball.position.x) > GREEN_W / 2 + 0.25 || Math.abs(ball.position.z) > GREEN_L / 2 + 0.25) finish(false, true);
}

function beginSink() {
  holed = true;
  sinkT = 0;
  shotVelocity.set(0, 0);
  tone(520, 0.08, 0.06);
  setTimeout(() => tone(760, 0.12, 0.055), 70);
}

function animateSink(dt) {
  if (!holed || phase !== 'rolling') return;
  sinkT += dt / (reduceMotion.matches ? 0.05 : 0.42);
  const t = clamp(sinkT, 0, 1);
  ball.position.x += (hole.x - ball.position.x) * Math.min(1, dt * 12);
  ball.position.z += (hole.y - ball.position.z) * Math.min(1, dt * 12);
  ball.position.y = BALL_R - t * 0.34;
  ball.scale.setScalar(1 - t * 0.38);
  if (t >= 1) {
    ball.visible = false;
    finish(true);
  }
}

function finish(isHoled, out = false) {
  if (phase !== 'rolling') return;
  phase = 'result';
  const distanceM = isHoled ? 0 : Math.hypot(ball.position.x - hole.x, ball.position.z - hole.y);
  const cm = Math.round(distanceM * 100);
  let verdict;
  let detail;

  if (isHoled) {
    verdict = '¡Putt perfecto!';
    detail = 'Un golpe. Dentro.';
  } else if (out) {
    verdict = 'Fuera.';
    detail = 'Te fuiste del green.';
  } else if (passedCupFast && cm <= 95) {
    verdict = '¡Demasiado fuerte!';
    detail = 'Pasó por el hoyo, pero llevaba demasiada velocidad.';
  } else if (cm <= 12) {
    verdict = '¡Casi!';
    detail = `Se quedó a solo ${cm} cm.`;
  } else if (cm <= 35) {
    verdict = 'Buen intento.';
    detail = `A ${cm} cm del hoyo.`;
  } else {
    verdict = 'Una más.';
    detail = `A ${cm} cm del hoyo.`;
  }

  $('rolling').hidden = true;
  $('result').hidden = false;
  $('verdict').textContent = verdict;
  $('distance').textContent = isHoled ? '✓' : String(cm);
  $('distance-unit').innerHTML = isHoled ? 'EMBOCADO<br />DE UN GOLPE' : 'CM<br />DEL HOYO';
  $('side').textContent = detail;
  $('scene-label').textContent = isHoled ? 'PUTT PERFECTO' : (passedCupFast ? 'PASÓ DE LARGO' : 'RESULTADO REGISTRADO');

  if (distanceM < best) {
    best = distanceM;
    try { localStorage.setItem('el-putt-perfecto-best', String(best)); } catch {}
  }
  $('best').textContent = Number.isFinite(best)
    ? (best === 0 ? 'MEJOR MARCA · EMBOCADO' : `MEJOR MARCA · ${Math.round(best * 100)} CM`)
    : 'MEJOR MARCA · —';

  if (isHoled) {
    celebrate();
    tone(880, 0.16, 0.07);
  } else {
    tone(passedCupFast ? 205 : 250, 0.06, 0.035);
  }

  trackCompletedRound();
  if (window.innerWidth <= 700) $('result').scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'instant' : 'smooth' });
}

function celebrate() {
  if (reduceMotion.matches) return;
  const layer = $('scene-overlay');
  const colors = ['#b75a42','#f0c86b','#f9f4e6','#315f4d','#86aa84'];
  for (let i = 0; i < 28; i++) {
    const piece = document.createElement('i');
    piece.className = 'confetti';
    piece.style.left = `${55 + Math.random() * 25}%`;
    piece.style.top = `${25 + Math.random() * 25}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--dx', `${(Math.random() - 0.5) * 300}px`);
    piece.style.setProperty('--dy', `${110 + Math.random() * 190}px`);
    piece.style.animationDelay = `${Math.random() * 0.15}s`;
    layer.append(piece);
  }
  setTimeout(() => layer.replaceChildren(), 1600);
}

function trackCompletedRound() {
  const send = () => {
    try { window.goatcounter?.count?.({ path: 'putt-completado', title: 'Putt completado', event: true, no_session: true }); } catch {}
  };
  if (window.goatcounter?.count) send();
  else document.querySelector('script[data-goatcounter]')?.addEventListener('load', send, { once: true });
}

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
}

function tone(frequency, duration, volume) {
  if (!audioOn) return;
  try {
    ensureAudio();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    osc.connect(gain).connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration);
  } catch {}
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.033);
  physics(dt);
  animateSink(dt);
  if (flagGroup) flagGroup.children[2].rotation.y = -0.20 + Math.sin(performance.now() / 850) * 0.08;
  renderer.render(world, camera);
}

function bookmarkHelp() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'En Safari, pulsa Compartir y elige «Añadir a favoritos». Si estás dentro de Instagram, abre antes el enlace en Safari.';
  if (/Android/i.test(ua)) return 'Abre el menú ⋮ del navegador y elige «Añadir a marcadores» o toca la estrella.';
  return 'Pulsa Ctrl+D (Windows/Linux) o ⌘+D (Mac) y confirma el marcador en tu navegador.';
}

sceneEl.addEventListener('pointerdown', onPointerDown);
sceneEl.addEventListener('pointermove', onPointerMove);
sceneEl.addEventListener('pointerup', onPointerUp);
sceneEl.addEventListener('pointercancel', () => {
  dragging = false;
  aimLine.visible = pullLine.visible = false;
  $('power').hidden = true;
});

$('again').addEventListener('click', startRound);
$('sound').addEventListener('click', () => {
  audioOn = !audioOn;
  $('sound').setAttribute('aria-pressed', String(audioOn));
  $('sound').setAttribute('aria-label', audioOn ? 'Desactivar sonido' : 'Activar sonido');
  $('sound-label').textContent = audioOn ? 'ON' : 'OFF';
  $('sound-icon').textContent = audioOn ? '◖))' : '◖̸';
  if (audioOn) { ensureAudio(); tone(440, 0.08, 0.04); }
});

$('bookmark').addEventListener('click', () => {
  $('bookmark-text').textContent = bookmarkHelp();
  $('bookmark-dialog').showModal();
});

try {
  initThree();
  startRound();
} catch (error) {
  console.error(error);
  $('scene-label').textContent = 'NO SE PUDO INICIAR EL GREEN · RECARGA LA PÁGINA';
}