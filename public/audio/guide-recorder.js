class GuidePcmRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples?.length) { const copy = samples.slice(); this.port.postMessage(copy, [copy.buffer]); }
    return true;
  }
}
registerProcessor("guide-recorder", GuidePcmRecorder);
