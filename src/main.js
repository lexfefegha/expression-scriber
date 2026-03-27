import './device-gate.js';
import PoseEngine, { Readiness } from './pose-engine.js';
import { createGuideOverlay } from './guide-overlay.js';
import { createTextTrailer } from './sketches/text-trailer.js';
import { createBodyTranscriber } from './sketches/body-transcriber.js';
import { createCollageCreator } from './sketches/collage-creator.js';
import { createFeltSound } from './sketches/felt-sound.js';
import { createRecorder } from './recorder.js';

const hub = document.getElementById('hub');
const sketchView = document.getElementById('sketch-view');
const loadingOverlay = document.getElementById('loading-overlay');
const outputCanvas = document.getElementById('output-canvas');
const videoEl = document.getElementById('video');
const webcamPreview = document.getElementById('webcam-preview');
const controlsContainer = document.getElementById('controls');
const sketchTitle = document.getElementById('sketch-title');
const backBtn = document.getElementById('back-btn');
const recordBtn = document.getElementById('record-btn');
const recIndicator = document.getElementById('rec-indicator');
const recTimer = document.getElementById('rec-timer');

let poseEngine = null;
let activeSketch = null;
let animFrameId = null;
let poseTimeoutId = null;
let guideOverlay = null;
let recorder = null;
let recTimerInterval = null;

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

// ─── Decoupled pose estimation ───
// Runs on its own timer (~30fps), separate from the render loop (~60fps).
// The render loop interpolates between the two most recent estimates.
let latestPoses = [];
let prevPoses = [];
let poseTimestamp = 0;
let prevPoseTimestamp = 0;

function startPoseEstimation(video, engine) {
  const POSE_INTERVAL_MS = 33;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const newPoses = await engine.estimatePoses(video);
    if (stopped) return;
    prevPoses = latestPoses;
    prevPoseTimestamp = poseTimestamp;
    latestPoses = newPoses;
    poseTimestamp = performance.now();

    poseTimeoutId = setTimeout(tick, POSE_INTERVAL_MS);
  }

  tick();

  // Stash stop flag so stopPoseEstimation can halt in-flight ticks
  stopPoseEstimation._stop = () => { stopped = true; };
}

function stopPoseEstimation() {
  if (stopPoseEstimation._stop) {
    stopPoseEstimation._stop();
    stopPoseEstimation._stop = null;
  }
  if (poseTimeoutId) {
    clearTimeout(poseTimeoutId);
    poseTimeoutId = null;
  }
  latestPoses = [];
  prevPoses = [];
}

function getInterpolatedPoses() {
  if (latestPoses.length === 0) return [];
  if (prevPoses.length === 0 || prevPoseTimestamp === poseTimestamp) return latestPoses;

  const now = performance.now();
  const elapsed = poseTimestamp - prevPoseTimestamp;
  if (elapsed <= 0) return latestPoses;

  const t = Math.min((now - poseTimestamp) / elapsed, 1);

  return latestPoses.map((pose, pi) => {
    const prev = prevPoses[pi];
    if (!prev) return pose;

    const keypoints = pose.keypoints.map((kp, ki) => {
      const prevKp = prev.keypoints[ki];
      if (!prevKp) return kp;
      return {
        ...kp,
        position: {
          x: prevKp.position.x + (kp.position.x - prevKp.position.x) * t,
          y: prevKp.position.y + (kp.position.y - prevKp.position.y) * t,
        },
      };
    });

    const parts = {};
    keypoints.forEach((kp) => { parts[kp.part] = kp; });

    return { ...pose, keypoints, parts };
  });
}

// ─── Coordinate scaling ───
// MoveNet returns keypoints in video.videoWidth × video.videoHeight pixel space,
// but the canvas can be a different resolution. This maps keypoints to canvas space.
function scalePosesToCanvas(poses, video, canvas) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return poses;

  const sx = canvas.width / vw;
  const sy = canvas.height / vh;

  if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return poses;

  return poses.map(pose => {
    const keypoints = pose.keypoints.map(kp => ({
      ...kp,
      position: {
        x: kp.position.x * sx,
        y: kp.position.y * sy,
      },
    }));
    const parts = {};
    keypoints.forEach(kp => { parts[kp.part] = kp; });
    return { ...pose, keypoints, parts };
  });
}

// ─── Render loop ───
function startLoop(sketch, video, canvas, engine) {
  const ctx = canvas.getContext('2d');

  const previewCtx = webcamPreview.getContext('2d');
  const previewW = 240;
  const previewH = Math.round(previewW * (video.height / video.width));
  webcamPreview.width = previewW;
  webcamPreview.height = previewH;

  guideOverlay = createGuideOverlay();
  guideOverlay.update(engine.readiness);

  engine.onReadinessChange((state) => {
    guideOverlay.update(state);
  });

  function loop() {
    animFrameId = requestAnimationFrame(loop);

    const rawPoses = getInterpolatedPoses();
    const poses = scalePosesToCanvas(rawPoses, video, canvas);
    const effectivePoses = poses.length > 0 ? poses
      : (engine.readiness === Readiness.LOST && engine.lastGoodPose)
        ? scalePosesToCanvas([engine.lastGoodPose], video, canvas)
        : [];

    sketch.draw(ctx, canvas, effectivePoses, video);

    guideOverlay.draw(ctx, canvas);

    if (recorder && recorder.isRecording()) {
      recorder.captureFrame();
    }

    // Webcam preview with skeleton overlay
    if (sketch.state?.showWebcamPreview !== false) {
      previewCtx.save();
      previewCtx.scale(-1, 1);
      previewCtx.translate(-previewW, 0);
      previewCtx.drawImage(video, 0, 0, previewW, previewH);
      previewCtx.restore();

      // Draw skeleton on preview (poses are in canvas space, scale to preview)
      const pose = poses[0];
      if (pose) {
        const scaleX = previewW / canvas.width;
        const scaleY = previewH / canvas.height;
        const edges = engine.getAdjacentKeyPoints(pose.keypoints, 0.3);

        previewCtx.save();
        previewCtx.strokeStyle = 'rgba(202, 238, 255, 0.7)';
        previewCtx.lineWidth = 1.5;
        previewCtx.lineCap = 'round';

        for (const [a, b] of edges) {
          previewCtx.beginPath();
          previewCtx.moveTo(a.position.x * scaleX, a.position.y * scaleY);
          previewCtx.lineTo(b.position.x * scaleX, b.position.y * scaleY);
          previewCtx.stroke();
        }

        for (const kp of pose.keypoints) {
          if (kp.score < 0.3) continue;
          previewCtx.beginPath();
          previewCtx.arc(kp.position.x * scaleX, kp.position.y * scaleY, 2.5, 0, Math.PI * 2);
          previewCtx.fillStyle = `rgba(202, 238, 255, ${Math.min(kp.score, 0.9)})`;
          previewCtx.fill();
        }

        previewCtx.restore();
      }

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
  stopPoseEstimation();
  if (activeSketch?.destroy) activeSketch.destroy();
  activeSketch = null;
  guideOverlay = null;
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
      await activeSketch.setup(outputCanvas, video, vw, vh);
    }

    recorder = createRecorder(outputCanvas, videoEl);

    setLoadingTarget(100, 'Ready');
    await new Promise((r) => setTimeout(r, 300));

    loadingOverlay.style.display = 'none';
    startPoseEstimation(video, poseEngine);
    startLoop(activeSketch, video, outputCanvas, poseEngine);
  } catch (err) {
    loadingLabel.textContent = 'Error: ' + err.message;
    loadingPct.textContent = '—';
    console.error(err);
  }
}

function closeSketch() {
  if (recorder) {
    if (recorder.isRecording()) {
      try { recorder.stop(); } catch (_) { /* ignore */ }
    }
    recorder.destroy();
    recorder = null;
  }
  clearInterval(recTimerInterval);
  recTimerInterval = null;
  recordBtn.textContent = '● Rec';
  recordBtn.classList.remove('recording');
  recIndicator.style.display = 'none';

  stopLoop();
  if (videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach((t) => t.stop());
    videoEl.srcObject = null;
  }
  sketchView.style.display = 'none';
  hub.style.display = 'flex';
}

// ─── Recording ───
async function startRecording() {
  if (!activeSketch || !recorder) return;

  let audioCtx = null;
  if (activeSketch.getAudioContext) {
    audioCtx = activeSketch.getAudioContext();
  }

  await recorder.start(audioCtx);

  // If audio, connect analyser to the recorder's audio destination
  if (audioCtx && activeSketch.getAnalyserNode && recorder.getAudioDest()) {
    try {
      activeSketch.getAnalyserNode().connect(recorder.getAudioDest());
    } catch (_) { /* may already be connected */ }
  }

  recordBtn.textContent = '■ Stop';
  recordBtn.classList.add('recording');
  recIndicator.style.display = 'flex';
  recTimerInterval = setInterval(() => {
    recTimer.textContent = recorder.formatTime(recorder.getElapsedMs());
  }, 500);
}

async function stopRecording() {
  if (!recorder || !recorder.isRecording()) return;

  clearInterval(recTimerInterval);
  recTimerInterval = null;
  recordBtn.textContent = '● Rec';
  recordBtn.classList.remove('recording');
  recIndicator.style.display = 'none';

  const mp4Blob = await recorder.stop();
  if (!mp4Blob) return;

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  recorder.triggerDownload(mp4Blob, `expression-scriber-${ts}.mp4`);
}

async function toggleRecording() {
  if (!recorder) return;
  if (recorder.isRecording()) {
    await stopRecording();
  } else {
    await startRecording();
  }
}

// ─── Event Bindings ───
document.querySelectorAll('.sketch-card').forEach((card) => {
  card.addEventListener('click', () => openSketch(card.dataset.sketch));
});

backBtn.addEventListener('click', closeSketch);
recordBtn.addEventListener('click', toggleRecording);

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

