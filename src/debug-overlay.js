const SKELETON_EDGES = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
];

const SHORT_NAMES = {
  nose: 'nose', leftEye: 'L eye', rightEye: 'R eye',
  leftEar: 'L ear', rightEar: 'R ear',
  leftShoulder: 'L shldr', rightShoulder: 'R shldr',
  leftElbow: 'L elbow', rightElbow: 'R elbow',
  leftWrist: 'L wrist', rightWrist: 'R wrist',
  leftHip: 'L hip', rightHip: 'R hip',
  leftKnee: 'L knee', rightKnee: 'R knee',
  leftAnkle: 'L ankle', rightAnkle: 'R ankle',
};

/**
 * Draws a debug overlay showing tracked keypoints, skeleton, and confidence.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} pose - The pose object with .keypoints and .parts
 * @param {Object} options
 * @param {string[]} options.trackedParts - Which part names this sketch cares about
 * @param {number}   [options.minConf=0.3] - Minimum confidence to consider "detected"
 * @param {boolean}  [options.showSkeleton=true] - Draw skeleton lines
 * @param {boolean}  [options.showLabels=true] - Draw part name labels
 * @param {boolean}  [options.showConfidence=true] - Draw confidence bars
 * @param {Object}   [options.statusLines] - Extra key/value pairs to display (e.g. { pitch: '440hz' })
 */
export function drawDebugOverlay(ctx, pose, options = {}) {
  if (!pose) return;

  const {
    trackedParts = null,
    minConf = 0.3,
    showSkeleton = true,
    showLabels = true,
    showConfidence = true,
    statusLines = null,
  } = options;

  const isTracked = trackedParts
    ? (part) => trackedParts.includes(part)
    : () => true;

  ctx.save();

  // Skeleton lines (dimmed for untracked pairs)
  if (showSkeleton) {
    for (const [nameA, nameB] of SKELETON_EDGES) {
      const a = pose.parts[nameA];
      const b = pose.parts[nameB];
      if (!a || !b) continue;
      const bothTracked = isTracked(nameA) && isTracked(nameB);
      const bothVisible = a.score >= minConf && b.score >= minConf;
      if (!bothVisible) continue;

      ctx.beginPath();
      ctx.moveTo(a.position.x, a.position.y);
      ctx.lineTo(b.position.x, b.position.y);
      ctx.strokeStyle = bothTracked
        ? 'rgba(0, 255, 140, 0.5)'
        : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = bothTracked ? 2 : 1;
      ctx.stroke();
    }
  }

  // Keypoint dots + labels
  for (const kp of pose.keypoints) {
    const tracked = isTracked(kp.part);
    const detected = kp.score >= minConf;
    const x = kp.position.x;
    const y = kp.position.y;

    if (!tracked && !detected) continue;

    // Dot
    const radius = tracked ? 5 : 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);

    if (tracked && detected) {
      ctx.fillStyle = 'rgba(0, 255, 140, 0.9)';
    } else if (tracked && !detected) {
      ctx.fillStyle = 'rgba(255, 80, 80, 0.7)';
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    }
    ctx.fill();

    // Ring for tracked parts
    if (tracked) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = detected
        ? 'rgba(0, 255, 140, 0.5)'
        : 'rgba(255, 80, 80, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label + confidence
    if (tracked && (showLabels || showConfidence)) {
      const label = SHORT_NAMES[kp.part] || kp.part;
      const confText = showConfidence ? ` ${Math.round(kp.score * 100)}%` : '';
      const fullLabel = showLabels ? label + confText : confText.trim();

      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      // Background pill
      const tw = ctx.measureText(fullLabel).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x + 10, y - 7, tw + 6, 14);

      ctx.fillStyle = detected ? '#00ff8c' : '#ff5050';
      ctx.fillText(fullLabel, x + 13, y);

      // Confidence bar
      if (showConfidence) {
        const barW = 30;
        const barH = 3;
        const barX = x + 10;
        const barY = y + 9;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = detected ? 'rgba(0, 255, 140, 0.7)' : 'rgba(255, 80, 80, 0.5)';
        ctx.fillRect(barX, barY, barW * kp.score, barH);
      }
    }
  }

  // Status lines (top-right corner)
  if (statusLines) {
    const entries = Object.entries(statusLines);
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const cw = ctx.canvas.width;

    for (let i = 0; i < entries.length; i++) {
      const [key, val] = entries[i];
      const lineY = 10 + i * 16;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      const text = `${key}: ${val}`;
      const tw = ctx.measureText(text).width;
      ctx.fillRect(cw - tw - 16, lineY - 2, tw + 12, 16);
      ctx.fillStyle = '#00ff8c';
      ctx.fillText(text, cw - 10, lineY);
    }
  }

  ctx.restore();
}
