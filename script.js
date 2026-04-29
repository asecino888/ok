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

const imageSlots = {
  0: null,
  1: null,
  2: null,
  3: null,
  4: null,
};

let audioContext;
let analyser;
let sourceNode;
let timeData;
let rafId;

let currentLevel = -1;
let activeLayer = layerA;
let inactiveLayer = layerB;

let isBeatFlash = false;
let beatFlashUntil = 0;
let rollingEnergy = 0;
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
  if (!audioContext) {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    timeData = new Uint8Array(analyser.fftSize);

    sourceNode = audioContext.createMediaElementSource(audioEl);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);
  }
}

function loadAudio(file) {
  if (!file) return;

  const url = URL.createObjectURL(file);
  audioEl.src = url;
  audioEl.load();

  playPauseBtn.disabled = false;
  playPauseBtn.textContent = '播放';
  setStatus(`已載入音樂：${file.name}`);
}

function clearOldImages() {
  Object.values(imageSlots).forEach((url) => {
    if (url) URL.revokeObjectURL(url);
  });
  Object.keys(imageSlots).forEach((k) => {
    imageSlots[k] = null;
  });
}

function loadImages(files) {
  if (!files.length) return;

  clearOldImages();
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

  const base = imageSlots[0] ?? imageSlots[1] ?? imageSlots[2] ?? imageSlots[3] ?? imageSlots[4];
  if (base) {
    layerA.src = base;
    layerA.classList.add('active');
    layerB.classList.remove('active');
    activeLayer = layerA;
    inactiveLayer = layerB;
  }

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

function chooseLevel(rms, nowMs) {
  const sensitivity = Number(sensitivityRange.value);
  const lightningThreshold = Number(lightningThresholdRange.value);
  const energy = rms * sensitivity;

  rollingEnergy = rollingEnergy * 0.92 + energy * 0.08;
  rollingReadyFrames = Math.min(rollingReadyFrames + 1, 9999);

  const beatRatio = rollingEnergy > 0 ? energy / rollingEnergy : 0;
  const beatDetected = rollingReadyFrames > 30 && beatRatio > lightningThreshold && energy > 0.07;

  if (beatDetected) {
    isBeatFlash = true;
    beatFlashUntil = nowMs + 120;
  }

  if (isBeatFlash && nowMs <= beatFlashUntil && imageSlots[4]) {
    return 4;
  }

  if (nowMs > beatFlashUntil) {
    isBeatFlash = false;
  }

  if (energy < 0.03) return 0;
  if (energy < 0.06) return 1;
  if (energy < 0.11) return 2;
  if (energy < 0.17) return 3;
  return imageSlots[4] ? 3 : 3;
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
  const level = chooseLevel(rms, now);

  if (level !== currentLevel) {
    const image = resolveImageForLevel(level);
    crossfadeTo(image);
    currentLevel = level;
  }

  rafId = requestAnimationFrame(animate);
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
    if (!rafId) rafId = requestAnimationFrame(animate);
  } else {
    audioEl.pause();
    playPauseBtn.textContent = '播放';
    setStatus('已暫停。');
  }
}

audioEl.addEventListener('ended', () => {
  playPauseBtn.textContent = '播放';
  setStatus('播放結束。');
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

updateSliderText();
