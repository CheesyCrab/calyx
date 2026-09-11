// Presenter-only performance windows. These measurements never enter the cart
// framebuffer or ABI; they describe the browser simulation and presentation
// path over approximately one second.

function mean(total, samples) {
  return samples ? total / samples : 0;
}

export class PerfStats {
  constructor(now = 0) {
    this.reset(now);
  }

  reset(now = 0) {
    this.windowStart = now;
    this.presents = 0;
    this.simTotal = 0;
    this.simSamples = 0;
    this.rgbTotal = 0;
    this.rgbSamples = 0;
    this.canvasTotal = 0;
    this.canvasSamples = 0;
  }

  recordSim(ms) {
    this.simTotal += ms;
    this.simSamples++;
  }

  recordPresentation({ rgbMs = 0, canvasMs = 0 } = {}, now) {
    this.presents++;
    this.rgbTotal += rgbMs;
    this.rgbSamples++;
    this.canvasTotal += canvasMs;
    this.canvasSamples++;
    const wall = now - this.windowStart;
    if (wall < 1000) return null;
    const sample = {
      fps: this.presents * 1000 / wall,
      simMs: mean(this.simTotal, this.simSamples),
      rgbMs: mean(this.rgbTotal, this.rgbSamples),
      canvasMs: mean(this.canvasTotal, this.canvasSamples),
      presents: this.presents,
      simSamples: this.simSamples,
    };
    this.reset(now);
    return sample;
  }
}

export function summarizePerf(sample, targetFps = 60) {
  const target = targetFps === 30 ? 30 : 60;
  const drawMs = sample.rgbMs + sample.canvasMs;
  const workMs = sample.simMs * (60 / target) + drawMs;
  return {
    fps: `${sample.fps.toFixed(1)}/${target}`,
    sim: sample.simMs.toFixed(2),
    draw: drawMs.toFixed(2),
    work: `${Math.round(workMs / (1000 / target) * 100)}%`,
  };
}
