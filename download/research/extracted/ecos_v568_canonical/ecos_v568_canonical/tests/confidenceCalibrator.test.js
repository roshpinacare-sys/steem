import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { ConfidenceCalibrator } = require('../lib/confidenceCalibrator');

function makeSamples(n, scoreRange, label) {
  return Array.from({length: n}, (_, i) => ({
    rawScore: scoreRange[0] + (i / n) * (scoreRange[1] - scoreRange[0]),
    label
  }));
}

describe('ConfidenceCalibrator — Platt scaling', () => {
  let cal;
  beforeEach(() => { cal = new ConfidenceCalibrator(); });

  it('returns null before fitting', () => {
    expect(cal.calibrate(0.9)).toBeNull();
    expect(cal.isReady).toBe(false);
  });

  it('fit() requires at least 10 samples', () => {
    expect(() => cal.fit([{rawScore:0.5,label:1}])).toThrow();
  });

  it('fit() rejects rawScore > 1', () => {
    const bad = Array.from({length:20}, (_,i) => ({rawScore: -5 + i*0.5, label: i%2}));
    expect(() => cal.fit(bad)).toThrow(RangeError);
  });

  it('fit() + calibrate() returns probability in [0,1]', () => {
    const data = [
      ...makeSamples(25, [0.70, 0.98], 1),
      ...makeSamples(15, [0.52, 0.69], 1),
      ...makeSamples(10, [0.30, 0.51], 0),
    ];
    cal.fit(data);
    expect(cal.isReady).toBe(true);
    const p = cal.calibrate(0.85);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('high rawScore calibrates higher than low rawScore', () => {
    const data = [
      ...makeSamples(25, [0.70, 0.98], 1),
      ...makeSamples(25, [0.30, 0.51], 0),
    ];
    cal.fit(data);
    expect(cal.calibrate(0.9)).toBeGreaterThan(cal.calibrate(0.4));
  });

  it('serializeParams() + loadParams() roundtrip', () => {
    const data = [
      ...makeSamples(30, [0.65, 0.95], 1),
      ...makeSamples(20, [0.30, 0.55], 0),
    ];
    cal.fit(data);
    const params = cal.serializeParams();
    const cal2 = new ConfidenceCalibrator();
    cal2.loadParams(params);
    expect(cal2.calibrate(0.80)).toBeCloseTo(cal.calibrate(0.80), 5);
  });

  it('calibrate(null) returns null', () => {
    const data = [...makeSamples(30, [0.65, 0.95], 1), ...makeSamples(20, [0.30, 0.55], 0)];
    cal.fit(data);
    expect(cal.calibrate(null)).toBeNull();
  });

  it('isReady requires 50+ samples', () => {
    const small = [...makeSamples(15, [0.6, 0.9], 1), ...makeSamples(15, [0.3, 0.5], 0)];
    cal.fit(small);
    expect(cal.isReady).toBe(false); // only 30 samples
  });
});

// ── [FIX-V84-1] _computeConfidence unit tests ─────────────────────────────────
describe('offlineInference — _computeConfidence helper', () => {
  let _computeConfidence;

  beforeEach(async () => {
    const req = createRequire(import.meta.url);
    // Fresh require (module is CJS singleton — OK to read helper off it)
    const mod = req('../lib/offlineInference');
    _computeConfidence = mod._computeConfidence;
  });

  it('_computeConfidence returns null for null input', () => {
    expect(_computeConfidence(null)).toBeNull();
  });

  it('_computeConfidence returns null for empty array input', () => {
    expect(_computeConfidence([])).toBeNull();
  });

  it('_computeConfidence returns value in [0,1] for valid logprobs', () => {
    const result = _computeConfidence([-0.5, -1.0, -0.3]);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('_computeConfidence of [0] equals sigmoid(0) ≈ 0.5', () => {
    const result = _computeConfidence([0]);
    expect(result).toBeCloseTo(0.5, 4);
  });

  // ── [V86-P5] Additional edge-case tests ───────────────────────────────────
  it('_computeConfidence returns null for empty array []', () => {
    expect(_computeConfidence([])).toBeNull();
  });

  it('_computeConfidence clamps extreme negative logprobs to > 0', () => {
    const result = _computeConfidence([-100, -100, -100]);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ── [P2-V88] generateSyntheticCalibrationData tests ───────────────────────
describe('ConfidenceCalibrator — synthetic calibration data (P2-V88)', () => {
  it('calibrator.fit() with 60 synthetic samples reaches isReady', () => {
    const { generateSyntheticCalibrationData } = require('../scripts/seed-calibrator');
    const calibrator = new ConfidenceCalibrator();
    const data = generateSyntheticCalibrationData(60);
    calibrator.fit(data);
    expect(calibrator.isReady).toBe(true);
    expect(calibrator._sampleCount).toBe(60);
  });

  it('calibrator routes 80%+ high-confidence samples to AUTO_FLOW', () => {
    const { generateSyntheticCalibrationData } = require('../scripts/seed-calibrator');
    const AUTO_THRESHOLD = 0.70;
    const calibrator = new ConfidenceCalibrator();
    const data = generateSyntheticCalibrationData(60);
    calibrator.fit(data);

    const highConfidenceScores = [
      0.85, 0.90, 0.88, 0.92, 0.87, 0.91, 0.86, 0.93,
      0.89, 0.95, 0.84, 0.96, 0.83, 0.94, 0.82, 0.97,
      0.81, 0.98, 0.80, 0.99,
    ];
    let autoCount = 0;
    for (const score of highConfidenceScores) {
      const cal = calibrator.calibrate(score);
      if (cal !== null && cal >= AUTO_THRESHOLD) autoCount++;
    }
    expect(autoCount / highConfidenceScores.length).toBeGreaterThanOrEqual(0.80);
  });

  it('calibrator.serializeParams() roundtrip preserves A and B', () => {
    const { generateSyntheticCalibrationData } = require('../scripts/seed-calibrator');
    const calibrator = new ConfidenceCalibrator();
    const data = generateSyntheticCalibrationData(60);
    calibrator.fit(data);
    const saved = calibrator.serializeParams();

    const calibrator2 = new ConfidenceCalibrator();
    calibrator2.loadParams(saved);
    expect(Math.abs(calibrator2._A - calibrator._A)).toBeLessThan(0.0001);
    expect(Math.abs(calibrator2._B - calibrator._B)).toBeLessThan(0.0001);
  });
});
