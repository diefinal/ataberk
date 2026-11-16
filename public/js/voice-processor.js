class VoiceCapture extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice());
    if (outputs[0]?.[0]) outputs[0][0].fill(0);
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
