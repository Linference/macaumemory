export function cameraErrorMessage(error) {
  const messages = {
    NotAllowedError: "相機權限未開啟。請在瀏覽器的網站設定允許相機，或使用「系統相機／選取照片」。",
    NotFoundError: "沒有找到可用的相機。請接上攝影機，或選取已拍攝的照片。",
    NotReadableError: "相機可能被其他應用占用。請關閉占用相機的應用後重試。",
    OverconstrainedError: "目前相機不支援這個拍攝設定，請使用系統相機或選取照片。",
    SecurityError: "瀏覽器限制了相機存取，請改用系統瀏覽器開啟 HTTPS 網站。",
  };
  return messages[error?.name] ?? "無法開啟相機。請重試，或使用系統相機／選取照片。";
}

/** Cancel pending permissions safely: a late stream must never keep the camera on. */
export function createCameraSession(mediaDevices, attach) {
  let generation = 0, stream = null;
  const stopStream = (value) => value?.getTracks().forEach((track) => track.stop());
  const stop = () => { generation++; stopStream(stream); stream = null; attach(null); };
  return {
    stop,
    async start(facingMode = "environment") {
      stop();
      const token = generation;
      let next;
      try {
        next = await mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 },
        } });
      } catch (error) {
        if (token !== generation) return false;
        throw error;
      }
      if (token !== generation) { stopStream(next); return false; }
      stream = next;
      attach(stream);
      return true;
    },
  };
}

export function installCamera({ onPhoto, canCapture = () => true, onNotice = () => {} }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("rc-camera-dialog"), video = $("rc-camera-video");
  const shutter = $("rc-camera-shutter"), switchButton = $("rc-camera-switch");
  const status = $("rc-camera-status"), nativeInput = $("rc-camera-file");
  let facing = "environment", opening = false, saving = false;
  const session = createCameraSession(navigator.mediaDevices, (stream) => { video.srcObject = stream; });
  const stop = () => {
    session.stop(); opening = false; shutter.disabled = true; switchButton.disabled = true;
  };
  const close = () => { stop(); if (dialog.open) dialog.close(); };
  const open = async () => {
    if (!canCapture()) { onNotice("辨識進行中，請稍後再拍攝。"); return; }
    if (!dialog.open) dialog.showModal();
    shutter.disabled = true; switchButton.disabled = true;
    if (!window.isSecureContext) {
      status.textContent = "即時相機需要 HTTPS。手機以電腦區網 HTTP 位址開啟時，請使用下方系統相機，或改用 HTTPS 網站。";
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = "目前瀏覽器不支援即時相機，請使用下方系統相機，或在手機系統瀏覽器開啟。";
      return;
    }
    opening = true;
    status.textContent = "正在開啟相機，請允許瀏覽器使用相機…";
    try {
      if (!await session.start(facing)) return;
      await video.play();
      if (!dialog.open || !opening) return;
      status.textContent = "將建築完整放進畫面，保持穩定後拍攝。";
      switchButton.disabled = false;
      shutter.disabled = video.videoWidth === 0;
    } catch (error) {
      if (!dialog.open || !opening) return;
      stop(); status.textContent = cameraErrorMessage(error);
    }
  };
  video.addEventListener("loadeddata", () => {
    if (dialog.open && opening && !saving) shutter.disabled = video.videoWidth === 0;
  });
  $("rc-camera-open").addEventListener("click", open);
  $("rc-camera-close").addEventListener("click", close);
  dialog.addEventListener("cancel", stop);
  dialog.addEventListener("close", stop);
  switchButton.addEventListener("click", () => { facing = facing === "environment" ? "user" : "environment"; open(); });
  $("rc-camera-native").addEventListener("click", () => {
    close(); nativeInput.value = ""; nativeInput.click();
  });
  nativeInput.addEventListener("change", async () => {
    const file = nativeInput.files?.[0];
    if (file && canCapture()) await onPhoto(file);
    else if (file) onNotice("辨識進行中，請稍後再選取照片。");
    nativeInput.value = "";
  });
  shutter.addEventListener("click", async () => {
    if (saving || !canCapture() || !video.videoWidth || !video.videoHeight) return;
    saving = true; shutter.disabled = true; switchButton.disabled = true;
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2048 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("無法儲存照片，請重試。");
      // Closing while JPEG encoding is pending cancels delivery of that photo.
      if (!dialog.open) return;
      close();
      await onPhoto(new File([blob], `macau-${Date.now()}.jpg`, { type: "image/jpeg" }));
    } catch (error) { status.textContent = error.message || "拍攝失敗，請重試。"; }
    finally { saving = false; if (dialog.open && opening) { shutter.disabled = false; switchButton.disabled = false; } }
  });
  window.addEventListener("pagehide", close);
  document.addEventListener("visibilitychange", () => { if (document.hidden) close(); });
}
