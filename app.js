const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  playToggle: $("#playToggle"),
  playIcon: $("#playIcon"),
  frequencyReadout: $("#frequencyReadout"),
  preciseFrequency: $("#preciseFrequency"),
  sliderFrequency: $("#sliderFrequency"),
  waveGain: $("#waveGain"),
  sweepToggle: $("#sweepToggle"),
  sweepStart: $("#sweepStart"),
  sweepPeak: $("#sweepPeak"),
  sweepStep: $("#sweepStep"),
  sweepInterval: $("#sweepInterval"),
  requestCamera: $("#requestCamera"),
  cameraSelect: $("#cameraSelect"),
  flipCamera: $("#flipCamera"),
  cameraStatus: $("#cameraStatus"),
  trackStatus: $("#trackStatus"),
  scaleStatus: $("#scaleStatus"),
  dataBody: $("#dataBody"),
  calibrate: $("#calibrate"),
  resetTrack: $("#resetTrack"),
  videoStage: $("#videoStage"),
  video: $("#video"),
  overlay: $("#overlay"),
  processingCanvas: $("#processingCanvas"),
  videoHint: $("#videoHint"),
  amplitudeReadout: $("#amplitudeReadout"),
  ratioReadout: $("#ratioReadout"),
  centroidX: $("#centroidX"),
  centroidY: $("#centroidY"),
  pixelAmplitude: $("#pixelAmplitude"),
  sampleCount: $("#sampleCount"),
  drawChart: $("#drawChart"),
  chartCanvas: $("#chartCanvas"),
};

const state = {
  mode: "precise",
  currentFrequency: 5,
  audioContext: null,
  oscillator: null,
  gainNode: null,
  isPlaying: false,
  sweepTimer: null,
  sweepDirection: 1,
  stream: null,
  devices: [],
  preferredFacingMode: isMobileLike() ? "environment" : "user",
  activeDeviceId: "",
  animationId: null,
  calibrationMode: false,
  calibrationStart: null,
  calibrationEnd: null,
  cmPerPixel: null,
  trackedPoint: null,
  recentPoints: [],
  samplePoints: [],
  latestPixelAmplitude: 0,
  latestAmplitudeCm: 0,
  records: [],
  startedAt: performance.now(),
  sweepDwell: null,
  resizeFrame: null,
  resizeObserver: null,
};

function isMobileLike() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return value.toFixed(digits);
}

function elapsedSeconds() {
  return (performance.now() - state.startedAt) / 1000;
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = `status-pill ${kind}`;
}

function setMode(mode) {
  state.mode = mode;
  $$(".mode-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  $$(".mode-pane").forEach((pane) => pane.classList.remove("active"));
  $(`#${mode}Mode`).classList.add("active");

  if (mode === "precise") setFrequency(Number(els.preciseFrequency.value));
  if (mode === "slider") setFrequency(Number(els.sliderFrequency.value));
  if (mode !== "sweep") stopSweep();
  scheduleCanvasResize();
}

function frequencyMatches(a, b) {
  return Math.abs(Number(a) - Number(b)) < 1e-6;
}

function setFrequency(value) {
  const cleanValue = clamp(Number(value) || 0, 0, 1000);
  state.currentFrequency = cleanValue;
  els.frequencyReadout.textContent = formatNumber(cleanValue, 2);
  if (state.mode !== "precise") els.preciseFrequency.value = cleanValue;
  if (state.mode !== "slider") els.sliderFrequency.value = clamp(cleanValue, 1, 1000);

  if (state.oscillator && state.audioContext) {
    const audibleFrequency = Math.max(cleanValue, 0.0001);
    state.oscillator.frequency.setTargetAtTime(audibleFrequency, state.audioContext.currentTime, 0.015);
  }
}

async function toggleAudio() {
  if (state.isPlaying) {
    stopAudio();
    return;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    alert("当前浏览器不支持 Web Audio API。");
    return;
  }

  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }
  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }

  state.oscillator = state.audioContext.createOscillator();
  state.gainNode = state.audioContext.createGain();
  state.oscillator.type = "sine";
  state.oscillator.frequency.value = Math.max(state.currentFrequency, 0.0001);
  state.gainNode.gain.value = Number(els.waveGain.value);
  state.oscillator.connect(state.gainNode);
  state.gainNode.connect(state.audioContext.destination);
  state.oscillator.start();
  state.isPlaying = true;
  els.playIcon.textContent = "■";
  els.playToggle.title = "停止声音";
}

function stopAudio() {
  if (state.oscillator) {
    try {
      state.oscillator.stop();
    } catch (_) {
      // The node may already be stopped by the browser.
    }
    state.oscillator.disconnect();
  }
  state.oscillator = null;
  state.gainNode = null;
  state.isPlaying = false;
  els.playIcon.textContent = "▶";
  els.playToggle.title = "播放声音";
}

function startSweep() {
  if (state.sweepTimer) {
    stopSweep();
    return;
  }
  const start = Number(els.sweepStart.value) || 0;
  const peak = Math.max(start, Number(els.sweepPeak.value) || 20);
  const step = Math.max(0.1, Number(els.sweepStep.value) || 1);
  const interval = Math.max(0.2, Number(els.sweepInterval.value) || 5);

  state.sweepDirection = 1;
  clearData();
  setFrequency(start);
  beginSweepDwell(start);
  els.sweepToggle.textContent = "停止自动扫频";
  els.sweepToggle.classList.add("primary");
  state.sweepTimer = window.setInterval(() => {
    finalizeSweepDwell();
    let next = state.currentFrequency + step * state.sweepDirection;
    if (next >= peak) {
      next = peak;
      state.sweepDirection = -1;
    }
    if (next <= start) {
      next = start;
      state.sweepDirection = 1;
    }
    setFrequency(next);
    beginSweepDwell(next);
  }, interval * 1000);
}

function stopSweep() {
  if (state.sweepTimer) {
    clearInterval(state.sweepTimer);
    state.sweepTimer = null;
  }
  finalizeSweepDwell();
  els.sweepToggle.textContent = "启动自动扫频";
  els.sweepToggle.classList.remove("primary");
}

function beginSweepDwell(frequency) {
  state.samplePoints = [];
  state.sweepDwell = {
    frequency,
    yMin: Infinity,
    yMax: -Infinity,
    hasPoint: false,
    startedAt: elapsedSeconds(),
  };
  updateAmplitude();
}

function updateSweepDwell(point) {
  if (!state.sweepDwell) return;
  state.sweepDwell.yMin = Math.min(state.sweepDwell.yMin, point.y);
  state.sweepDwell.yMax = Math.max(state.sweepDwell.yMax, point.y);
  state.sweepDwell.hasPoint = true;
}

function finalizeSweepDwell() {
  const dwell = state.sweepDwell;
  if (!dwell) return;
  state.sweepDwell = null;
  if (!dwell.hasPoint) {
    return;
  }
  const pixelDelta = dwell.yMax - dwell.yMin;
  const deltaCm = pixelDelta * (state.cmPerPixel || 0);
  upsertSweepRecord({
    frequency: dwell.frequency,
    amplitude: deltaCm,
    time: elapsedSeconds(),
  });
}

function upsertSweepRecord(record) {
  const existing = state.records.find((item) => frequencyMatches(item.frequency, record.frequency));
  if (existing) {
    if (record.amplitude > existing.amplitude) {
      existing.amplitude = record.amplitude;
      existing.time = record.time;
    }
  } else {
    state.records.push({
      index: state.records.length + 1,
      frequency: record.frequency,
      amplitude: record.amplitude,
      time: record.time,
    });
  }
  renderTable();
  drawChart();
}

async function requestCamera(deviceId = "") {
  stopCamera();
  const constraints = {
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };

  if (deviceId) {
    constraints.video.deviceId = { exact: deviceId };
  } else {
    constraints.video.facingMode = { ideal: state.preferredFacingMode };
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.video.srcObject = state.stream;
    const [track] = state.stream.getVideoTracks();
    state.activeDeviceId = track?.getSettings?.().deviceId || deviceId || "";
    els.videoHint.style.display = "none";
    setStatus(els.cameraStatus, "摄像头运行中", "ok");
    await populateCameras();
    await els.video.play();
    resizeCanvases();
    startTrackingLoop();
  } catch (error) {
    els.videoHint.style.display = "block";
    setStatus(els.cameraStatus, "摄像头打开失败", "warn");
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  cancelAnimationFrame(state.animationId);
  state.animationId = null;
}

async function populateCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  state.devices = devices.filter((device) => device.kind === "videoinput");
  els.cameraSelect.innerHTML = "";
  state.devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `摄像头 ${index + 1}`;
    option.selected = device.deviceId === state.activeDeviceId;
    els.cameraSelect.appendChild(option);
  });
}

function flipCamera() {
  if (state.devices.length > 1 && state.activeDeviceId) {
    const index = state.devices.findIndex((device) => device.deviceId === state.activeDeviceId);
    const next = state.devices[(index + 1) % state.devices.length];
    requestCamera(next.deviceId);
    return;
  }
  state.preferredFacingMode = state.preferredFacingMode === "user" ? "environment" : "user";
  requestCamera();
}

function resizeCanvases() {
  const rect = els.videoStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  [els.overlay, els.chartCanvas].forEach((canvas) => {
    if (canvas === els.chartCanvas) return;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  });
  drawOverlay();
  drawChart();
}

function scheduleCanvasResize() {
  if (state.resizeFrame) {
    cancelAnimationFrame(state.resizeFrame);
  }
  state.resizeFrame = requestAnimationFrame(() => {
    state.resizeFrame = requestAnimationFrame(() => {
      state.resizeFrame = null;
      resizeCanvases();
    });
  });
}

function getVideoDisplayRect() {
  const stageRect = els.videoStage.getBoundingClientRect();
  const videoWidth = els.video.videoWidth || 16;
  const videoHeight = els.video.videoHeight || 9;
  const stageAspect = stageRect.width / stageRect.height;
  const videoAspect = videoWidth / videoHeight;
  let width = stageRect.width;
  let height = stageRect.height;
  let x = 0;
  let y = 0;
  if (stageAspect > videoAspect) {
    width = stageRect.width;
    height = width / videoAspect;
    y = (stageRect.height - height) / 2;
  } else {
    height = stageRect.height;
    width = height * videoAspect;
    x = (stageRect.width - width) / 2;
  }
  return { x, y, width, height, videoWidth, videoHeight };
}

function overlayPointToVideo(point) {
  const rect = getVideoDisplayRect();
  return {
    x: ((point.x - rect.x) / rect.width) * rect.videoWidth,
    y: ((point.y - rect.y) / rect.height) * rect.videoHeight,
  };
}

function videoPointToOverlay(point) {
  const rect = getVideoDisplayRect();
  return {
    x: rect.x + (point.x / rect.videoWidth) * rect.width,
    y: rect.y + (point.y / rect.videoHeight) * rect.height,
  };
}

function pointerPosition(event) {
  const rect = els.overlay.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function startCalibration() {
  state.calibrationMode = true;
  state.calibrationStart = null;
  state.calibrationEnd = null;
  els.calibrate.textContent = "在画面中拖拽 1cm";
  els.calibrate.classList.add("primary");
  setStatus(els.scaleStatus, "正在绘制标尺", "warn");
  drawOverlay();
}

function finishCalibration() {
  if (!state.calibrationStart || !state.calibrationEnd) return;
  const start = overlayPointToVideo(state.calibrationStart);
  const end = overlayPointToVideo(state.calibrationEnd);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 3) {
    setStatus(els.scaleStatus, "标尺过短，请重画", "warn");
    state.calibrationMode = false;
    els.calibrate.textContent = "绘制 1cm 标尺";
    return;
  }
  state.cmPerPixel = 1 / length;
  els.ratioReadout.textContent = `${state.cmPerPixel.toFixed(5)} cm/px`;
  setStatus(els.scaleStatus, `1cm = ${length.toFixed(1)} px`, "ok");
  state.calibrationMode = false;
  els.calibrate.textContent = "重绘 1cm 标尺";
  updateAmplitude();
  drawOverlay();
}

function startTrackingLoop() {
  if (state.animationId) return;
  const loop = () => {
    trackRedSpot();
    drawOverlay();
    state.animationId = requestAnimationFrame(loop);
  };
  state.animationId = requestAnimationFrame(loop);
}

function trackRedSpot() {
  const video = els.video;
  if (!video.videoWidth || !video.videoHeight) return;
  const canvas = els.processingCanvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const step = canvas.width > 1000 ? 2 : 1;
  let weightSum = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const index = (y * canvas.width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const hsv = rgbToHsv(r, g, b);
      const hueIsRed = hsv.h <= 18 || hsv.h >= 340;
      const strongRed = r > 135 && r - g > 35 && r - b > 20;
      if (hueIsRed && hsv.s > 0.38 && hsv.v > 0.35 && strongRed) {
        const weight = (hsv.s * hsv.v * 255 + Math.max(0, r - Math.max(g, b))) / 2;
        weightSum += weight;
        sumX += x * weight;
        sumY += y * weight;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (weightSum > 900) {
    const point = {
      x: sumX / weightSum,
      y: sumY / weightSum,
      radius: Math.max(7, Math.hypot(maxX - minX, maxY - minY) / 2),
      t: elapsedSeconds(),
    };
    state.trackedPoint = point;
    state.recentPoints.push(point);
    state.samplePoints.push(point);
    updateSweepDwell(point);
    trimPoints();
    setStatus(els.trackStatus, "已锁定红色光斑", "live");
    els.centroidX.textContent = formatNumber(point.x, 1);
    els.centroidY.textContent = formatNumber(point.y, 1);
    els.sampleCount.textContent = String(state.samplePoints.length);
    updateAmplitude();
  } else {
    state.trackedPoint = null;
    setStatus(els.trackStatus, "未锁定红色光斑", "idle");
  }
}

function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    if (max === g) h = 60 * ((b - r) / delta + 2);
    if (max === b) h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function trimPoints() {
  const now = elapsedSeconds();
  state.recentPoints = state.recentPoints.filter((point) => now - point.t <= 8);
  if (state.samplePoints.length > 1200) {
    state.samplePoints.splice(0, state.samplePoints.length - 1200);
  }
}

function getAmplitudeFrom(points) {
  if (!points.length) return 0;
  const ys = points.map((point) => point.y);
  return Math.max(...ys) - Math.min(...ys);
}

function updateAmplitude() {
  const source = state.samplePoints.length ? state.samplePoints : state.recentPoints;
  state.latestPixelAmplitude = getAmplitudeFrom(source);
  state.latestAmplitudeCm = state.latestPixelAmplitude * (state.cmPerPixel || 0);
  els.pixelAmplitude.textContent = `${formatNumber(state.latestPixelAmplitude, 1)} px`;
  els.amplitudeReadout.textContent = formatNumber(state.latestAmplitudeCm, 3);
}

function drawOverlay() {
  const canvas = els.overlay;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  const videoRect = getVideoDisplayRect();
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.strokeRect(videoRect.x, videoRect.y, videoRect.width, videoRect.height);
  ctx.restore();

  drawTrail(ctx);
  drawTrackedPoint(ctx);
  drawCalibrationLine(ctx);

  if (state.calibrationMode && !state.calibrationStart) {
    ctx.save();
    ctx.fillStyle = "rgba(17, 24, 39, 0.72)";
    ctx.fillRect(18, 18, 218, 38);
    ctx.fillStyle = "#fff";
    ctx.font = "700 14px sans-serif";
    ctx.fillText("拖拽一段实际长度为 1cm 的线", 30, 43);
    ctx.restore();
  }
}

function drawTrail(ctx) {
  if (state.recentPoints.length < 2) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(34, 197, 94, 0.78)";
  ctx.beginPath();
  state.recentPoints.forEach((point, index) => {
    const p = videoPointToOverlay(point);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawTrackedPoint(ctx) {
  if (!state.trackedPoint) return;
  const p = videoPointToOverlay(state.trackedPoint);
  const videoRect = getVideoDisplayRect();
  const scale = videoRect.width / videoRect.videoWidth;
  const radius = clamp(state.trackedPoint.radius * scale, 10, 34);
  ctx.save();
  ctx.strokeStyle = "#ff2d55";
  ctx.fillStyle = "rgba(255, 45, 85, 0.16)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - radius - 8, p.y);
  ctx.lineTo(p.x + radius + 8, p.y);
  ctx.moveTo(p.x, p.y - radius - 8);
  ctx.lineTo(p.x, p.y + radius + 8);
  ctx.stroke();
  ctx.restore();
}

function drawCalibrationLine(ctx) {
  if (!state.calibrationStart || !state.calibrationEnd) return;
  ctx.save();
  ctx.strokeStyle = "#f97316";
  ctx.fillStyle = "#f97316";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(state.calibrationStart.x, state.calibrationStart.y);
  ctx.lineTo(state.calibrationEnd.x, state.calibrationEnd.y);
  ctx.stroke();
  [state.calibrationStart, state.calibrationEnd].forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.font = "800 13px sans-serif";
  ctx.fillText("1 cm", state.calibrationEnd.x + 8, state.calibrationEnd.y - 8);
  ctx.restore();
}

function renderTable() {
  els.dataBody.innerHTML = "";
  if (!state.records.length) {
    els.dataBody.innerHTML = '<tr class="empty-row"><td colspan="4">启动自动扫频后自动记录数据</td></tr>';
    return;
  }
  const fragment = document.createDocumentFragment();
  state.records.forEach((record) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${record.index}</td>
      <td>${record.frequency === null ? "视频" : formatNumber(record.frequency, 2)}</td>
      <td>${formatNumber(record.amplitude, 3)}</td>
      <td>${formatNumber(record.time, 2)}</td>
    `;
    fragment.appendChild(row);
  });
  els.dataBody.appendChild(fragment);
  els.dataBody.parentElement.parentElement.scrollTop = els.dataBody.parentElement.parentElement.scrollHeight;
}

function clearData() {
  state.records = [];
  state.sweepDwell = null;
  state.samplePoints = [];
  state.recentPoints = [];
  state.latestAmplitudeCm = 0;
  state.latestPixelAmplitude = 0;
  els.amplitudeReadout.textContent = "0.000";
  els.pixelAmplitude.textContent = "0.0 px";
  els.sampleCount.textContent = "0";
  renderTable();
  drawChart();
}

function drawChart() {
  const canvas = els.chartCanvas;
  const container = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(container.width * dpr));
  canvas.height = Math.max(1, Math.round(container.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = container.width;
  const height = container.height;
  ctx.clearRect(0, 0, width, height);

  const padding = { left: 54, right: 24, top: 36, bottom: 44 };
  const plot = {
    x: padding.left,
    y: padding.top,
    width: width - padding.left - padding.right,
    height: height - padding.top - padding.bottom,
  };

  const points = state.records
    .filter((record) => Number.isFinite(record.frequency) && Number.isFinite(record.amplitude))
    .map((record) => ({ x: record.frequency, y: record.amplitude }))
    .sort((a, b) => a.x - b.x);

  const maxX = niceMax(Math.max(20, ...points.map((p) => p.x)));
  const maxY = niceMax(Math.max(1, ...points.map((p) => p.y)));

  drawChartGrid(ctx, plot, maxX, maxY);

  const toCanvas = (point) => ({
    x: plot.x + (point.x / maxX) * plot.width,
    y: plot.y + plot.height - (point.y / maxY) * plot.height,
  });

  if (points.length) {
    drawSmoothCurve(ctx, points.map(toCanvas));
    ctx.save();
    points.forEach((point) => {
      const p = toCanvas(point);
      ctx.fillStyle = "#f97316";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "#657184";
    ctx.font = "800 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("点击“启动自动扫频”采集频率与 Δy 后绘图", plot.x + plot.width / 2, plot.y + plot.height / 2);
    ctx.restore();
  }
}

function niceMax(value) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let nice = 1;
  if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exponent;
}

function drawChartGrid(ctx, plot, maxX, maxY) {
  ctx.save();
  ctx.strokeStyle = "#d7dde8";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#657184";
  ctx.font = "700 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const xTicks = 5;
  const yTicks = 5;
  for (let i = 0; i <= xTicks; i += 1) {
    const x = plot.x + (i / xTicks) * plot.width;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.height);
    ctx.stroke();
    ctx.fillText(formatNumber((maxX * i) / xTicks, 1), x, plot.y + plot.height + 18);
  }
  ctx.textAlign = "right";
  for (let i = 0; i <= yTicks; i += 1) {
    const y = plot.y + plot.height - (i / yTicks) * plot.height;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.width, y);
    ctx.stroke();
    ctx.fillText(formatNumber((maxY * i) / yTicks, 2), plot.x - 10, y);
  }

  ctx.strokeStyle = "#18212f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x + plot.width + 10, plot.y + plot.height);
  ctx.moveTo(plot.x, plot.y + plot.height);
  ctx.lineTo(plot.x, plot.y - 10);
  ctx.stroke();

  drawArrow(ctx, plot.x + plot.width + 10, plot.y + plot.height, 0);
  drawArrow(ctx, plot.x, plot.y - 10, -Math.PI / 2);

  ctx.fillStyle = "#18212f";
  ctx.font = "900 18px serif";
  ctx.textAlign = "right";
  ctx.fillText("O", plot.x - 7, plot.y + plot.height + 17);
  ctx.textAlign = "center";
  ctx.font = "italic 900 18px 'Times New Roman', serif";
  ctx.fillText("f", plot.x + plot.width + 18, plot.y + plot.height + 17);

  drawMixedAxisText(ctx, [
    { text: "频率 ", font: "800 12px sans-serif" },
    { text: "f", font: "italic 900 15px 'Times New Roman', serif" },
    { text: " / Hz", font: "800 12px sans-serif" },
  ], plot.x + plot.width / 2, plot.y + plot.height + 34);
  ctx.save();
  ctx.translate(15, plot.y + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  drawMixedAxisText(ctx, [
    { text: "光斑振动幅度 ", font: "800 12px sans-serif" },
    { text: "Δy", font: "italic 900 15px 'Times New Roman', serif" },
    { text: " / cm", font: "800 12px sans-serif" },
  ], 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawMixedAxisText(ctx, parts, x, y) {
  const widths = parts.map((part) => {
    ctx.font = part.font;
    return ctx.measureText(part.text).width;
  });
  let cursor = x - widths.reduce((sum, width) => sum + width, 0) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  parts.forEach((part, index) => {
    ctx.font = part.font;
    ctx.fillText(part.text, cursor, y);
    cursor += widths[index];
  });
}

function drawArrow(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#18212f";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-9, -5);
  ctx.lineTo(-9, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSmoothCurve(ctx, points) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "#2867c9";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1 = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    };
    const cp2 = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    };
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
  }
  ctx.stroke();
  ctx.restore();
}

function bindEvents() {
  els.playToggle.addEventListener("click", toggleAudio);
  els.waveGain.addEventListener("input", () => {
    if (state.gainNode && state.audioContext) {
      state.gainNode.gain.setTargetAtTime(Number(els.waveGain.value), state.audioContext.currentTime, 0.01);
    }
  });
  els.preciseFrequency.addEventListener("input", (event) => setFrequency(event.target.value));
  els.sliderFrequency.addEventListener("input", (event) => setFrequency(event.target.value));
  els.sweepToggle.addEventListener("click", startSweep);
  $$(".mode-tab").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  els.requestCamera.addEventListener("click", () => requestCamera());
  els.cameraSelect.addEventListener("change", (event) => requestCamera(event.target.value));
  els.flipCamera.addEventListener("click", flipCamera);

  els.calibrate.addEventListener("click", startCalibration);
  els.resetTrack.addEventListener("click", () => {
    state.recentPoints = [];
    state.samplePoints = [];
    updateAmplitude();
    drawOverlay();
  });

  els.overlay.addEventListener("pointerdown", (event) => {
    if (!state.calibrationMode) return;
    els.overlay.setPointerCapture(event.pointerId);
    state.calibrationStart = pointerPosition(event);
    state.calibrationEnd = pointerPosition(event);
    drawOverlay();
  });
  els.overlay.addEventListener("pointermove", (event) => {
    if (!state.calibrationMode || !state.calibrationStart) return;
    state.calibrationEnd = pointerPosition(event);
    drawOverlay();
  });
  els.overlay.addEventListener("pointerup", (event) => {
    if (!state.calibrationMode || !state.calibrationStart) return;
    state.calibrationEnd = pointerPosition(event);
    finishCalibration();
  });

  els.drawChart.addEventListener("click", drawChart);
  window.addEventListener("resize", scheduleCanvasResize);
  els.video.addEventListener("loadedmetadata", scheduleCanvasResize);
  if ("ResizeObserver" in window) {
    state.resizeObserver = new ResizeObserver(scheduleCanvasResize);
    state.resizeObserver.observe(els.videoStage);
    state.resizeObserver.observe(els.chartCanvas.parentElement);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleCanvasResize();
  });
}

function init() {
  bindEvents();
  renderTable();
  resizeCanvases();
  setFrequency(5);
  if (navigator.mediaDevices?.getUserMedia) {
    requestCamera();
  } else {
    setStatus(els.cameraStatus, "浏览器不支持摄像头", "warn");
  }
}

init();
