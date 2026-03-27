import {
  makeCtrlGroup, addColorPicker, addToggle, addSelect,
} from '../main.js';
import { drawDebugOverlay } from '../debug-overlay.js';

const EMOJI_PALETTE = [
  '😊','😎','🤩','🥹','😈','👻','💀','🤖','👽','🎭',
  '🫀','❤️','🔥','⭐','💎','🌀','🫧','🌸','🍀','🌈',
  '💪','✋','👋','✌️','🤘','👊','🖐️','🦾','🪬','👁️',
  '🦵','🦿','👟','🩰','🛼','⚡','🌊','🎵','🪩','🎨',
  '🦋','🐍','🐙','🕷️','🦎','🪸','🍄','🌻','🪶','💫',
];

const LIMB_DEFS = {
  head:          { label: 'Head',            emoji: '😊' },
  torso:         { label: 'Torso',           emoji: '🫀' },
  leftUpperarm:  { label: 'L upper arm',     emoji: '💪' },
  leftForearm:   { label: 'L forearm',       emoji: '✋' },
  rightUpperarm: { label: 'R upper arm',     emoji: '💪' },
  rightForearm:  { label: 'R forearm',       emoji: '✋' },
  leftThigh:     { label: 'L thigh',         emoji: '🦵' },
  leftShin:      { label: 'L shin',          emoji: '👟' },
  rightThigh:    { label: 'R thigh',         emoji: '🦵' },
  rightShin:     { label: 'R shin',          emoji: '👟' },
};

const LERP_SPEED = 0.5;
const OPACITY_FADE_IN = 0.25;
const OPACITY_FADE_OUT = 0.08;
const MIN_LIMB_LENGTH = 15;

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

function angleBetween(p1, p2) {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

class SmoothedLimb {
  constructor() {
    this.x = null;
    this.y = null;
    this.rotation = null;
    this.length = null;
    this.opacity = 0;
    this.visible = false;
  }

  update(pos1, pos2, dist, isVisible) {
    const angle = angleBetween(pos1, pos2);

    if (this.x === null) {
      this.x = pos1.x;
      this.y = pos1.y;
      this.rotation = angle;
      this.length = Math.max(dist, MIN_LIMB_LENGTH);
    }

    if (isVisible) {
      this.x = lerp(this.x, pos1.x, LERP_SPEED);
      this.y = lerp(this.y, pos1.y, LERP_SPEED);
      this.rotation = lerpAngle(this.rotation, angle, LERP_SPEED);
      this.length = lerp(this.length, Math.max(dist, MIN_LIMB_LENGTH), LERP_SPEED);
      this.opacity = lerp(this.opacity, 1, OPACITY_FADE_IN);
      this.visible = true;
    } else {
      this.opacity = lerp(this.opacity, 0, OPACITY_FADE_OUT);
      if (this.opacity < 0.01) {
        this.visible = false;
        this.opacity = 0;
      }
    }
  }
}

class SmoothedRect {
  constructor() {
    this.x = null;
    this.y = null;
    this.w = null;
    this.h = null;
    this.opacity = 0;
    this.visible = false;
  }

  update(x, y, w, h, isVisible) {
    if (this.x === null) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
    }

    if (isVisible) {
      this.x = lerp(this.x, x, LERP_SPEED);
      this.y = lerp(this.y, y, LERP_SPEED);
      this.w = lerp(this.w, w, LERP_SPEED);
      this.h = lerp(this.h, h, LERP_SPEED);
      this.opacity = lerp(this.opacity, 1, OPACITY_FADE_IN);
      this.visible = true;
    } else {
      this.opacity = lerp(this.opacity, 0, OPACITY_FADE_OUT);
      if (this.opacity < 0.01) {
        this.visible = false;
        this.opacity = 0;
      }
    }
  }
}

export function createCollageCreator(poseEngine, controlsEl) {
  const state = {
    backgroundColor: '#2d2d2d',
    showWebcamPreview: true,
    debugOverlay: false,
  };

  const emojis = {};
  for (const [key, def] of Object.entries(LIMB_DEFS)) {
    emojis[key] = def.emoji;
  }

  const smoothedLimbs = {
    leftUpperarm:  new SmoothedLimb(),
    leftForearm:   new SmoothedLimb(),
    rightUpperarm: new SmoothedLimb(),
    rightForearm:  new SmoothedLimb(),
    leftThigh:     new SmoothedLimb(),
    leftShin:      new SmoothedLimb(),
    rightThigh:    new SmoothedLimb(),
    rightShin:     new SmoothedLimb(),
  };
  const smoothedTorso = new SmoothedRect();
  const smoothedHead = new SmoothedRect();

  // ─── Build controls ───
  const gGeneral = makeCtrlGroup(controlsEl, 'General');
  addColorPicker(gGeneral, 'Background', state.backgroundColor, (v) => { state.backgroundColor = v; });
  addToggle(gGeneral, 'Webcam preview', state.showWebcamPreview, (v) => { state.showWebcamPreview = v; });
  addToggle(gGeneral, 'Debug overlay', state.debugOverlay, (v) => { state.debugOverlay = v; });

  const gEmojis = makeCtrlGroup(controlsEl, 'Body part emojis');

  for (const [key, def] of Object.entries(LIMB_DEFS)) {
    const sel = addSelect(gEmojis, def.label, EMOJI_PALETTE, def.emoji, (v) => {
      emojis[key] = v;
    });
    sel.classList.add('emoji-select');
  }

  // ─── Drawing helpers ───
  function drawEmoji(ctx, emoji, x, y, size, rotation, alpha) {
    if (!emoji) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.font = `${Math.round(size)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, 0);
    ctx.restore();
  }

  function updateAndDrawLimb(ctx, limbKey, part1, part2, minConf) {
    const sl = smoothedLimbs[limbKey];
    if (!sl) return;

    const hasParts = part1 && part2;
    const isConfident = hasParts && part1.score >= minConf && part2.score >= minConf;

    if (hasParts) {
      const dist = poseEngine.getDistance(part1.position, part2.position);
      sl.update(part1.position, part2.position, dist, isConfident);
    } else {
      sl.update({ x: 0, y: 0 }, { x: 0, y: 0 }, 0, false);
    }

    if (!sl.visible || sl.opacity < 0.01) return;

    const count = Math.max(2, Math.round(sl.length / 30));
    const stepX = Math.cos(sl.rotation) * sl.length / count;
    const stepY = Math.sin(sl.rotation) * sl.length / count;
    const emojiSize = sl.length / count * 1.1;

    for (let i = 0; i < count; i++) {
      const px = sl.x + stepX * (i + 0.5);
      const py = sl.y + stepY * (i + 0.5);
      drawEmoji(ctx, emojis[limbKey], px, py, emojiSize, sl.rotation, sl.opacity);
    }
  }

  // ─── Main draw ───
  function draw(ctx, canvas, poses) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const minConf = 0.3;
    const pose = poses[0];
    const p = pose ? pose.parts : {};

    // Draw keypoint dots at joints for visual feedback
    if (pose) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      for (const kp of pose.keypoints) {
        if (kp.score < minConf) continue;
        ctx.beginPath();
        ctx.arc(kp.position.x, kp.position.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Arms
    updateAndDrawLimb(ctx, 'leftUpperarm',  p.leftShoulder, p.leftElbow, minConf);
    updateAndDrawLimb(ctx, 'leftForearm',   p.leftElbow, p.leftWrist, minConf);
    updateAndDrawLimb(ctx, 'rightUpperarm', p.rightShoulder, p.rightElbow, minConf);
    updateAndDrawLimb(ctx, 'rightForearm',  p.rightElbow, p.rightWrist, minConf);

    // Legs
    updateAndDrawLimb(ctx, 'leftThigh',  p.leftHip, p.leftKnee, minConf);
    updateAndDrawLimb(ctx, 'leftShin',   p.leftKnee, p.leftAnkle, minConf);
    updateAndDrawLimb(ctx, 'rightThigh', p.rightHip, p.rightKnee, minConf);
    updateAndDrawLimb(ctx, 'rightShin',  p.rightKnee, p.rightAnkle, minConf);

    // Torso
    {
      const ls = p.leftShoulder, rs = p.rightShoulder, lh = p.leftHip;
      const torsoVisible = ls && rs && lh &&
        ls.score > minConf && rs.score > minConf && lh.score > minConf;

      if (torsoVisible) {
        const torsoW = poseEngine.getDistance(ls.position, rs.position);
        const torsoH = poseEngine.getDistance(ls.position, lh.position);
        const cx = Math.min(ls.position.x, rs.position.x);
        const cy = Math.min(ls.position.y, rs.position.y);
        smoothedTorso.update(cx, cy, torsoW, torsoH, true);
      } else {
        smoothedTorso.update(0, 0, 0, 0, false);
      }

      if (smoothedTorso.visible && smoothedTorso.opacity > 0.01) {
        const centerX = smoothedTorso.x + smoothedTorso.w / 2;
        const centerY = smoothedTorso.y + smoothedTorso.h / 2;
        const size = Math.max(smoothedTorso.w, smoothedTorso.h) * 0.95;
        drawEmoji(ctx, emojis.torso, centerX, centerY, size, 0, smoothedTorso.opacity);
      }
    }

    // Head
    {
      const le = p.leftEar, re = p.rightEar, nose = p.nose, leye = p.leftEye, rshoulder = p.rightShoulder, reye = p.rightEye;
      const headVisible = le && re && nose && leye &&
        le.score > minConf && re.score > minConf;

      if (headVisible) {
        const headW = poseEngine.getDistance(le.position, re.position);
        const headH = rshoulder && reye && rshoulder.score > minConf && reye.score > minConf
          ? poseEngine.getDistance(reye.position, rshoulder.position)
          : headW * 1.3;
        const hx = nose.position.x - headW / 2;
        const hy = leye.position.y - headH / 2;
        smoothedHead.update(hx, hy, headW, headH, true);
      } else {
        smoothedHead.update(0, 0, 0, 0, false);
      }

      if (smoothedHead.visible && smoothedHead.opacity > 0.01) {
        const centerX = smoothedHead.x + smoothedHead.w / 2;
        const centerY = smoothedHead.y + smoothedHead.h / 2;
        const size = Math.max(smoothedHead.w, smoothedHead.h) * 1.1;
        drawEmoji(ctx, emojis.head, centerX, centerY, size, 0, smoothedHead.opacity);
      }
    }

    if (state.debugOverlay && pose) {
      drawDebugOverlay(ctx, pose, { trackedParts: null });
    }
  }

  return {
    state,
    draw,
    setup() {},
    destroy() {},
  };
}
