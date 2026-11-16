(() => {
  const root = document.querySelector("[data-voice-recorder]");
  if (!root) return;
  const start = document.getElementById("voice-start"),
    stop = document.getElementById("voice-stop"),
    upload = document.getElementById("voice-upload"),
    status = document.getElementById("voice-status"),
    preview = document.getElementById("voice-preview");
  let stream,
    context,
    node,
    source,
    gain,
    timer,
    chunks = [],
    count = 0,
    blob,
    url,
    started = 0,
    stopping = false;
  function wav(samples, rate) {
    const b = new ArrayBuffer(44 + samples.length * 2),
      v = new DataView(b),
      write = (o, s) => {
        for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
      };
    write(0, "RIFF");
    v.setUint32(4, b.byteLength - 8, true);
    write(8, "WAVE");
    write(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    write(36, "data");
    v.setUint32(40, samples.length * 2, true);
    samples.forEach((s, i) => {
      const n = Math.max(-1, Math.min(1, s));
      v.setInt16(44 + i * 2, n < 0 ? n * 32768 : n * 32767, true);
    });
    return new Blob([b], { type: "audio/wav" });
  }
  function ready(value) {
    blob = value;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    preview.src = url;
    preview.hidden = false;
    upload.disabled = false;
  }
  async function finish() {
    if (stopping || !context) return;
    stopping = true;
    clearInterval(timer);
    const rate = context.sampleRate;
    stream?.getTracks().forEach((t) => t.stop());
    source?.disconnect();
    node?.disconnect();
    gain?.disconnect();
    await context.close();
    context = null;
    const size = Math.min(count, rate * 60),
      samples = new Float32Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= size) break;
      const part = chunk.subarray(0, size - offset);
      samples.set(part, offset);
      offset += part.length;
    }
    chunks = [];
    count = 0;
    start.disabled = false;
    stop.disabled = true;
    if (size < rate * 0.2) {
      status.textContent = "Kayıt çok kısa. Biraz daha uzun deneyebilirsin.";
    } else {
      ready(wav(samples, rate));
      status.textContent = "Dinleyip hazır olduğunda anıya ekleyebilirsin.";
    }
    stopping = false;
  }
  start.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent =
        "Bu tarayıcı kayıt desteklemiyor; WAV dosyası seçebilirsin.";
      return;
    }
    start.disabled = true;
    upload.disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
        video: false,
      });
      context = new AudioContext({ sampleRate: 24000 });
      await context.audioWorklet.addModule("/js/voice-processor.js");
      source = context.createMediaStreamSource(stream);
      node = new AudioWorkletNode(context, "voice-capture");
      gain = context.createGain();
      gain.gain.value = 0;
      chunks = [];
      count = 0;
      node.port.onmessage = (e) => {
        if (stopping) return;
        if (count < context.sampleRate * 60) {
          chunks.push(e.data);
          count += e.data.length;
        }
      };
      source.connect(node);
      node.connect(gain);
      gain.connect(context.destination);
      await context.resume();
      stop.disabled = false;
      started = Date.now();
      status.textContent = "Kaydediliyor: 0 saniye";
      timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        status.textContent = "Kaydediliyor: " + elapsed + " / 60 saniye";
        if (elapsed >= 60) finish();
      }, 250);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (context) await context.close();
      context = null;
      start.disabled = false;
      status.textContent =
        "Mikrofon açılamadı. İzinleri kontrol et veya WAV dosyası seç.";
    }
  });
  stop.addEventListener("click", finish);
  document.getElementById("voice-file").addEventListener("change", function () {
    if (context) return;
    const file = this.files[0];
    if (file) {
      if (file.size > 6 * 1024 * 1024) {
        status.textContent = "Dosya en fazla 6 MB olabilir.";
        return;
      }
      ready(file);
      status.textContent = "Dosyanı dinleyip anıya ekleyebilirsin.";
    }
  });
  upload.addEventListener("click", async () => {
    if (!blob) return;
    upload.disabled = true;
    const form = new FormData();
    form.set("audio", blob, "aile-sesli-ani.wav");
    form.set("caption", document.getElementById("voice-caption").value);
    try {
      const r = await fetch("/aile-medya/" + root.dataset.mediaId + "/ses", {
        method: "POST",
        headers: {
          "x-csrf-token": document.querySelector("[name=csrf-token]").content,
        },
        body: form,
      });
      if (!r.ok) throw Error();
      location.assign("/aile-medya/" + root.dataset.mediaId);
    } catch {
      upload.disabled = false;
      status.textContent =
        "Ses eklenemedi. Mono 16 bit WAV biçimini, süreyi ve albüm iznini kontrol et.";
    }
  });
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    context?.close();
    if (url) URL.revokeObjectURL(url);
  });
})();
