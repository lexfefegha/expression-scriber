import {
  makeCtrlGroup, addSlider, addTextInput,
  addSelect, addToggle, addColorPicker,
} from '../main.js';
import { drawDebugOverlay } from '../debug-overlay.js';

const ALL_PARTS = [
  'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar',
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
  'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
];

export function createTextTrailer(poseEngine, controlsEl) {
  const state = {
    backgroundColor: '#1a1a2e',
    showWebcamPreview: true,
    debugOverlay: false,
    visual: 'trail',
    text: {
      words: 'move',
      color: '#ff6b8a',
      font: 'Space Grotesk',
      size: 70,
      wordOptions: 'repeat',
      splitOptions: 'word',
    },
    keypoints: {
      enabled: {
        nose: true,
        leftEye: false, rightEye: false,
        leftEar: false, rightEar: false,
        leftShoulder: false, rightShoulder: false,
        leftElbow: false, rightElbow: false,
        leftWrist: false, rightWrist: false,
        leftHip: false, rightHip: false,
        leftKnee: false, rightKnee: false,
        leftAnkle: false, rightAnkle: false,
      },
    },
    trail: { numberOfPastPoses: 15 },
    paint: { lifeSpan: 25 },
  };

  let pastPoses = [];
  let pastPaintedPoses = [];
  let paintedWordIndex = 0;
  let videoWidth, videoHeight;

  // ─── Build controls ───
  const gGeneral = makeCtrlGroup(controlsEl, 'General');
  addColorPicker(gGeneral, 'Background', state.backgroundColor, (v) => { state.backgroundColor = v; });
  addSelect(gGeneral, 'Mode', ['trail', 'paint'], state.visual, (v) => {
    state.visual = v;
    pastPoses = [];
    pastPaintedPoses = [];
  });
  addToggle(gGeneral, 'Webcam preview', state.showWebcamPreview, (v) => { state.showWebcamPreview = v; });
  addToggle(gGeneral, 'Debug overlay', state.debugOverlay, (v) => { state.debugOverlay = v; });

  const gText = makeCtrlGroup(controlsEl, 'Text');
  addTextInput(gText, 'Words', state.text.words, (v) => { state.text.words = v; });
  addColorPicker(gText, 'Color', state.text.color, (v) => { state.text.color = v; });
  addSelect(gText, 'Font', ['Space Grotesk', 'Times New Roman', 'Arial', 'Georgia', 'Courier New'], state.text.font, (v) => { state.text.font = v; });
  addSlider(gText, 'Size', 10, 300, 1, state.text.size, (v) => { state.text.size = v; });
  addSelect(gText, 'Word mode', ['repeat', 'word by word'], state.text.wordOptions, (v) => { state.text.wordOptions = v; });
  addSelect(gText, 'Split by', ['word', 'character'], state.text.splitOptions, (v) => { state.text.splitOptions = v; });

  const gAttach = makeCtrlGroup(controlsEl, 'Attach to');
  const kpDiv = document.createElement('div');
  kpDiv.className = 'kp-grid';
  ALL_PARTS.forEach((part) => {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.keypoints.enabled[part];
    cb.addEventListener('change', () => { state.keypoints.enabled[part] = cb.checked; });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + part));
    kpDiv.appendChild(lbl);
  });
  gAttach.appendChild(kpDiv);

  const gTrail = makeCtrlGroup(controlsEl, 'Trail settings');
  addSlider(gTrail, 'Trail length', 1, 50, 1, state.trail.numberOfPastPoses, (v) => { state.trail.numberOfPastPoses = v; });

  const gPaint = makeCtrlGroup(controlsEl, 'Paint settings');
  addSlider(gPaint, 'Fade speed', 1, 200, 1, state.paint.lifeSpan, (v) => { state.paint.lifeSpan = v; });

  // ─── Drawing helpers ───
  function hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : { r: 0, g: 0, b: 0 };
  }

  function drawTextsOnKeypoints(text, textOpts, keypoints, color, minConf, ctx) {
    for (const kp of keypoints) {
      if (kp.score < minConf) continue;
      if (!state.keypoints.enabled[kp.part]) continue;
      ctx.font = textOpts.size + 'px ' + textOpts.font;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(text, kp.position.x, kp.position.y);
    }
  }

  function splitWords() {
    const t = state.text.words;
    return state.text.splitOptions === 'word' ? t.split(' ') : t.split('');
  }

  // ─── Painted pose class ───
  class PaintedPose {
    constructor(pose, minConf, text) {
      this.keypoints = pose.keypoints;
      this.score = pose.score;
      this.text = text;
      this.startLife = state.paint.lifeSpan;
      this.lifeSpan = this.startLife;
      this.minConf = minConf;
    }

    display(ctx) {
      this.lifeSpan--;
      const alpha = this.lifeSpan / this.startLife;
      const tc = hexToRgb(state.text.color);
      const ts = `rgba(${tc.r},${tc.g},${tc.b},${alpha})`;
      drawTextsOnKeypoints(this.text, state.text, this.keypoints, ts, this.minConf, ctx);
    }
  }

  const TRAIL_OFFSET_X = 10;
  const TRAIL_OFFSET_Y = 2;

  // ─── Main draw ───
  function draw(ctx, canvas, poses, video) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const minConf = 0.3;
    const pose = poses[0];
    if (!pose) return;

    const allWords = splitWords();

    if (state.visual === 'trail') {
      let wordIndex = 0;

      for (let p = 0; p < pastPoses.length; p++) {
        const past = pastPoses[p];
        const alpha = (pastPoses.length - p) / pastPoses.length;
        const tc = hexToRgb(state.text.color);
        const tcStr = `rgba(${tc.r},${tc.g},${tc.b},${alpha})`;

        ctx.save();
        ctx.translate(p * TRAIL_OFFSET_X, p * TRAIL_OFFSET_Y);
        ctx.scale(alpha, alpha);

        if (past.score >= minConf) {
          let textToShow;
          if (state.text.wordOptions === 'repeat') {
            textToShow = state.text.words;
          } else {
            textToShow = allWords[((wordIndex % allWords.length) + allWords.length) % allWords.length];
            wordIndex++;
          }
          drawTextsOnKeypoints(textToShow, state.text, past.keypoints, tcStr, minConf, ctx);
        }
        ctx.restore();
      }

      pastPoses.unshift(pose);
      while (pastPoses.length > state.trail.numberOfPastPoses) pastPoses.pop();

    } else if (state.visual === 'paint') {
      for (let p = pastPaintedPoses.length - 1; p >= 0; p--) {
        pastPaintedPoses[p].display(ctx);
        if (pastPaintedPoses[p].lifeSpan <= 0) pastPaintedPoses.splice(p, 1);
      }

      let textToShow;
      if (state.text.wordOptions === 'repeat') {
        textToShow = state.text.words;
      } else {
        textToShow = allWords[((paintedWordIndex % allWords.length) + allWords.length) % allWords.length];
        paintedWordIndex++;
      }

      pastPaintedPoses.push(new PaintedPose(pose, minConf, textToShow));
    }

    if (state.debugOverlay && pose) {
      const trackedParts = ALL_PARTS.filter(p => state.keypoints.enabled[p]);
      drawDebugOverlay(ctx, pose, { trackedParts });
    }
  }

  return {
    state,
    draw,
    setup(canvas, video, w, h) {
      videoWidth = w;
      videoHeight = h;
    },
    destroy() {
      pastPoses = [];
      pastPaintedPoses = [];
      paintedWordIndex = 0;
    },
  };
}
