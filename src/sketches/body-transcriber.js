import {
  makeCtrlGroup, addColorPicker, addSlider, addToggle,
} from '../main.js';
import { drawDebugOverlay } from '../debug-overlay.js';

export function createBodyTranscriber(poseEngine, controlsEl) {
  const state = {
    backgroundColor: '#0d1b2a',
    textColor: '#e0e0e0',
    textSize: 18,
    showWebcamPreview: true,
    debugOverlay: false,
  };

  let text = '';
  let recognition = null;

  // ─── Speech Recognition ───
  function startSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    recognition = new SR();
    recognition.continuous = true;
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let full = '';
      for (let r = 0; r < event.results.length; r++) {
        full += event.results[r][0].transcript;
      }
      text = full;
    };

    recognition.onend = () => {
      // Auto-restart if still active
      try { recognition.start(); } catch (_) { /* ignore */ }
    };

    recognition.start();
  }

  // ─── Build controls ───
  const gGeneral = makeCtrlGroup(controlsEl, 'General');
  addColorPicker(gGeneral, 'Background', state.backgroundColor, (v) => { state.backgroundColor = v; });
  addToggle(gGeneral, 'Webcam preview', state.showWebcamPreview, (v) => { state.showWebcamPreview = v; });
  addToggle(gGeneral, 'Debug overlay', state.debugOverlay, (v) => { state.debugOverlay = v; });

  const gText = makeCtrlGroup(controlsEl, 'Text');
  addColorPicker(gText, 'Text color', state.textColor, (v) => { state.textColor = v; });
  addSlider(gText, 'Text size', 10, 60, 1, state.textSize, (v) => { state.textSize = v; });

  const note = document.createElement('div');
  note.style.cssText = 'font-size:0.8rem;color:var(--text-dim);margin-top:8px;line-height:1.4;';
  note.textContent = 'Speak aloud — your words will appear on your body. Make sure to allow microphone access.';
  gText.appendChild(note);

  // ─── Drawing helpers ───
  function drawKeypoints(keypoints, minConf, ctx) {
    ctx.fillStyle = 'rgba(224, 224, 224, 0.6)';
    for (const kp of keypoints) {
      if (kp.score < minConf) continue;
      ctx.beginPath();
      ctx.arc(kp.position.x, kp.position.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function wrapText(ctx, theText, x, y, maxWidth, maxHeight, lineHeight) {
    const words = theText.split(' ');
    let line = '';
    let curY = y;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (curY + lineHeight > y + maxHeight) break;
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, curY);
        line = words[n] + ' ';
        curY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, curY);
  }

  function drawTextRegion(ctx, theText, pos1, pos2) {
    const width = poseEngine.getDistance(pos1, pos2);
    const cx = Math.min(pos1.x, pos2.x) + Math.abs(pos1.x - pos2.x) / 2;
    const cy = pos1.y;
    ctx.save();
    ctx.font = state.textSize + 'px Space Grotesk';
    ctx.fillStyle = state.textColor;
    ctx.textAlign = 'center';
    wrapText(ctx, theText, cx, cy, width, width * 0.75, state.textSize + 6);
    ctx.restore();
  }

  // ─── Main draw ───
  function draw(ctx, canvas, poses, video) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = 'left';
    ctx.fillStyle = state.textColor;
    ctx.font = '18px Space Grotesk';
    ctx.fillText('speak to add text to your body!', 10, 25);

    const minConf = 0.3;
    const pose = poses[0];
    if (!pose) return;

    drawKeypoints(pose.keypoints, minConf, ctx);

    // Draw text on torso (between shoulders)
    const ls = pose.parts.leftShoulder;
    const rs = pose.parts.rightShoulder;
    if (ls && rs && ls.score > minConf && rs.score > minConf) {
      drawTextRegion(ctx, text, ls.position, rs.position);
    }

    // Draw text on head (between ears)
    const le = pose.parts.leftEar;
    const re = pose.parts.rightEar;
    if (le && re && le.score > minConf && re.score > minConf) {
      drawTextRegion(ctx, text, le.position, re.position);
    }

    if (state.debugOverlay) {
      drawDebugOverlay(ctx, pose, {
        trackedParts: ['leftShoulder', 'rightShoulder', 'leftEar', 'rightEar'],
      });
    }
  }

  return {
    state,
    draw,
    setup() {
      startSpeech();
    },
    destroy() {
      if (recognition) {
        try { recognition.stop(); } catch (_) { /* ignore */ }
        recognition = null;
      }
      text = '';
    },
  };
}
