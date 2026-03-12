import {
  makeCtrlGroup, addColorPicker, addSlider, addTextInput,
  addSelect, addToggle,
} from '../main.js';

const ALL_PARTS = [
  'nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar',
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftHip', 'rightHip',
  'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
];

export function createTextTrailer(poseEngine, controlsEl) {
  const state = {
    backgroundColor: '#ff4490',
    showVideo: false,
    showWebcamPreview: true,
    visual: 'trail',
    text: {
      words: 'move',
      color: '#0030cd',
      font: 'Space Grotesk',
      alignment: 'center',
      size: 70,
      showText: true,
      wordOptions: 'repeat',
      splitOptions: 'word',
      reverseOrder: false,
    },
    keypoints: {
      showPoints: false,
      color: '#c8434b',
      pointsStyle: 'fill',
      pointSize: 5,
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
    trail: { numberOfPastPoses: 15, poseOffsetX: 10, poseOffsetY: 2 },
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
  addToggle(gGeneral, 'Show video', state.showVideo, (v) => { state.showVideo = v; });
  addToggle(gGeneral, 'Webcam preview', state.showWebcamPreview, (v) => { state.showWebcamPreview = v; });

  const gText = makeCtrlGroup(controlsEl, 'Text');
  addToggle(gText, 'Show text', state.text.showText, (v) => { state.text.showText = v; });
  addTextInput(gText, 'Words', state.text.words, (v) => { state.text.words = v; });
  addColorPicker(gText, 'Color', state.text.color, (v) => { state.text.color = v; });
  addSelect(gText, 'Font', ['Space Grotesk', 'Times New Roman', 'Arial', 'Georgia', 'Courier New'], state.text.font, (v) => { state.text.font = v; });
  addSelect(gText, 'Align', ['center', 'left', 'right'], state.text.alignment, (v) => { state.text.alignment = v; });
  addSlider(gText, 'Size', 10, 300, 1, state.text.size, (v) => { state.text.size = v; });
  addSelect(gText, 'Word mode', ['repeat', 'word by word'], state.text.wordOptions, (v) => { state.text.wordOptions = v; });
  addSelect(gText, 'Split by', ['word', 'character'], state.text.splitOptions, (v) => { state.text.splitOptions = v; });
  addToggle(gText, 'Reverse order', state.text.reverseOrder, (v) => { state.text.reverseOrder = v; });

  const gKp = makeCtrlGroup(controlsEl, 'Keypoints');
  addToggle(gKp, 'Show points', state.keypoints.showPoints, (v) => { state.keypoints.showPoints = v; });
  addColorPicker(gKp, 'Color', state.keypoints.color, (v) => { state.keypoints.color = v; });
  addSelect(gKp, 'Style', ['fill', 'outline'], state.keypoints.pointsStyle, (v) => { state.keypoints.pointsStyle = v; });
  addSlider(gKp, 'Size', 1, 100, 1, state.keypoints.pointSize, (v) => { state.keypoints.pointSize = v; });

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
  gKp.appendChild(kpDiv);

  const gTrail = makeCtrlGroup(controlsEl, 'Trail settings');
  addSlider(gTrail, 'Past poses', 1, 50, 1, state.trail.numberOfPastPoses, (v) => { state.trail.numberOfPastPoses = v; });
  addSlider(gTrail, 'Offset X', -100, 100, 1, state.trail.poseOffsetX, (v) => { state.trail.poseOffsetX = v; });
  addSlider(gTrail, 'Offset Y', -100, 100, 1, state.trail.poseOffsetY, (v) => { state.trail.poseOffsetY = v; });

  const gPaint = makeCtrlGroup(controlsEl, 'Paint settings');
  addSlider(gPaint, 'Life span', 1, 200, 1, state.paint.lifeSpan, (v) => { state.paint.lifeSpan = v; });

  // ─── Drawing helpers ───
  function hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : { r: 0, g: 0, b: 0 };
  }

  function drawPoint(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (state.keypoints.pointsStyle === 'fill') ctx.fill();
    else ctx.stroke();
  }

  function drawKeypointsColored(keypoints, color, minConf, ctx) {
    for (const kp of keypoints) {
      if (kp.score < minConf) continue;
      if (!state.keypoints.enabled[kp.part]) continue;
      drawPoint(ctx, kp.position.x, kp.position.y, state.keypoints.pointSize, color);
    }
  }

  function drawTextsOnKeypoints(text, textOpts, keypoints, color, minConf, ctx) {
    for (const kp of keypoints) {
      if (kp.score < minConf) continue;
      if (!state.keypoints.enabled[kp.part]) continue;
      ctx.font = textOpts.size + 'px ' + textOpts.font;
      ctx.fillStyle = color;
      ctx.textAlign = textOpts.alignment;
      ctx.fillText(text, kp.position.x, kp.position.y);
    }
  }

  function splitWords() {
    const t = state.text.words;
    return state.text.splitOptions === 'word' ? t.split(' ') : t.split('');
  }

  // ─── Painted pose class ───
  class PaintedPose {
    constructor(pose, minConf, color, text) {
      this.keypoints = pose.keypoints;
      this.score = pose.score;
      this.color = color;
      this.text = text;
      this.startLife = state.paint.lifeSpan;
      this.lifeSpan = this.startLife;
      this.minConf = minConf;
    }

    display(ctx) {
      this.lifeSpan--;
      const alpha = this.lifeSpan / this.startLife;
      const c = hexToRgb(this.color);
      const cs = `rgba(${c.r},${c.g},${c.b},${alpha})`;
      const tc = hexToRgb(state.text.color);
      const ts = `rgba(${tc.r},${tc.g},${tc.b},${alpha})`;
      if (state.keypoints.showPoints) drawKeypointsColored(this.keypoints, cs, this.minConf, ctx);
      if (state.text.showText) drawTextsOnKeypoints(this.text, state.text, this.keypoints, ts, this.minConf, ctx);
    }
  }

  // ─── Main draw ───
  function draw(ctx, canvas, poses, video) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.showVideo) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-canvas.width, 0);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    const minConf = 0.3;
    const pose = poses[0];
    if (!pose) return;

    const allWords = splitWords();

    if (state.visual === 'trail') {
      let wordIndex = state.text.reverseOrder ? allWords.length - 1 : 0;

      for (let p = 0; p < pastPoses.length; p++) {
        const past = pastPoses[p];
        const alpha = (pastPoses.length - p) / pastPoses.length;
        const kc = hexToRgb(state.keypoints.color);
        const kcStr = `rgba(${kc.r},${kc.g},${kc.b},${alpha})`;
        const tc = hexToRgb(state.text.color);
        const tcStr = `rgba(${tc.r},${tc.g},${tc.b},${alpha})`;

        ctx.save();
        ctx.translate(p * state.trail.poseOffsetX, p * state.trail.poseOffsetY);
        ctx.scale(alpha, alpha);

        if (past.score >= minConf) {
          if (state.keypoints.showPoints) drawKeypointsColored(past.keypoints, kcStr, minConf, ctx);

          if (state.text.showText) {
            let textToShow;
            if (state.text.wordOptions === 'repeat') {
              textToShow = state.text.words;
            } else {
              textToShow = allWords[((wordIndex % allWords.length) + allWords.length) % allWords.length];
              wordIndex += state.text.reverseOrder ? -1 : 1;
            }
            drawTextsOnKeypoints(textToShow, state.text, past.keypoints, tcStr, minConf, ctx);
          }
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
        paintedWordIndex += state.text.reverseOrder ? -1 : 1;
      }

      pastPaintedPoses.push(new PaintedPose(pose, minConf, state.keypoints.color, textToShow));
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
