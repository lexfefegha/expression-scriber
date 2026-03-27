import {
  makeCtrlGroup, addColorPicker, addSlider, addSelect, addToggle,
} from '../main.js';
import { drawDebugOverlay } from '../debug-overlay.js';

const NOTE_FREQS = {
  'C2': 65.41, 'D2': 73.42, 'E2': 82.41, 'F2': 87.31, 'G2': 98.00, 'A2': 110.00, 'B2': 123.47,
  'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'F3': 174.61, 'G3': 196.00, 'A3': 220.00, 'B3': 246.94,
  'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88,
  'C5': 523.25,
};

function generateImpulse(ctx, duration, decay) {
  const rate = ctx.sampleRate;
  const len = rate * duration;
  const impulse = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return impulse;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const PITCH_RANGE = 2;

export function createFeltSound(poseEngine, controlsEl) {
  const state = {
    backgroundColor: '#0a0a1a',
    baseNote: 'C3',
    waveform: 'sawtooth',
    reverbMix: 0.3,
    visualStyle: 'waveform',
    showWebcamPreview: true,
    debugOverlay: false,
    muted: false,
  };

  let audioCtx = null;
  let osc1 = null, osc2 = null;
  let filter = null;
  let gainNode = null;
  let reverbGain = null, dryGain = null;
  let convolver = null;
  let analyser = null;
  let analyserData = null;
  let freqData = null;
  let audioStarted = false;

  // Smoothed sound params
  let sFreq = 200, sGain = 0, sFilter = 800, sDetune = 0;

  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    osc1 = audioCtx.createOscillator();
    osc2 = audioCtx.createOscillator();
    osc1.type = state.waveform;
    osc2.type = 'triangle';
    osc1.frequency.value = 200;
    osc2.frequency.value = 200;
    osc2.detune.value = 7;

    filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 2;

    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;

    convolver = audioCtx.createConvolver();
    convolver.buffer = generateImpulse(audioCtx, 2.5, 3);

    reverbGain = audioCtx.createGain();
    reverbGain.gain.value = state.reverbMix;
    dryGain = audioCtx.createGain();
    dryGain.gain.value = 1 - state.reverbMix;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserData = new Uint8Array(analyser.fftSize);
    freqData = new Uint8Array(analyser.frequencyBinCount);

    // osc -> filter -> gain -> dry/wet -> analyser -> destination
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);

    gainNode.connect(dryGain);
    gainNode.connect(convolver);
    convolver.connect(reverbGain);

    dryGain.connect(analyser);
    reverbGain.connect(analyser);
    analyser.connect(audioCtx.destination);

    osc1.start();
    osc2.start();
    audioStarted = true;
  }

  function destroyAudio() {
    if (!audioCtx) return;
    try {
      osc1.stop(); osc2.stop();
      audioCtx.close();
    } catch (_) { /* ignore */ }
    audioCtx = null;
    audioStarted = false;
  }

  function updateAudioParams(pose, canvasH) {
    if (!audioCtx || !pose) return;
    const p = pose.parts;
    const minC = 0.3;
    const baseFreq = NOTE_FREQS[state.baseNote] || 130.81;
    const maxFreq = baseFreq * Math.pow(2, PITCH_RANGE);

    // Pitch: right wrist Y (top of canvas = high, bottom = low)
    if (p.rightWrist && p.rightWrist.score > minC) {
      const yNorm = 1 - clamp(p.rightWrist.position.y / canvasH, 0, 1);
      const targetFreq = baseFreq + (maxFreq - baseFreq) * yNorm;
      sFreq = lerp(sFreq, targetFreq, 0.12);
    }

    // Volume: distance between wrists
    if (p.leftWrist && p.rightWrist && p.leftWrist.score > minC && p.rightWrist.score > minC) {
      const dist = poseEngine.getDistance(p.leftWrist.position, p.rightWrist.position);
      const normDist = clamp(dist / (canvasH * 0.8), 0, 1);
      sGain = lerp(sGain, normDist * 0.4, 0.1);
    } else {
      sGain = lerp(sGain, 0, 0.1);
    }

    // Filter: left wrist Y
    if (p.leftWrist && p.leftWrist.score > minC) {
      const yNorm = 1 - clamp(p.leftWrist.position.y / canvasH, 0, 1);
      const targetFilter = 100 + yNorm * 4900;
      sFilter = lerp(sFilter, targetFilter, 0.1);
    }

    // Detune: body tilt (shoulder angle difference)
    if (p.leftShoulder && p.rightShoulder && p.leftShoulder.score > minC && p.rightShoulder.score > minC) {
      const dy = p.leftShoulder.position.y - p.rightShoulder.position.y;
      const tilt = clamp(dy / 100, -1, 1);
      sDetune = lerp(sDetune, tilt * 50, 0.08);
    }

    const t = audioCtx.currentTime;
    const smooth = 0.05;

    osc1.frequency.setTargetAtTime(sFreq, t, smooth);
    osc2.frequency.setTargetAtTime(sFreq * 1.002, t, smooth);
    osc1.detune.setTargetAtTime(sDetune, t, smooth);

    const finalGain = state.muted ? 0 : sGain;
    gainNode.gain.setTargetAtTime(finalGain, t, smooth);
    filter.frequency.setTargetAtTime(sFilter, t, smooth);

    reverbGain.gain.setTargetAtTime(state.reverbMix, t, smooth);
    dryGain.gain.setTargetAtTime(1 - state.reverbMix, t, smooth);
  }

  // ─── Build controls ───
  const gGeneral = makeCtrlGroup(controlsEl, 'General');
  addColorPicker(gGeneral, 'Background', state.backgroundColor, (v) => { state.backgroundColor = v; });
  addToggle(gGeneral, 'Webcam preview', state.showWebcamPreview, (v) => { state.showWebcamPreview = v; });
  addToggle(gGeneral, 'Debug overlay', state.debugOverlay, (v) => { state.debugOverlay = v; });
  addToggle(gGeneral, 'Mute', state.muted, (v) => { state.muted = v; });

  const gSound = makeCtrlGroup(controlsEl, 'Sound');
  addSelect(gSound, 'Base note', Object.keys(NOTE_FREQS), state.baseNote, (v) => { state.baseNote = v; });
  addSelect(gSound, 'Waveform', ['sawtooth', 'triangle', 'sine', 'square'], state.waveform, (v) => {
    state.waveform = v;
    if (osc1) osc1.type = v;
  });
  addSlider(gSound, 'Reverb', 0, 1, 0.05, state.reverbMix, (v) => { state.reverbMix = v; });

  const gVisual = makeCtrlGroup(controlsEl, 'Visual');
  addSelect(gVisual, 'Style', ['waveform', 'spectrum', 'rings'], state.visualStyle, (v) => { state.visualStyle = v; });

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:0.75rem;opacity:0.5;margin-top:12px;line-height:1.5;';
  hint.innerHTML = '<strong>Right hand</strong> height = pitch<br><strong>Arm spread</strong> = volume<br><strong>Left hand</strong> height = brightness<br><strong>Shoulder tilt</strong> = detune';
  controlsEl.appendChild(hint);

  // ─── Visual rendering ───
  function getPitchHue() {
    if (!audioCtx) return 240;
    const baseFreq = NOTE_FREQS[state.baseNote] || 130.81;
    const maxFreq = baseFreq * Math.pow(2, PITCH_RANGE);
    const norm = clamp((sFreq - baseFreq) / (maxFreq - baseFreq), 0, 1);
    return lerp(260, 180, norm); // deep blue/purple -> cyan
  }

  function drawWaveformVis(ctx, canvas, pose) {
    if (!analyser) return;
    analyser.getByteTimeDomainData(analyserData);
    const hue = getPitchHue();
    const alpha = clamp(sGain * 4, 0.15, 0.85);
    const lw = clamp(sFilter / 1500, 1, 5);

    // Draw waveform centered on body if pose available, otherwise centered on canvas
    let cx = canvas.width / 2, cy = canvas.height / 2;
    if (pose && pose.parts.nose && pose.parts.nose.score > 0.3) {
      cx = pose.parts.nose.position.x;
      cy = pose.parts.nose.position.y;
    }

    const spread = clamp(sGain * canvas.width * 1.5, 100, canvas.width * 0.9);
    const ampScale = clamp(sGain * 300, 30, 200);

    ctx.beginPath();
    const sliceW = spread / analyserData.length;
    const startX = cx - spread / 2;

    for (let i = 0; i < analyserData.length; i++) {
      const v = (analyserData[i] / 128.0) - 1.0;
      const x = startX + i * sliceW;
      const y = cy + v * ampScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = `hsla(${hue}, 85%, 65%, ${alpha})`;
    ctx.lineWidth = lw;
    ctx.stroke();

    // Ghost line
    ctx.beginPath();
    for (let i = 0; i < analyserData.length; i++) {
      const v = (analyserData[i] / 128.0) - 1.0;
      const x = startX + i * sliceW;
      const y = cy + v * ampScale * 0.5 + 10;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsla(${hue + 30}, 70%, 50%, ${alpha * 0.3})`;
    ctx.lineWidth = lw * 0.6;
    ctx.stroke();
  }

  function drawSpectrumVis(ctx, canvas, pose) {
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    const hue = getPitchHue();
    const alpha = clamp(sGain * 3, 0.1, 0.8);

    let cx = canvas.width / 2, cy = canvas.height / 2;
    if (pose && pose.parts.nose && pose.parts.nose.score > 0.3) {
      const ls = pose.parts.leftShoulder, rs = pose.parts.rightShoulder;
      if (ls && rs && ls.score > 0.3 && rs.score > 0.3) {
        cx = (ls.position.x + rs.position.x) / 2;
        cy = (ls.position.y + rs.position.y) / 2;
      }
    }

    const bars = 64;
    const step = Math.floor(freqData.length / bars);
    const barWidth = (canvas.width * 0.6) / bars;
    const startX = cx - (bars * barWidth) / 2;

    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += freqData[i * step + j];
      const avg = sum / step;
      const h = (avg / 255) * canvas.height * 0.4;
      const barHue = hue + (i / bars) * 60;

      ctx.fillStyle = `hsla(${barHue}, 80%, 55%, ${alpha})`;
      ctx.fillRect(startX + i * barWidth, cy - h / 2, barWidth - 1, h);
    }
  }

  function drawRingsVis(ctx, canvas, pose) {
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    const hue = getPitchHue();
    const minConf = 0.3;

    const activePoints = [];
    if (pose) {
      for (const name of ['leftWrist', 'rightWrist', 'leftShoulder', 'rightShoulder']) {
        const kp = pose.parts[name];
        if (kp && kp.score > minConf) activePoints.push(kp.position);
      }
    }

    if (activePoints.length === 0) {
      activePoints.push({ x: canvas.width / 2, y: canvas.height / 2 });
    }

    const bands = [0, 4, 10, 20, 40];
    for (const pt of activePoints) {
      for (let b = 0; b < bands.length; b++) {
        const idx = bands[b];
        const amp = (freqData[idx] || 0) / 255;
        const radius = 20 + amp * 120 + b * 30;
        const ringHue = hue + b * 15;
        const alpha = clamp(amp * sGain * 5, 0.05, 0.5);

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${ringHue}, 75%, 60%, ${alpha})`;
        ctx.lineWidth = 1.5 + amp * 3;
        ctx.stroke();
      }
    }
  }

  // ─── Main draw ───
  function draw(ctx, canvas, poses, video) {
    // Resume audio context if it was suspended (browser autoplay policy)
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const pose = poses[0] || null;
    updateAudioParams(pose, canvas.height);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Visualization
    switch (state.visualStyle) {
      case 'waveform': drawWaveformVis(ctx, canvas, pose); break;
      case 'spectrum': drawSpectrumVis(ctx, canvas, pose); break;
      case 'rings':    drawRingsVis(ctx, canvas, pose); break;
    }

    if (state.debugOverlay && pose) {
      drawDebugOverlay(ctx, pose, {
        trackedParts: ['leftWrist', 'rightWrist', 'leftShoulder', 'rightShoulder'],
        statusLines: {
          pitch: Math.round(sFreq) + ' Hz',
          volume: (sGain * 100).toFixed(0) + '%',
          filter: Math.round(sFilter) + ' Hz',
          detune: sDetune.toFixed(1) + ' ct',
        },
      });
    }

    // Prompt if audio is suspended
    if (audioCtx && audioCtx.state === 'suspended') {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('click anywhere to start sound', canvas.width / 2, canvas.height - 30);
      ctx.restore();
    }
  }

  function resumeOnGesture() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  return {
    state,
    draw,
    getAudioContext() { return audioCtx; },
    getAnalyserNode() { return analyser; },
    setup(canvas) {
      initAudio();
      canvas.addEventListener('click', resumeOnGesture, { once: false });
      canvas.addEventListener('touchstart', resumeOnGesture, { once: false });
    },
    destroy() {
      destroyAudio();
    },
  };
}
