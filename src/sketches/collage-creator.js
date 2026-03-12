import {
  makeCtrlGroup, addColorPicker, addSlider, addToggle, addSelect, addFileUpload,
} from '../main.js';

const LIMB_DEFS = {
  head:          { label: 'Head',            default: '/collage-defaults/head.svg' },
  torso:         { label: 'Torso',           default: '/collage-defaults/torso.svg' },
  leftUpperarm:  { label: 'Left upper arm',  default: '/collage-defaults/upperarm.svg' },
  leftForearm:   { label: 'Left forearm',    default: '/collage-defaults/forearm.svg' },
  rightUpperarm: { label: 'Right upper arm', default: '/collage-defaults/upperarm.svg' },
  rightForearm:  { label: 'Right forearm',   default: '/collage-defaults/forearm.svg' },
  leftThigh:     { label: 'Left thigh',      default: '/collage-defaults/thigh.svg' },
  leftShin:      { label: 'Left shin',       default: '/collage-defaults/shin.svg' },
  rightThigh:    { label: 'Right thigh',     default: '/collage-defaults/thigh.svg' },
  rightShin:     { label: 'Right shin',      default: '/collage-defaults/shin.svg' },
};

function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function createCollageCreator(poseEngine, controlsEl) {
  const state = {
    backgroundColor: '#ac4eff',
    showVideo: false,
    showWebcamPreview: true,
    keypoints: {
      showPoints: true,
      pointsColor: '#ffef7a',
      pointsStyle: 'fill',
      pointSize: 5,
    },
  };

  const images = {};

  // Load default images
  async function loadDefaults() {
    for (const [key, def] of Object.entries(LIMB_DEFS)) {
      images[key] = await loadImg(def.default);
    }
  }
  const defaultsReady = loadDefaults();

  // ─── Build controls ───
  const gGeneral = makeCtrlGroup(controlsEl, 'General');
  addColorPicker(gGeneral, 'Background', state.backgroundColor, (v) => { state.backgroundColor = v; });
  addToggle(gGeneral, 'Show video', state.showVideo, (v) => { state.showVideo = v; });
  addToggle(gGeneral, 'Webcam preview', state.showWebcamPreview, (v) => { state.showWebcamPreview = v; });

  const gKp = makeCtrlGroup(controlsEl, 'Keypoints');
  addToggle(gKp, 'Show points', state.keypoints.showPoints, (v) => { state.keypoints.showPoints = v; });
  addColorPicker(gKp, 'Color', state.keypoints.pointsColor, (v) => { state.keypoints.pointsColor = v; });
  addSelect(gKp, 'Style', ['fill', 'outline'], state.keypoints.pointsStyle, (v) => { state.keypoints.pointsStyle = v; });
  addSlider(gKp, 'Size', 1, 100, 1, state.keypoints.pointSize, (v) => { state.keypoints.pointSize = v; });

  const gImages = makeCtrlGroup(controlsEl, 'Body part images');
  const note = document.createElement('div');
  note.style.cssText = 'font-size:0.8rem;color:var(--text-dim);margin-bottom:10px;line-height:1.4;';
  note.textContent = 'Upload images to replace default body part graphics.';
  gImages.appendChild(note);

  for (const [key, def] of Object.entries(LIMB_DEFS)) {
    addFileUpload(gImages, def.label, 'image/*', (file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { images[key] = img; };
      img.src = url;
    });
  }

  // ─── Drawing helpers ───
  function drawPoint(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (state.keypoints.pointsStyle === 'fill') ctx.fill();
    else ctx.stroke();
  }

  function drawKeypoints(keypoints, minConf, ctx) {
    for (const kp of keypoints) {
      if (kp.score < minConf) continue;
      drawPoint(ctx, kp.position.x, kp.position.y, state.keypoints.pointSize, state.keypoints.pointsColor);
    }
  }

  function drawLimb(ctx, part1, part2, minConf, img) {
    if (!img) return;
    if (!part1 || !part2) return;
    if (part1.score < minConf || part2.score < minConf) return;

    const pos1 = part1.position;
    const pos2 = part2.position;
    const c = poseEngine.getDistance(pos1, pos2);
    if (c < 1) return;

    const d = Math.sqrt(
      Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y + c - pos2.y, 2)
    );
    let rotation = Math.acos(
      Math.max(-1, Math.min(1, 1 - Math.pow(d, 2) / (2 * Math.pow(c, 2))))
    );
    if (pos2.x > pos1.x) rotation *= -1;

    const w = (img.width * c) / img.height;

    ctx.save();
    ctx.translate(pos1.x, pos1.y);
    ctx.rotate(rotation);
    ctx.drawImage(img, 0, 0, w, c);
    ctx.restore();
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

    for (const pose of poses) {
      const p = pose.parts;

      // Arms
      drawLimb(ctx, p.leftShoulder, p.leftElbow, minConf, images.leftUpperarm);
      drawLimb(ctx, p.leftElbow, p.leftWrist, minConf, images.leftForearm);
      drawLimb(ctx, p.rightShoulder, p.rightElbow, minConf, images.rightUpperarm);
      drawLimb(ctx, p.rightElbow, p.rightWrist, minConf, images.rightForearm);

      // Legs
      drawLimb(ctx, p.leftHip, p.leftKnee, minConf, images.leftThigh);
      drawLimb(ctx, p.leftKnee, p.leftAnkle, minConf, images.leftShin);
      drawLimb(ctx, p.rightHip, p.rightKnee, minConf, images.rightThigh);
      drawLimb(ctx, p.rightKnee, p.rightAnkle, minConf, images.rightShin);

      // Torso
      if (p.leftShoulder && p.rightShoulder && p.leftHip &&
          p.leftShoulder.score > minConf && p.rightShoulder.score > minConf && p.leftHip.score > minConf) {
        const torsoW = poseEngine.getDistance(p.leftShoulder.position, p.rightShoulder.position);
        const torsoH = poseEngine.getDistance(p.leftShoulder.position, p.leftHip.position);
        if (images.torso) {
          ctx.drawImage(
            images.torso,
            Math.min(p.leftShoulder.position.x, p.rightShoulder.position.x),
            Math.min(p.leftShoulder.position.y, p.rightShoulder.position.y),
            torsoW, torsoH,
          );
        }
      }

      // Head
      if (p.leftEar && p.rightEar && p.nose && p.leftEye && p.rightShoulder &&
          p.leftEar.score > minConf && p.rightEar.score > minConf) {
        const headW = poseEngine.getDistance(p.leftEar.position, p.rightEar.position);
        const headH = p.rightShoulder && p.rightEye
          ? poseEngine.getDistance(p.rightEye.position, p.rightShoulder.position)
          : headW * 1.3;
        if (images.head) {
          ctx.drawImage(
            images.head,
            p.nose.position.x - headW / 2,
            p.leftEye.position.y - headH / 2,
            headW, headH,
          );
        }
      }

      // Keypoints on top
      if (state.keypoints.showPoints) {
        drawKeypoints(pose.keypoints, minConf, ctx);
      }
    }
  }

  return {
    state,
    draw,
    setup() {},
    destroy() {},
  };
}
