import PoseEngine from './pose-engine.js';
import { createTextTrailer } from './sketches/text-trailer.js';
import { createBodyTranscriber } from './sketches/body-transcriber.js';
import { createCollageCreator } from './sketches/collage-creator.js';
import { createFeltSound } from './sketches/felt-sound.js';

const hub = document.getElementById('hub');
const sketchView = document.getElementById('sketch-view');
const loadingOverlay = document.getElementById('loading-overlay');
const outputCanvas = document.getElementById('output-canvas');
const videoEl = document.getElementById('video');
const webcamPreview = document.getElementById('webcam-preview');
const controlsContainer = document.getElementById('controls');
const sketchTitle = document.getElementById('sketch-title');
const backBtn = document.getElementById('back-btn');

let poseEngine = null;
let activeSketch = null;
let animFrameId = null;

const sketches = {
  'text-trailer': { title: 'Movement Script', factory: createTextTrailer },
  'body-transcriber': { title: 'Spoken Body', factory: createBodyTranscriber },
  'collage-creator': { title: 'Worn Image', factory: createCollageCreator },
  'felt-sound': { title: 'Felt Sound', factory: createFeltSound },
};

// ─── Camera ───
async function setupCamera(width, height) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width, height },
  });
  videoEl.srcObject = stream;
  videoEl.width = width;
  videoEl.height = height;
  await new Promise((r) => { videoEl.onloadedmetadata = r; });
  videoEl.play();
  return videoEl;
}

// ─── Render loop ───
function startLoop(sketch, video, canvas, engine) {
  const ctx = canvas.getContext('2d');
  let frameToggle = false;
  let poses = [];

  const previewCtx = webcamPreview.getContext('2d');
  webcamPreview.width = 180;
  webcamPreview.height = Math.round(180 * (video.height / video.width));

  function loop() {
    animFrameId = requestAnimationFrame(loop);

    if (frameToggle) {
      engine.estimatePoses(video).then((p) => { poses = p; });
    }
    frameToggle = !frameToggle;

    sketch.draw(ctx, canvas, poses, video);

    // Webcam preview
    if (sketch.state?.showWebcamPreview !== false) {
      previewCtx.save();
      previewCtx.scale(-1, 1);
      previewCtx.translate(-webcamPreview.width, 0);
      previewCtx.drawImage(video, 0, 0, webcamPreview.width, webcamPreview.height);
      previewCtx.restore();
      webcamPreview.style.display = 'block';
    } else {
      webcamPreview.style.display = 'none';
    }
  }

  loop();
}

function stopLoop() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (activeSketch?.destroy) activeSketch.destroy();
  activeSketch = null;
}

// ─── Loading progress ───
const loadingPct = document.getElementById('loading-pct');
const loadingLabel = document.getElementById('loading-label');
let currentPct = 0;
let targetPct = 0;
let pctAnimId = null;

function setLoadingTarget(pct, label) {
  targetPct = pct;
  if (label) loadingLabel.textContent = label;
  if (!pctAnimId) tickPct();
}

function tickPct() {
  const diff = targetPct - currentPct;
  if (Math.abs(diff) < 0.5) {
    currentPct = targetPct;
  } else {
    currentPct += diff * 0.18;
  }
  loadingPct.textContent = Math.round(currentPct) + '%';
  if (currentPct < targetPct || Math.round(currentPct) < 100) {
    pctAnimId = requestAnimationFrame(tickPct);
  } else {
    pctAnimId = null;
  }
}

function resetLoading() {
  currentPct = 0;
  targetPct = 0;
  loadingPct.textContent = '0%';
  loadingLabel.textContent = 'Initializing…';
  if (pctAnimId) { cancelAnimationFrame(pctAnimId); pctAnimId = null; }
}

// ─── Navigation ───
async function openSketch(name) {
  const def = sketches[name];
  if (!def) return;

  hub.style.display = 'none';
  sketchView.style.display = 'block';
  loadingOverlay.style.display = 'flex';
  resetLoading();
  sketchTitle.textContent = def.title;
  controlsContainer.innerHTML = '';

  const vw = Math.min(window.innerWidth - 320, 960);
  const vh = Math.round(vw * 0.75);

  try {
    setLoadingTarget(20, 'Accessing camera…');
    const video = await setupCamera(vw, vh);

    if (!poseEngine) {
      setLoadingTarget(40, 'Loading AI model…');
      poseEngine = new PoseEngine();
      await poseEngine.init();
    }

    setLoadingTarget(80, 'Setting up sketch…');
    outputCanvas.width = vw;
    outputCanvas.height = vh;

    activeSketch = def.factory(poseEngine, controlsContainer);
    if (activeSketch.setup) {
      activeSketch.setup(outputCanvas, video, vw, vh);
    }

    setLoadingTarget(100, 'Ready');
    await new Promise((r) => setTimeout(r, 300));

    loadingOverlay.style.display = 'none';
    startLoop(activeSketch, video, outputCanvas, poseEngine);
  } catch (err) {
    loadingLabel.textContent = 'Error: ' + err.message;
    loadingPct.textContent = '—';
    console.error(err);
  }
}

function closeSketch() {
  stopLoop();
  // Stop camera
  if (videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
  }
  sketchView.style.display = 'none';
  hub.style.display = 'flex';
}

// ─── Event Bindings ───
document.querySelectorAll('.sketch-card').forEach((card) => {
  card.addEventListener('click', () => openSketch(card.dataset.sketch));
});

backBtn.addEventListener('click', closeSketch);

// ─── Helpers exported for sketches ───
export function makeCtrlGroup(parent, title) {
  const group = document.createElement('div');
  group.className = 'ctrl-group';
  if (title) {
    const t = document.createElement('div');
    t.className = 'ctrl-group-title';
    t.textContent = title;
    group.appendChild(t);
  }
  parent.appendChild(group);
  return group;
}

export function addColorPicker(parent, label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.innerHTML = `<span class="ctrl-label">${label}</span>`;
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = value;
  inp.addEventListener('input', () => onChange(inp.value));
  row.appendChild(inp);
  parent.appendChild(row);
  return inp;
}

export function addSlider(parent, label, min, max, step, value, onChange) {
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  const valSpan = document.createElement('span');
  valSpan.className = 'range-val';
  valSpan.textContent = value;
  row.innerHTML = `<span class="ctrl-label">${label}</span>`;
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = min;
  inp.max = max;
  inp.step = step;
  inp.value = value;
  inp.addEventListener('input', () => {
    valSpan.textContent = inp.value;
    onChange(parseFloat(inp.value));
  });
  row.appendChild(inp);
  row.appendChild(valSpan);
  parent.appendChild(row);
  return inp;
}

export function addTextInput(parent, label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.innerHTML = `<span class="ctrl-label">${label}</span>`;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = value;
  inp.addEventListener('input', () => onChange(inp.value));
  row.appendChild(inp);
  parent.appendChild(row);
  return inp;
}

export function addSelect(parent, label, options, value, onChange) {
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.innerHTML = `<span class="ctrl-label">${label}</span>`;
  const sel = document.createElement('select');
  options.forEach((opt) => {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(sel);
  parent.appendChild(row);
  return sel;
}

export function addToggle(parent, label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.innerHTML = `<span class="ctrl-label">${label}</span>`;
  const toggle = document.createElement('label');
  toggle.className = 'toggle';
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.checked = value;
  inp.addEventListener('change', () => onChange(inp.checked));
  const track = document.createElement('span');
  track.className = 'toggle-track';
  toggle.appendChild(inp);
  toggle.appendChild(track);
  row.appendChild(toggle);
  parent.appendChild(row);
  return inp;
}

export function addFileUpload(parent, label, accept, onChange) {
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.innerHTML = `<span class="ctrl-label">${label}</span>`;
  const btn = document.createElement('label');
  btn.className = 'upload-btn';
  btn.textContent = 'Choose file';
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept;
  inp.addEventListener('change', () => {
    if (inp.files[0]) {
      btn.textContent = inp.files[0].name.slice(0, 16);
      onChange(inp.files[0]);
    }
  });
  btn.appendChild(inp);
  row.appendChild(btn);
  parent.appendChild(row);
  return inp;
}
