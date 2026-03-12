import {
  makeCtrlGroup, addColorPicker, addSlider, addToggle, addSelect,
} from '../main.js';

export function createBodyTranscriber(poseEngine, controlsEl) {
  const state = {
    backgroundColor: '#ffe053',
    textColor: '#9d005c',
    textSize: 18,
    showVideo: false,
    showWebcamPreview: true,
    keypoints: {
      showPoints: true,
      pointsColor: '#9d005c',
      pointsStyle: 'outline',
      pointSize: 5,
    },
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
  addToggle(gGeneral, 'Show video', state.showVideo, (v) => { state.showVideo = v; });
  addToggle(gGeneral, 'Webcam preview', state.showWebcamPreview, (v) => { state.showWebcamPreview = v; });

  const gText = makeCtrlGroup(controlsEl, 'Text');
  addColorPicker(gText, 'Text color', state.textColor, (v) => { state.textColor = v; });
  addSlider(gText, 'Text size', 10, 60, 1, state.textSize, (v) => { state.textSize = v; });

  // Instruction note
  const note = document.createElement('div');
  note.style.cssText = 'font-size:0.8rem;color:var(--text-dim);margin-top:8px;line-height:1.4;';
  note.textContent = 'Speak aloud — your words will appear on your body. Make sure to allow microphone access.';
  gText.appendChild(note);

  const gKp = makeCtrlGroup(controlsEl, 'Keypoints');
  addToggle(gKp, 'Show points', state.keypoints.showPoints, (v) => { state.keypoints.showPoints = v; });
  addColorPicker(gKp, 'Color', state.keypoints.pointsColor, (v) => { state.keypoints.pointsColor = v; });
  addSelect(gKp, 'Style', ['fill', 'outline'], state.keypoints.pointsStyle, (v) => { state.keypoints.pointsStyle = v; });
  addSlider(gKp, 'Size', 1, 100, 1, state.keypoints.pointSize, (v) => { state.keypoints.pointSize = v; });

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

    if (state.showVideo) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.translate(-canvas.width, 0);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    // Instruction text
    ctx.textAlign = 'left';
    ctx.fillStyle = state.textColor;
    ctx.font = '18px Space Grotesk';
    ctx.fillText('speak to add text to your body!', 10, 25);

    const minConf = 0.3;
    const pose = poses[0];
    if (!pose) return;

    if (state.keypoints.showPoints) {
      drawKeypoints(pose.keypoints, minConf, ctx);
    }

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
