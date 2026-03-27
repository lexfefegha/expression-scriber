import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-converter';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';

const KEYPOINT_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

const SKELETON_EDGES = [
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
];

function toCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ─── One Euro Filter ───
// Attempt at an adaptive filter: smooth when still, responsive when moving fast.
// Based on Casiez et al. 2012 — https://cristal.univ-lille.fr/~casiez/1euro/
class LowPassFilter {
  constructor(alpha) {
    this.y = null;
    this.s = null;
    this.setAlpha(alpha);
  }

  setAlpha(alpha) {
    this.alpha = Math.max(0.001, Math.min(1, alpha));
  }

  filter(value) {
    if (this.y === null) {
      this.s = value;
    } else {
      this.s = this.alpha * value + (1 - this.alpha) * this.s;
    }
    this.y = value;
    return this.s;
  }

  lastValue() {
    return this.s;
  }

  hasLastValue() {
    return this.s !== null;
  }
}

class OneEuroFilter {
  constructor(freq, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter(this._alpha(minCutoff));
    this.dxFilter = new LowPassFilter(this._alpha(dCutoff));
    this.lastTime = null;
  }

  _alpha(cutoff) {
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  filter(value, timestamp) {
    if (this.lastTime !== null && timestamp !== this.lastTime) {
      this.freq = 1.0 / (timestamp - this.lastTime);
    }
    this.lastTime = timestamp;

    const prevValue = this.xFilter.hasLastValue() ? this.xFilter.lastValue() : value;
    const dx = (value - prevValue) * this.freq;

    const edx = this.dxFilter.filter(dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);

    this.xFilter.setAlpha(this._alpha(cutoff));
    return this.xFilter.filter(value);
  }

  hasLastValue() {
    return this.xFilter.hasLastValue();
  }

  lastValue() {
    return this.xFilter.lastValue();
  }
}

// ─── Readiness States ───
// searching → acquiring → ready ↔ lost → searching
export const Readiness = {
  SEARCHING: 'searching',
  ACQUIRING: 'acquiring',
  READY: 'ready',
  LOST: 'lost',
};

const MIN_KEYPOINTS_FOR_ACQUIRING = 4;
const MIN_KEYPOINTS_FOR_READY = 8;
const MIN_CONFIDENCE = 0.3;
const READY_FRAMES_NEEDED = 6;
const LOST_HOLD_MS = 400;

export default class PoseEngine {
  constructor() {
    this.detector = null;
    this.flipHorizontal = true;

    // One Euro Filter banks: one filter per keypoint per axis per pose
    this._filters = [];
    this._filterFreq = 30;
    this._filterMinCutoff = 1.7;
    this._filterBeta = 0.007;

    // Readiness state machine
    this.readiness = Readiness.SEARCHING;
    this._readyFrameCount = 0;
    this._lastGoodPose = null;
    this._lastGoodTime = 0;
    this._lostSince = 0;
  }

  async init() {
    await tf.setBackend('webgl');
    await tf.ready();

    const model = poseDetection.SupportedModels.MoveNet;
    this.detector = await poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    });
  }

  async estimatePoses(video) {
    if (!this.detector) return [];

    const rawPoses = await this.detector.estimatePoses(video, {
      flipHorizontal: this.flipHorizontal,
    });

    const now = performance.now() / 1000;

    const poses = rawPoses.map((raw, idx) => {
      const keypoints = raw.keypoints.map((kp) => ({
        name: kp.name,
        part: toCamel(kp.name),
        score: kp.score,
        position: { x: kp.x, y: kp.y },
      }));

      const smoothed = this._smoothOneEuro(keypoints, idx, now);

      const parts = {};
      smoothed.forEach((kp) => {
        parts[kp.part] = kp;
      });

      return {
        score: raw.score ?? smoothed.reduce((s, k) => s + k.score, 0) / smoothed.length,
        keypoints: smoothed,
        parts,
      };
    });

    this._updateReadiness(poses, now);

    return poses;
  }

  _ensureFilters(poseIndex, numKeypoints) {
    if (!this._filters[poseIndex]) {
      this._filters[poseIndex] = [];
      for (let i = 0; i < numKeypoints; i++) {
        this._filters[poseIndex].push({
          x: new OneEuroFilter(this._filterFreq, this._filterMinCutoff, this._filterBeta),
          y: new OneEuroFilter(this._filterFreq, this._filterMinCutoff, this._filterBeta),
        });
      }
    }
  }

  _smoothOneEuro(keypoints, poseIndex, timestamp) {
    this._ensureFilters(poseIndex, keypoints.length);
    const bank = this._filters[poseIndex];

    return keypoints.map((kp, i) => {
      if (kp.score < 0.1) {
        // Hold the last filtered position instead of passing noisy raw data
        if (bank[i].x.hasLastValue()) {
          return {
            ...kp,
            position: {
              x: bank[i].x.lastValue(),
              y: bank[i].y.lastValue(),
            },
          };
        }
        return kp;
      }
      return {
        ...kp,
        position: {
          x: bank[i].x.filter(kp.position.x, timestamp),
          y: bank[i].y.filter(kp.position.y, timestamp),
        },
      };
    });
  }

  _updateReadiness(poses, now) {
    const pose = poses[0];
    const confidentCount = pose
      ? pose.keypoints.filter((kp) => kp.score >= MIN_CONFIDENCE).length
      : 0;

    const prev = this.readiness;

    switch (this.readiness) {
      case Readiness.SEARCHING:
        if (confidentCount >= MIN_KEYPOINTS_FOR_ACQUIRING) {
          this.readiness = Readiness.ACQUIRING;
          this._readyFrameCount = 0;
        }
        break;

      case Readiness.ACQUIRING:
        if (confidentCount < MIN_KEYPOINTS_FOR_ACQUIRING) {
          this.readiness = Readiness.SEARCHING;
          this._readyFrameCount = 0;
        } else if (confidentCount >= MIN_KEYPOINTS_FOR_READY) {
          this._readyFrameCount++;
          if (this._readyFrameCount >= READY_FRAMES_NEEDED) {
            this.readiness = Readiness.READY;
          }
        } else {
          this._readyFrameCount = Math.max(0, this._readyFrameCount - 1);
        }
        break;

      case Readiness.READY:
        if (confidentCount >= MIN_KEYPOINTS_FOR_READY) {
          this._lastGoodPose = pose;
          this._lastGoodTime = now;
        } else if (confidentCount < MIN_KEYPOINTS_FOR_ACQUIRING) {
          this.readiness = Readiness.LOST;
          this._lostSince = now;
        }
        break;

      case Readiness.LOST:
        if (confidentCount >= MIN_KEYPOINTS_FOR_READY) {
          this.readiness = Readiness.READY;
          this._readyFrameCount = READY_FRAMES_NEEDED;
        } else if ((now - this._lostSince) > LOST_HOLD_MS / 1000) {
          this.readiness = Readiness.SEARCHING;
          this._lastGoodPose = null;
          this._readyFrameCount = 0;
        }
        break;
    }

    if (prev !== this.readiness) {
      this._onReadinessChange?.(this.readiness, prev);
    }
  }

  get lastGoodPose() {
    return this._lastGoodPose;
  }

  onReadinessChange(fn) {
    this._onReadinessChange = fn;
  }

  getDistance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  getAdjacentKeyPoints(keypoints, minConfidence) {
    const byName = {};
    keypoints.forEach((kp) => { byName[kp.name] = kp; });

    return SKELETON_EDGES
      .filter(([a, b]) => {
        const ka = byName[a];
        const kb = byName[b];
        return ka && kb && ka.score >= minConfidence && kb.score >= minConfidence;
      })
      .map(([a, b]) => [byName[a], byName[b]]);
  }

  drawSkeleton(ctx, keypoints, minConfidence, color = 'rgba(255,255,255,0.4)', lineWidth = 2) {
    const edges = this.getAdjacentKeyPoints(keypoints, minConfidence);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    for (const [a, b] of edges) {
      ctx.beginPath();
      ctx.moveTo(a.position.x, a.position.y);
      ctx.lineTo(b.position.x, b.position.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  static get KEYPOINT_NAMES() {
    return KEYPOINT_NAMES;
  }

  static get SKELETON_EDGES() {
    return SKELETON_EDGES;
  }
}
