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

// MoveNet uses underscore names; provide camelCase aliases for convenience
function toCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export default class PoseEngine {
  constructor() {
    this.detector = null;
    this.smoothFactor = 0.6;
    this.prevPoses = [];
    this.flipHorizontal = true;
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

    const poses = rawPoses.map((raw, idx) => {
      const keypoints = raw.keypoints.map((kp) => ({
        name: kp.name,
        part: toCamel(kp.name),
        score: kp.score,
        position: { x: kp.x, y: kp.y },
      }));

      const smoothed = this._smooth(keypoints, idx);

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

    return poses;
  }

  _smooth(keypoints, poseIndex) {
    if (!this.prevPoses[poseIndex]) {
      this.prevPoses[poseIndex] = keypoints;
      return keypoints;
    }

    const prev = this.prevPoses[poseIndex];
    const smoothed = keypoints.map((kp, i) => {
      const prevKp = prev[i];
      if (!prevKp) return kp;
      return {
        ...kp,
        position: {
          x: prevKp.position.x * this.smoothFactor + kp.position.x * (1 - this.smoothFactor),
          y: prevKp.position.y * this.smoothFactor + kp.position.y * (1 - this.smoothFactor),
        },
      };
    });

    this.prevPoses[poseIndex] = smoothed;
    return smoothed;
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

  static get KEYPOINT_NAMES() {
    return KEYPOINT_NAMES;
  }

  static get SKELETON_EDGES() {
    return SKELETON_EDGES;
  }
}
