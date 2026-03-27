import {
  Output,
  BufferTarget,
  Mp4OutputFormat,
  CanvasSource,
  MediaStreamAudioTrackSource,
} from 'mediabunny';

export function createRecorder(outputCanvas, videoEl) {
  let compositeCanvas = null;
  let compositeCtx = null;
  let recording = false;
  let starting = false;
  let stopping = false;
  let startTime = 0;
  let audioDest = null;

  let output = null;
  let canvasSource = null;
  let audioSource = null;
  let frameCount = 0;
  let lastFrameTime = 0;

  let showPip = true;
  const PIP_MARGIN = 12;
  const PIP_WIDTH_RATIO = 0.22;
  const FPS = 30;
  const FRAME_INTERVAL_MS = 1000 / FPS;

  function ensureComposite() {
    if (!compositeCanvas) {
      compositeCanvas = document.createElement('canvas');
      compositeCtx = compositeCanvas.getContext('2d');
    }
    compositeCanvas.width = outputCanvas.width;
    compositeCanvas.height = outputCanvas.height;
  }

  function captureFrame() {
    if (!recording || !compositeCtx || !canvasSource) return;

    // Throttle to target FPS so we don't over-feed frames
    const now = performance.now();
    if (now - lastFrameTime < FRAME_INTERVAL_MS * 0.8) return;
    lastFrameTime = now;

    const w = outputCanvas.width;
    const h = outputCanvas.height;
    if (w === 0 || h === 0) return;

    if (compositeCanvas.width !== w) compositeCanvas.width = w;
    if (compositeCanvas.height !== h) compositeCanvas.height = h;

    compositeCtx.clearRect(0, 0, w, h);
    compositeCtx.drawImage(outputCanvas, 0, 0);

    if (showPip && videoEl && videoEl.videoWidth > 0) {
      const pipW = Math.round(compositeCanvas.width * PIP_WIDTH_RATIO);
      const pipH = Math.round(pipW * (videoEl.videoHeight / videoEl.videoWidth));
      const px = compositeCanvas.width - pipW - PIP_MARGIN;
      const py = compositeCanvas.height - pipH - PIP_MARGIN;

      compositeCtx.save();
      compositeCtx.beginPath();
      const r = 6;
      compositeCtx.roundRect(px, py, pipW, pipH, r);
      compositeCtx.clip();

      compositeCtx.translate(px + pipW, py);
      compositeCtx.scale(-1, 1);
      compositeCtx.drawImage(videoEl, 0, 0, pipW, pipH);
      compositeCtx.restore();

      compositeCtx.strokeStyle = 'rgba(255,255,255,0.3)';
      compositeCtx.lineWidth = 1.5;
      compositeCtx.beginPath();
      compositeCtx.roundRect(px, py, pipW, pipH, r);
      compositeCtx.stroke();
    }

    try {
      const timestamp = frameCount / FPS;
      const duration = 1 / FPS;
      canvasSource.add(timestamp, duration);
      frameCount++;
    } catch (err) {
      console.warn('Frame capture failed:', err);
    }
  }

  async function start(audioCtx) {
    if (recording || starting) return;
    starting = true;

    try {
      ensureComposite();
      startTime = Date.now();
      frameCount = 0;
      lastFrameTime = 0;

      const bufferTarget = new BufferTarget();
      output = new Output({
        format: new Mp4OutputFormat(),
        target: bufferTarget,
      });

      canvasSource = new CanvasSource(compositeCanvas, {
        codec: 'avc',
        bitrate: 4_000_000,
      });
      output.addVideoTrack(canvasSource, { frameRate: FPS });

      if (audioCtx) {
        try {
          audioDest = audioCtx.createMediaStreamDestination();
          const audioTrack = audioDest.stream.getAudioTracks()[0];
          if (audioTrack) {
            audioSource = new MediaStreamAudioTrackSource(audioTrack, {
              codec: 'aac',
              bitrate: 128_000,
            });
            audioSource.errorPromise.catch((err) => {
              console.warn('Mediabunny audio source error:', err);
            });
            output.addAudioTrack(audioSource);
          }
        } catch (err) {
          console.warn('Audio track setup failed, recording video only:', err);
          audioDest = null;
          audioSource = null;
        }
      }

      await output.start();
      recording = true;
    } catch (err) {
      console.error('Recording start failed:', err);
      cleanup();
    } finally {
      starting = false;
    }
  }

  function cleanup() {
    output = null;
    canvasSource = null;
    audioSource = null;
    audioDest = null;
    frameCount = 0;
    lastFrameTime = 0;
  }

  async function stop() {
    if (!output || !recording || stopping) return null;
    stopping = true;
    recording = false;

    try {
      // Feed one last frame so finalize never sees an empty track
      if (frameCount === 0) {
        try {
          canvasSource.add(0, 1 / FPS);
          frameCount++;
        } catch (_) { /* ignore */ }
      }

      await output.finalize();
      const buffer = output.target.buffer;
      if (!buffer || buffer.byteLength === 0) {
        console.warn('Recording produced an empty buffer');
        cleanup();
        return null;
      }
      const mp4Blob = new Blob([buffer], { type: 'video/mp4' });
      cleanup();
      return mp4Blob;
    } catch (err) {
      console.error('Finalize failed:', err);
      cleanup();
      return null;
    } finally {
      stopping = false;
    }
  }

  function getElapsedMs() {
    return recording ? Date.now() - startTime : 0;
  }

  function formatTime(ms) {
    const secs = Math.floor(ms / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function destroy() {
    if (recording && output) {
      recording = false;
      try { await output.cancel(); } catch (_) { /* ignore */ }
    }
    recording = false;
    starting = false;
    stopping = false;
    cleanup();
    compositeCanvas = null;
    compositeCtx = null;
  }

  return {
    captureFrame,
    start,
    stop,
    triggerDownload,
    getElapsedMs,
    formatTime,
    isRecording: () => recording,
    getAudioDest: () => audioDest,
    setShowPip: (v) => { showPip = v; },
    destroy,
  };
}
