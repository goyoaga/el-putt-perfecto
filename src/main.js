import * as THREE from 'three';
import './style.css';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const sceneEl = $('scene');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const GREEN_W = 7.4;
const GREEN_L = 10.6;
const BALL_R = 0.13;
const HOLE_R = 0.19;
const MIN_DRAG = 0.28;
const MAX_DRAG = 2.35;
const FRICTION = 1.02;
const WIND_ACCEL_MAX = 0.085;

let renderer;
let camera;
let world;
let ball;
let holeDisc;
let holeRing;
let flagGroup;
let aimLine;
let pullLine;
let raycaster;
let pointer;
let groundPlane;
let clock;
let phase = 'ready';
let roundNumber = 0;
let dragging = false;
let dragPoint = new THREE.Vector3();
let shotVelocity = new THREE.Vector2();
let wind = { speed: 0, angle: 0, vector: new THREE.Vector2() };
let hole = new THREE.Vector2(0, -3);
let holed = false;
let sinkT = 0;
let audioOn = false;
let audioContext = null;
let best = Infinity;

try {
  const saved = Number(localStorage.getItem('el-putt-perfecto-best'));
  if (Number.isFinite(saved) && saved >= 0) best = saved;
} catch { /* Storage is optional. */ }

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  world = new THREE.Scene();
  world.background = new THREE.Color('#dfe8de');

  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 8.7, 8.3);
  camera.lookAt(0, 0, -0.6);

  const ambient = new THREE.AmbientLight(0xfff7e8, 2.1);
  world.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff2d5, 2.4);
  sun.position.set(-4, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  world.add(sun);

  const green = new THREE.Mesh(
    new THREE.PlaneGeometry(GREEN_W, GREEN_L),
    new THREE.MeshStandardMaterial({ color: '#6f9b73', roughness: 0.95, metalness: 0 })
  );
  green.rotation.x = -Math.PI / 2;
  green.receiveShadow = true;
  world.add(green);

  const borderMat = new THREE.MeshBasicMaterial({ color: '#52785b' });
  const borderGeoH = new THREE.BoxGeometry(GREEN_W + 0.22, 0.055, 0.10);
  const borderGeoV = new THREE.BoxGeometry(0.10, 0.055, GREEN_L + 0.22);
  for (const z of [-GREEN_L / 2 - 0.05, GREEN_L / 2 + 0.05]) {
    const edge = new THREE.Mesh(borderGeoH, borderMat); edge.position.set(0, 0.025, z); world.add(edge);
  }
  for (const x of [-GREEN_W / 2 - 0.05, GREEN_W / 2 + 0.05]) {
    const edge = new THREE.Mesh(borderGeoV, borderMat); edge.position.set(x, 0.025, 0); world.add(edge);
  }

  ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 24, 18),
    new THREE.MeshStandardMaterial({ color: '#fffdf6', roughness: 0.35, metalness: 0 })
  );
  ball.castShadow = true;
  ball.position.set(0, BALL_R, 3.7);
  world.add(ball);

  holeDisc = new THREE.Mesh(
    new THREE.CircleGeometry(HOLE_R, 40),
    new THREE.MeshBasicMaterial({ color: '#173127' })
  );
  holeDisc.rotation.x = -Math.PI / 2;
  holeDisc.position.y = 0.006;
  world.add(holeDisc);

  holeRing = new THREE.Mesh(
    new THREE.RingGeometry(HOLE_R, HOLE_R + 0.035, 40),
    new THREE.MeshBasicMaterial({ color: '#f1e9d7', side: THREE.DoubleSide })
  );
  holeRing.rotation.x = -Math.PI / 2;
  holeRing.position.y = 0.009;
  world.add(holeRing);

  flagGroup = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.45, 10), new THREE.MeshStandardMaterial({ color: '#f6f0dd', roughness: 0.6 }));
  pole.position.y = 0.725;
  pole.castShadow = true;
  flagGroup.add(pole);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0); flagShape.lineTo(0.72, -0.18); flagShape.lineTo(0, -0.38); flagShape.closePath();
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), new THREE.MeshBasicMaterial({ color: '#b75a42', side: THREE.DoubleSide }));
  flag.position.set(0.02, 1.40, 0);
  flag.rotation.y = -0.20;
  flagGroup.add(flag);
  world.add(flagGroup);

  const aimMat = new THREE.LineDashedMaterial({ color: '#f8f0d7', dashSize: 0.16, gapSize: 0.11, transparent: true, opacity: 0.95 });
  aimLine = new THREE.Line(new THREE.BufferGeometry(), aimMat);
  aimLine.visible = false;
  world.add(aimLine);

  const pullMat = new THREE.LineBasicMaterial({ color: '#b75a42', transparent: true, opacity: 0.9 });
  pullLine = new THREE.Line(new THREE.BufferGeometry(), pullMat);
  pullLine.visible = false;
  world.add(pullLine);

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

function windLabel() {
  if (wind.speed < 0.5) return 'CALMA · 0 km/h';
  const deg = ((wind.angle * 180 / Math.PI) + 360) % 360;
  let arrow = '→';
  if (deg >= 22.5 && deg < 67.5) arrow = '↘';
  else if (deg >= 67.5 && deg < 112.5) arrow = '↓';
  else if (deg >= 112.5 && deg < 157.5) arrow = '↙';
  else if (deg >= 157.5 && deg < 202.5) arrow = '←';
  else if (deg >= 202.5 && deg < 247.5) arrow = '↖';
  else if (deg >= 247.5 && deg < 292.5) arrow = '↑';
  else if (deg >= 292.5 && deg < 337.5) arrow = '↗';
  return `${arrow} ${Math.round(wind.speed)} km/h`;
}

function startRound() {
  roundNumber += 1;
  phase = 'ready';
  dragging = false;
  holed = false;
  sinkT = 0;
  shotVelocity.set(0, 0);
  ball.visible = true;
  ball.scale.setScalar(1);
  ball.position.set(rand(-0.28, 0.28), BALL_R, rand(3.45, 3.9));
  ball.rotation.set(0, 0, 0);

  const holeX = rand(-2.45, 2.45);
  const holeZ = rand(-3.55, -1.75);
  setHolePosition(holeX, holeZ);

  const speed = Math.random() < 0.14 ? 0 : rand(1.5, 8);
  const mostlyLateral = Math.random() < 0.72;
  let angle;
  if (mostlyLateral) angle = Math.random() < 0.5 ? rand(-0.38, 0.38) : Math.PI + rand(-0.38, 0.38);
  else angle = rand(0, Math.PI * 2);
  const magnitude = (speed / 8) * WIND_ACCEL_MAX;
  wind = { speed, angle, vector: new THREE.Vector2(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude) };

  aimLine.visible = false;
  pullLine.visible = false;
  $('power').hidden = true;
  $('round-label').textContent = `PUTT ${String(roundNumber).padStart(2, '0')}`;
  $('wind').textContent = windLabel();
  $('scene-label').textContent = 'ARRASTRA DESDE LA BOLA Y SUELTA';
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

  const dir = pull.lengthSq() > 0.001 ? pull.clone().normalize() : new THREE.Vector2(0, -1);
  const guideLength = 0.9 + power * 2.1;
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
  const dist = Math.hypot(point.x - ball.position.x, point.z - ball.position.z);
  if (dist > 0.72) return;
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
    aimLine.visible = false;
    pullLine.visible = false;
    $('power').hidden = true;
    $('scene-label').textContent = 'ARRASTRA UN POCO MÁS';
    setTimeout(() => { if (phase === 'ready') $('scene-label').textContent = 'ARRASTRA DESDE LA BOLA Y SUELTA'; }, 900);
    return;
  }

  const speed = 1.48 + shot.power * 3.08;
  shotVelocity.set(shot.dir.x * speed, shot.dir.y * speed);
  phase = 'rolling';
  aimLine.visible = false;
  pullLine.visible = false;
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
  if (speed < 0.07) {
    finish(false);
    return;
  }

  const friction = shotVelocity.clone().normalize().multiplyScalar(-FRICTION);
  const accel = friction.add(wind.vector);
  const previousSpeed = speed;
  shotVelocity.addScaledVector(accel, dt);
  if (shotVelocity.dot(new THREE.Vector2(ball.position.x, ball.position.z)) === Infinity) shotVelocity.set(0, 0);
  if (shotVelocity.length() > previousSpeed + 0.05 && previousSpeed < 0.16) shotVelocity.set(0, 0);

  ball.position.x += shotVelocity.x * dt;
  ball.position.z += shotVelocity.y * dt;
  const rollSpeed = shotVelocity.length();
  ball.rotation.z -= shotVelocity.x * dt / BALL_R;
  ball.rotation.x += shotVelocity.y * dt / BALL_R;

  const dx = ball.position.x - hole.x;
  const dz = ball.position.z - hole.y;
  const dist = Math.hypot(dx, dz);
  const captureSpeed = dist < HOLE_R * 0.70 ? 2.55 : 1.72;
  if (dist < HOLE_R * 1.02 && rollSpeed <= captureSpeed) {
    beginSink();
    return;
  }

  if (Math.abs(ball.position.x) > GREEN_W / 2 + 0.25 || Math.abs(ball.position.z) > GREEN_L / 2 + 0.25) {
    finish(false, true);
  }
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
  ball.scale.setScalar(1 - t * 0.35);
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
  $('scene-label').textContent = isHoled ? 'PUTT PERFECTO' : 'RESULTADO REGISTRADO';

  if (distanceM < best) {
    best = distanceM;
    try { localStorage.setItem('el-putt-perfecto-best', String(best)); } catch { /* Session-only best. */ }
  }
  $('best').textContent = Number.isFinite(best) ? (best === 0 ? 'MEJOR MARCA · EMBOCADO' : `MEJOR MARCA · ${Math.round(best * 100)} CM`) : 'MEJOR MARCA · —';

  if (isHoled) {
    celebrate();
    tone(880, 0.16, 0.07);
  } else tone(250, 0.06, 0.035);
  trackCompletedRound();

  if (window.innerWidth <= 700) $('result').scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'instant' : 'smooth' });
}

function celebrate() {
  if (reduceMotion.matches) return;
  const layer = $('scene-overlay');
  const colors = ['#b75a42', '#f0c86b', '#f9f4e6', '#315f4d', '#86aa84'];
  for (let i = 0; i < 28; i++) {
    const piece = document.createElement('i');
    piece.className = 'confetti';
    piece.style.left = `${38 + Math.random() * 25}%`;
    piece.style.top = `${28 + Math.random() * 18}%`;
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
    try { window.goatcounter?.count?.({ path: 'putt-completado', title: 'Putt completado', event: true, no_session: true }); }
    catch { /* Analytics never affects play. */ }
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
  } catch { /* Sound is optional. */ }
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.033);
  physics(dt);
  animateSink(dt);
  if (flagGroup) flagGroup.children[1].rotation.y = -0.20 + Math.sin(performance.now() / 850) * 0.08;
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
  aimLine.visible = false;
  pullLine.visible = false;
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
