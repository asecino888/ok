const audioEl = document.getElementById('audioElement');
const audioFileInput = document.getElementById('audioFile');
const imageFilesInput = document.getElementById('imageFiles');
const playPauseBtn = document.getElementById('playPauseBtn');
const sensitivityRange = document.getElementById('sensitivityRange');
const sensitivityValue = document.getElementById('sensitivityValue');
const lightningThresholdRange = document.getElementById('lightningThresholdRange');
const lightningThresholdValue = document.getElementById('lightningThresholdValue');
const statusText = document.getElementById('statusText');
const hint = document.getElementById('hint');
const layerA = document.getElementById('layerA');
const layerB = document.getElementById('layerB');

const imageSlots = { 0: null, 1: null, 2: null, 3: null, 4: null };
const defaultImagePaths = {
  0: 'assets/images/0_dark.png',
  1: 'assets/images/1_low_glow.png',
  2: 'assets/images/2_mid_glow.png',
  3: 'assets/images/3_high_glow.png',
  4: 'assets/images/4_lightning.png',
};

let audioContext;
let analyser;
let sourceNode;
let timeData;
let freqData;
let rafId = null;
let audioObjectUrl = null;

let currentLevel = -1;
let activeLayer = layerA;
let inactiveLayer = layerB;

let isBeatFlash = false;
let beatFlashUntil = 0;
let rollingEnergy = 0;
let rollingBassEnergy = 0;
let rollingReadyFrames = 0;

const FILE_LEVEL_PATTERN = /^(0|1|2|3|4)_.*\.(png|jpg|jpeg|webp)$/i;

function setStatus(message) {
  statusText.textContent = message;
}

function setHint(message) {
  hint.textContent = message;
}

function updateSliderText() {
  sensitivityValue.textContent = Number(sensitivityRange.value).toFixed(2);
  lightningThresholdValue.textContent = Number(lightningThresholdRange.value).toFixed(2);
}

function initAudioGraph() {
  if (audioContext) return;

  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;

  timeData = new Uint8Array(analyser.fftSize);
  freqData = new Uint8Array(analyser.frequencyBinCount);

  sourceNode = audioContext.createMediaElementSource(audioEl);
  sourceNode.connect(analyser);
  analyser.connect(audioContext.destination);
}

function stopAnimationLoop() {
  if (!rafId) return;
  cancelAnimationFrame(rafId);
  rafId = null;
}

function startAnimationLoop() {
  if (rafId) return;
  rafId = requestAnimationFrame(animate);
}

function loadAudio(file) {
  if (!file) return;

  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
  audioObjectUrl = URL.createObjectURL(file);

  audioEl.src = audioObjectUrl;
  audioEl.load();

  playPauseBtn.disabled = false;
  playPauseBtn.textContent = '播放';
  setStatus(`已載入音樂：${file.name}`);
}

function clearObjectUrls() {
  Object.values(imageSlots).forEach((url) => {
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
  Object.keys(imageSlots).forEach((k) => {
    imageSlots[k] = null;
  });
}

async function canLoadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function tryLoadDefaultImages() {
  let loaded = 0;
  for (let level = 0; level <= 4; level += 1) {
    const url = defaultImagePaths[level];
    // eslint-disable-next-line no-await-in-loop
    const ok = await canLoadImage(url);
    if (ok) {
      imageSlots[level] = url;
      loaded += 1;
    }
  }

  if (loaded > 0) {
    showInitialImage();
    setHint('已載入預設圖片，播放時會依音量與重音切換');
    setStatus(`已自動載入預設圖片 ${loaded} 張（assets/images）。`);
  }
}

function showInitialImage() {
  const base = imageSlots[0] ?? imageSlots[1] ?? imageSlots[2] ?? imageSlots[3] ?? imageSlots[4];
  if (!base) return;

  layerA.src = base;
  layerA.classList.add('active');
  layerB.classList.remove('active');
  activeLayer = layerA;
  inactiveLayer = layerB;
  currentLevel = -1;
}

function loadImages(files) {
  if (!files.length) return;

  clearObjectUrls();
  let loadedCount = 0;

  [...files].forEach((file) => {
    const match = file.name.match(FILE_LEVEL_PATTERN);
    if (!match) return;
    const level = Number(match[1]);
    imageSlots[level] = URL.createObjectURL(file);
    loadedCount += 1;
  });

  if (!loadedCount) {
    setStatus('沒有符合命名規則的圖片，請使用 0_~4_ 開頭檔名。');
    setHint('圖片命名需符合 0_*.png 到 4_*.png');
    return;
  }

  showInitialImage();
  setHint('播放時會根據音量與重音切換亮度');
  setStatus(`已載入圖片 ${loadedCount} 張（符合命名規則）。`);
}

function computeRmsLevel() {
  analyser.getByteTimeDomainData(timeData);
  let sumSquares = 0;

  for (let i = 0; i < timeData.length; i += 1) {
    const centered = (timeData[i] - 128) / 128;
    sumSquares += centered * centered;
  }

  return Math.sqrt(sumSquares / timeData.length);
}

function computeBassEnergy() {
  analyser.getByteFrequencyData(freqData);

  const nyquist = (audioContext?.sampleRate ?? 48000) / 2;
  const hzPerBin = nyquist / freqData.length;
  const maxBassHz = 180;
  const bassBins = Math.max(1, Math.floor(maxBassHz / hzPerBin));

  let sum = 0;
  for (let i = 0; i < bassBins; i += 1) sum += freqData[i];

  return sum / bassBins / 255;
}

function chooseLevel(rms, bass, nowMs) {
  const sensitivity = Number(sensitivityRange.value);
  const lightningThreshold = Number(lightningThresholdRange.value);

  const energy = rms * sensitivity;
  const weightedEnergy = energy * 0.75 + bass * 0.25;

  rollingEnergy = rollingEnergy * 0.92 + weightedEnergy * 0.08;
  rollingBassEnergy = rollingBassEnergy * 0.9 + bass * 0.1;
  rollingReadyFrames = Math.min(rollingReadyFrames + 1, 9999);

  const beatRatio = rollingEnergy > 0 ? weightedEnergy / rollingEnergy : 0;
  const bassRatio = rollingBassEnergy > 0 ? bass / rollingBassEnergy : 0;

  const beatDetected =
    rollingReadyFrames > 24 &&
    beatRatio > lightningThreshold &&
    bassRatio > Math.max(1.12, lightningThreshold * 0.7) &&
    weightedEnergy > 0.06;

  if (beatDetected && imageSlots[4]) {
    isBeatFlash = true;
    beatFlashUntil = nowMs + 120;
  }

  if (isBeatFlash && nowMs <= beatFlashUntil && imageSlots[4]) return 4;
  if (nowMs > beatFlashUntil) isBeatFlash = false;

  if (weightedEnergy < 0.03) return 0;
  if (weightedEnergy < 0.06) return 1;
  if (weightedEnergy < 0.11) return 2;
  return 3;
}

function resolveImageForLevel(level) {
  if (imageSlots[level]) return imageSlots[level];
  for (let i = level; i >= 0; i -= 1) {
    if (imageSlots[i]) return imageSlots[i];
  }
  for (let i = level + 1; i <= 4; i += 1) {
    if (imageSlots[i]) return imageSlots[i];
  }
  return null;
}

function crossfadeTo(url) {
  if (!url || activeLayer.src === url) return;

  inactiveLayer.src = url;
  inactiveLayer.classList.add('active');
  activeLayer.classList.remove('active');

  const temp = activeLayer;
  activeLayer = inactiveLayer;
  inactiveLayer = temp;
}

function animate() {
  const now = performance.now();
  const rms = computeRmsLevel();
  const bass = computeBassEnergy();
  const level = chooseLevel(rms, bass, now);

  if (level !== currentLevel) {
    const image = resolveImageForLevel(level);
    crossfadeTo(image);
    currentLevel = level;
  }

  if (!audioEl.paused && !audioEl.ended) {
    rafId = requestAnimationFrame(animate);
  } else {
    rafId = null;
  }
}

async function togglePlayback() {
  if (!audioEl.src) {
    setStatus('請先選擇音樂檔。');
    return;
  }

  initAudioGraph();

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  if (audioEl.paused) {
    await audioEl.play();
    playPauseBtn.textContent = '暫停';
    setStatus('播放中…');
    startAnimationLoop();
  } else {
    audioEl.pause();
    playPauseBtn.textContent = '播放';
    setStatus('已暫停。');
    stopAnimationLoop();
  }
}

audioEl.addEventListener('play', () => {
  startAnimationLoop();
});

audioEl.addEventListener('pause', () => {
  playPauseBtn.textContent = '播放';
  stopAnimationLoop();
});

audioEl.addEventListener('ended', () => {
  playPauseBtn.textContent = '播放';
  setStatus('播放結束。');
  stopAnimationLoop();
});

audioFileInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  loadAudio(file);
});

imageFilesInput.addEventListener('change', (event) => {
  const files = event.target.files;
  if (files) loadImages(files);
});

playPauseBtn.addEventListener('click', () => {
  togglePlayback();
});

sensitivityRange.addEventListener('input', updateSliderText);
lightningThresholdRange.addEventListener('input', updateSliderText);
window.addEventListener('beforeunload', () => {
  clearObjectUrls();
  if (audioObjectUrl) URL.revokeObjectURL(audioObjectUrl);
});

updateSliderText();
tryLoadDefaultImages();
