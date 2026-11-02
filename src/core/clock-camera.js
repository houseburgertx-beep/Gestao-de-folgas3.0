// getUserMedia cannot be aborted. Release streams that arrive after a timeout
// or after the user closes the dialog so a hidden camera never stays active.
export async function acquireClockCamera(mediaDevices, constraints, { timeout = 12000, isCurrent = () => true } = {}) {
  let expired = false;
  let timer;
  const request = mediaDevices.getUserMedia(constraints).then((stream) => {
    if (expired || !isCurrent()) {
      stream.getTracks().forEach((track) => track.stop());
      throw Object.assign(new Error("Captura de câmera encerrada."), { name: "AbortError" });
    }
    return stream;
  });
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("CAMERA_TIMEOUT"));
    }, timeout);
  });
  try { return await Promise.race([request, deadline]); }
  finally { clearTimeout(timer); }
}
