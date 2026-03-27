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
  let startTime = 0;
  let audioDest = null;

  let output = null;
  let canvasSource = null;
  let audioSource = null;
  let frameCount = 0;

  // PiP settings
  let showPip = true;
  const PIP_MARGIN = 12;
  const PIP_WIDTH_RATIO = 0.22;

  function ensureComposite() {
    compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = outputCanvas.width;
    compositeCanvas.height = outputCanvas.height;
    compositeCtx = compositeCanvas.getContext('2d');
  }

  function captureFrame() {
    if (!recording || !compositeCtx || !canvasSource) return;

    const w = outputCanvas.width;
    const h = outputCanvas.height;
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

      // Mirror the webcam feed
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

    const FPS = 30;
    const timestamp = frameCount / FPS;
    const duration = 1 / FPS;
    canvasSource.add(timestamp, duration);
    frameCount++;
  }

  async function start(audioCtx) {
    ensureComposite();
    startTime = Date.now();
    frameCount = 0;

    const bufferTarget = new BufferTarget();
    output = new Output({
      format: new Mp4OutputFormat(),
      target: bufferTarget,
    });

    canvasSource = new CanvasSource(compositeCanvas, {
      codec: 'avc',
      bitrate: 4_000_000,
    });
    output.addVideoTrack(canvasSource, { frameRate: 30 });

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
  }

  async function stop() {
    if (!output || !recording) return null;

    recording = false;

    try {
      await output.finalize();
      const buffer = output.target.buffer;
      const mp4Blob = new Blob([buffer], { type: 'video/mp4' });

      output = null;
      canvasSource = null;
      audioSource = null;
      audioDest = null;
      frameCount = 0;

      return mp4Blob;
    } catch (err) {
      console.error('Finalize failed:', err);
      output = null;
      canvasSource = null;
      audioSource = null;
      audioDest = null;
      frameCount = 0;
      return null;
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
      try { await output.cancel(); } catch (_) { /* ignore */ }
    }
    recording = false;
    output = null;
    canvasSource = null;
    audioSource = null;
    audioDest = null;
    frameCount = 0;
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
