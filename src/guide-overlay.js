import { Readiness } from './pose-engine.js';

const READINESS_CONFIG = {
  [Readiness.SEARCHING]: {
    glowColor: [255, 107, 107],
    glowOpacity: 0.6,
    hint: 'stand back so your body is visible',
    hintOpacity: 1,
  },
  [Readiness.ACQUIRING]: {
    glowColor: [255, 214, 100],
    glowOpacity: 0.4,
    hint: 'almost there — hold still',
    hintOpacity: 1,
  },
  [Readiness.READY]: {
    glowColor: [105, 219, 124],
    glowOpacity: 0,
    hint: '',
    hintOpacity: 0,
  },
  [Readiness.LOST]: {
    glowColor: [255, 165, 80],
    glowOpacity: 0.45,
    hint: 'move back into view',
    hintOpacity: 0.9,
  },
};

export function createGuideOverlay() {
  let currentGlow = [0, 0, 0];
  let currentGlowOpacity = 0;
  let targetGlow = [255, 107, 107];
  let targetGlowOpacity = 0.6;

  let hintText = '';
  let hintOpacity = 0;
  let targetHintOpacity = 0;

  let pulsePhase = 0;

  const LERP_SPEED = 0.07;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function update(readiness) {
    const cfg = READINESS_CONFIG[readiness] || READINESS_CONFIG[Readiness.SEARCHING];
    targetGlow = cfg.glowColor;
    targetGlowOpacity = cfg.glowOpacity;
    targetHintOpacity = cfg.hintOpacity;
    if (cfg.hint) hintText = cfg.hint;
  }

  function draw(ctx, canvas) {
    currentGlow[0] = lerp(currentGlow[0], targetGlow[0], LERP_SPEED);
    currentGlow[1] = lerp(currentGlow[1], targetGlow[1], LERP_SPEED);
    currentGlow[2] = lerp(currentGlow[2], targetGlow[2], LERP_SPEED);
    currentGlowOpacity = lerp(currentGlowOpacity, targetGlowOpacity, LERP_SPEED);
    hintOpacity = lerp(hintOpacity, targetHintOpacity, LERP_SPEED);
    pulsePhase += 0.025;

    if (currentGlowOpacity < 0.005 && hintOpacity < 0.005) return;

    const w = canvas.width;
    const h = canvas.height;
    const pulse = 0.85 + Math.sin(pulsePhase) * 0.15;

    // Vignette glow around canvas edges
    if (currentGlowOpacity > 0.005) {
      const r = Math.round(currentGlow[0]);
      const g = Math.round(currentGlow[1]);
      const b = Math.round(currentGlow[2]);
      const alpha = currentGlowOpacity * pulse;
      const vignetteSize = Math.min(w, h) * 0.25;

      ctx.save();

      // Top edge
      const topGrad = ctx.createLinearGradient(0, 0, 0, vignetteSize);
      topGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      topGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, w, vignetteSize);

      // Bottom edge
      const botGrad = ctx.createLinearGradient(0, h, 0, h - vignetteSize);
      botGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      botGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, h - vignetteSize, w, vignetteSize);

      // Left edge
      const leftGrad = ctx.createLinearGradient(0, 0, vignetteSize, 0);
      leftGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      leftGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = leftGrad;
      ctx.fillRect(0, 0, vignetteSize, h);

      // Right edge
      const rightGrad = ctx.createLinearGradient(w, 0, w - vignetteSize, 0);
      rightGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      rightGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = rightGrad;
      ctx.fillRect(w - vignetteSize, 0, vignetteSize, h);

      ctx.restore();
    }

    // Hint text — large and centered, easy to read from a distance
    if (hintOpacity > 0.01 && hintText) {
      ctx.save();
      ctx.globalAlpha = hintOpacity * pulse;

      const fontSize = Math.max(18, Math.min(w * 0.035, 32));
      ctx.font = `600 ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Text shadow for legibility on any background
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = '#fff';
      ctx.fillText(hintText, w / 2, h / 2);

      // Draw a second pass without shadow for crispness
      ctx.shadowColor = 'transparent';
      ctx.fillText(hintText, w / 2, h / 2);

      ctx.restore();
    }
  }

  return { update, draw };
}
