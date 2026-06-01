const TURN_RADIUS = 10;
const DEG = Math.PI / 180;

const els = {
  canvas: document.getElementById("patternCanvas"),
  pathControl: document.getElementById("pathControl"),
  pathPoint: document.getElementById("pathPoint"),
  pathPointOut: document.getElementById("pathPointOut"),
  table: document.getElementById("metricsTable"),
  totalAltitude: document.getElementById("totalAltitude"),
  downwind: document.getElementById("downwind"),
  base: document.getElementById("base"),
  final: document.getElementById("final"),
  wind: document.getElementById("wind"),
  straightGlide: document.getElementById("straightGlide"),
  turnGlide: document.getElementById("turnGlide"),
  airspeed: document.getElementById("airspeed"),
  downwindOut: document.getElementById("downwindOut"),
  baseOut: document.getElementById("baseOut"),
  finalOut: document.getElementById("finalOut"),
  windOut: document.getElementById("windOut"),
  straightGlideOut: document.getElementById("straightGlideOut"),
  turnGlideOut: document.getElementById("turnGlideOut"),
  airspeedOut: document.getElementById("airspeedOut")
};

let state = {
  view: "2d",
  hand: "left",
  rotation: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  pathProgress: 0,
  isDragging: false,
  lastPointerX: 0,
  lastPointerY: 0
};

const ctx = els.canvas.getContext("2d");
const locales = window.LandingPatternLocales || {};
const browserLanguages = navigator.languages || [navigator.language || "en"];
const localeKey = browserLanguages
  .map((language) => language.toLowerCase())
  .flatMap((language) => [language, language.split("-")[0]])
  .find((language) => locales[language]) || "en";
const messages = locales[localeKey] || locales.en || {};

function t(key, values = {}) {
  const template = messages[key] || (locales.en && locales.en[key]) || key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    template
  );
}

function applyLanguage() {
  document.documentElement.lang = localeKey;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
}

function kmhToMps(value) {
  return value / 3.6;
}

function fmt(value, suffix, decimals = 0) {
  return `${value.toFixed(decimals)} ${suffix}`;
}

function getParams() {
  return {
    downwind: Number(els.downwind.value),
    base: Number(els.base.value),
    final: Number(els.final.value),
    wind: Number(els.wind.value),
    straightGlide: Number(els.straightGlide.value),
    turnGlide: Number(els.turnGlide.value),
    airspeed: Number(els.airspeed.value),
    hand: state.hand
  };
}

function syncOutputs(p) {
  els.downwindOut.value = fmt(p.downwind, "m");
  els.baseOut.value = fmt(p.base, "m");
  els.finalOut.value = fmt(p.final, "m");
  els.windOut.value = fmt(p.wind, "km/h");
  els.straightGlideOut.value = `${p.straightGlide.toFixed(1)}:1`;
  els.turnGlideOut.value = `${p.turnGlide.toFixed(1)}:1`;
  els.airspeedOut.value = fmt(p.airspeed, "km/h");
}

function v(x, y) {
  return { x, y };
}

function add(a, b) {
  return v(a.x + b.x, a.y + b.y);
}

function scale(a, n) {
  return v(a.x * n, a.y * n);
}

function lerp(a, b, t) {
  return v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function rotatePoint(pt) {
  const turns = ((state.rotation % 4) + 4) % 4;
  if (turns === 1) {
    return v(pt.y, -pt.x);
  }
  if (turns === 2) {
    return v(-pt.x, -pt.y);
  }
  if (turns === 3) {
    return v(-pt.y, pt.x);
  }
  return pt;
}

function applyViewportTransform(point, width, height) {
  return {
    x: ((point.x - width / 2) * state.zoom) + width / 2 + state.panX,
    y: ((point.y - height / 2) * state.zoom) + height / 2 + state.panY
  };
}

function resetViewport() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
}

function headingUnit(deg) {
  const rad = deg * DEG;
  return v(Math.sin(rad), Math.cos(rad));
}

function groundSpeedForTrack(track, p) {
  const air = p.airspeed;
  const wind = v(0, p.wind);
  const alongWind = wind.x * track.x + wind.y * track.y;
  const crossWind = wind.x * -track.y + wind.y * track.x;
  const usable = Math.max(0, (air * air) - (crossWind * crossWind));
  const speed = Math.sqrt(usable) + alongWind;
  return {
    speed: Math.max(1, speed),
    limited: Math.abs(crossWind) >= air || speed <= 0
  };
}

function straightStats(length, track, glide, p) {
  const ground = groundSpeedForTrack(track, p);
  const time = length / kmhToMps(ground.speed);
  const airDistance = kmhToMps(p.airspeed) * time;
  return {
    airDistance,
    time,
    altitudeLoss: airDistance / glide,
    groundSpeed: ground.speed,
    limited: ground.limited
  };
}

function turnStats(clockwise, fromHeading, glide, p) {
  const steps = 48;
  const arc = Math.PI * TURN_RADIUS / 2;
  let time = 0;
  let limited = false;

  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    const heading = fromHeading + (clockwise ? 90 : -90) * t;
    const ground = groundSpeedForTrack(headingUnit(heading), p);
    time += (arc / steps) / kmhToMps(ground.speed);
    limited = limited || ground.limited;
  }

  const airDistance = kmhToMps(p.airspeed) * time;
  return {
    airDistance,
    time,
    altitudeLoss: airDistance / glide,
    groundSpeed: (arc / time) * 3.6,
    limited
  };
}

function arcPoints(center, startDeg, endDeg, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = (startDeg + (endDeg - startDeg) * t) * DEG;
    pts.push(v(center.x + Math.cos(a) * TURN_RADIUS, center.y + Math.sin(a) * TURN_RADIUS));
  }
  return pts;
}

function buildPattern(p) {
  const s = p.hand === "right" ? -1 : 1;
  const finalStart = v(0, p.final);
  const finalEnd = v(0, 0);
  const baseEnd = v(s * TURN_RADIUS, p.final + TURN_RADIUS);
  const baseStart = v(s * (p.base + TURN_RADIUS), p.final + TURN_RADIUS);
  const downwindTurnStart = v(s * (p.base + 2 * TURN_RADIUS), p.final);
  const entry = v(s * (p.base + 2 * TURN_RADIUS), p.final - p.downwind);

  const turn2Center = v(s * TURN_RADIUS, p.final);
  const turn1Center = v(s * (p.base + TURN_RADIUS), p.final);

  const clockwise = p.hand === "right";
  const turn1Angles = clockwise ? [180, 90] : [0, 90];
  const turn2Angles = clockwise ? [90, 0] : [90, 180];

  const segmentsForward = [
    {
      id: "downwind",
      name: t("segment.downwind"),
      type: "straight",
      points: [entry, downwindTurnStart],
      length: p.downwind,
      track: headingUnit(0),
      stats: straightStats(p.downwind, headingUnit(0), p.straightGlide, p)
    },
    {
      id: "turn1",
      name: t("segment.turnToBase"),
      type: "turn",
      points: arcPoints(turn1Center, turn1Angles[0], turn1Angles[1], 24),
      length: Math.PI * TURN_RADIUS / 2,
      stats: turnStats(clockwise, 0, p.turnGlide, p)
    },
    {
      id: "base",
      name: t("segment.base"),
      type: "straight",
      points: [baseStart, baseEnd],
      length: p.base,
      track: headingUnit(clockwise ? 90 : 270),
      stats: straightStats(p.base, headingUnit(clockwise ? 90 : 270), p.straightGlide, p)
    },
    {
      id: "turn2",
      name: t("segment.turnToFinal"),
      type: "turn",
      points: arcPoints(turn2Center, turn2Angles[0], turn2Angles[1], 24),
      length: Math.PI * TURN_RADIUS / 2,
      stats: turnStats(clockwise, clockwise ? 90 : 270, p.turnGlide, p)
    },
    {
      id: "final",
      name: t("segment.final"),
      type: "straight",
      points: [finalStart, finalEnd],
      length: p.final,
      track: headingUnit(180),
      stats: straightStats(p.final, headingUnit(180), p.straightGlide, p)
    }
  ];

  let altitude = 0;
  [...segmentsForward].reverse().forEach((segment) => {
    segment.altEnd = altitude;
    altitude += segment.stats.altitudeLoss;
    segment.altStart = altitude;
  });

  return {
    segments: segmentsForward,
    totalAltitude: altitude,
    landing: finalEnd,
    entry,
    bounds: collectBounds(segmentsForward)
  };
}

function collectBounds(segments) {
  const xs = [];
  const ys = [];
  segments.forEach((segment) => {
    segment.points.forEach((pt) => {
      xs.push(pt.x);
      ys.push(pt.y);
    });
  });
  return {
    minX: Math.min(...xs) - 45,
    maxX: Math.max(...xs) + 45,
    minY: Math.min(...ys) - 45,
    maxY: Math.max(...ys) + 45
  };
}

function resizeCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  els.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function makeProjector(pattern) {
  const rect = els.canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const sideGap = Math.min(72, Math.max(36, w * 0.05));
  const topGap = Math.min(90, Math.max(40, h * 0.08));
  const bottomGap = Math.min(76, Math.max(44, h * 0.07));
  const source = pattern.bounds;
  const corners = [
    v(source.minX, source.minY),
    v(source.minX, source.maxY),
    v(source.maxX, source.minY),
    v(source.maxX, source.maxY)
  ].map(rotatePoint);
  const b = {
    minX: Math.min(...corners.map((pt) => pt.x)),
    maxX: Math.max(...corners.map((pt) => pt.x)),
    minY: Math.min(...corners.map((pt) => pt.y)),
    maxY: Math.max(...corners.map((pt) => pt.y))
  };
  const spanX = b.maxX - b.minX;
  const spanY = b.maxY - b.minY;

  if (state.view === "2d") {
    const scale2d = Math.min((w - sideGap * 2) / spanX, (h - topGap - bottomGap) / spanY);
    return (pt) => {
      const rotated = rotatePoint(pt);
      const screen = {
        x: (rotated.x - (b.minX + spanX / 2)) * scale2d + w / 2,
        y: topGap + (b.maxY - rotated.y) * scale2d
      };
      return applyViewportTransform(screen, w, h);
    };
  }

  const cos = Math.cos(30 * DEG);
  const sin = Math.sin(30 * DEG);
  const isoPts = [
    v(b.minX, b.minY), v(b.minX, b.maxY), v(b.maxX, b.minY), v(b.maxX, b.maxY)
  ].map((pt) => v((pt.y - pt.x) * cos, (pt.x + pt.y) * sin));
  const minX = Math.min(...isoPts.map((pt) => pt.x));
  const maxX = Math.max(...isoPts.map((pt) => pt.x));
  const minY = Math.min(...isoPts.map((pt) => pt.y)) - pattern.totalAltitude * 0.7;
  const maxY = Math.max(...isoPts.map((pt) => pt.y));
  const scale3d = Math.min((w - sideGap * 2) / (maxX - minX), (h - topGap - bottomGap) / (maxY - minY));
  const ox = w / 2 - ((minX + maxX) / 2) * scale3d;
  const oy = topGap - minY * scale3d;

  return (pt, z = 0) => {
    const rotated = rotatePoint(pt);
    const screen = {
      x: (rotated.y - rotated.x) * cos * scale3d + ox,
      y: (rotated.x + rotated.y) * sin * scale3d + oy - z * scale3d * 0.7
    };
    return applyViewportTransform(screen, w, h);
  };
}

function drawGrass(project) {
  const rect = els.canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (state.view === "2d") {
    const grd = ctx.createLinearGradient(0, 0, 0, rect.height);
    grd.addColorStop(0, "#8ab46a");
    grd.addColorStop(1, "#5f8f4b");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, rect.width, rect.height);
  } else {
    ctx.fillStyle = "#eaf3f8";
    ctx.fillRect(0, 0, rect.width, rect.height);
    const corners = [v(-700, -700), v(700, -700), v(700, 700), v(-700, 700)].map((pt) => project(pt, 0));
    ctx.beginPath();
    corners.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
    ctx.closePath();
    ctx.fillStyle = "#78a95d";
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let n = -700; n <= 700; n += 50) {
    drawPolyline([project(v(-700, n), 0), project(v(700, n), 0)]);
    drawPolyline([project(v(n, -700), 0), project(v(n, 700), 0)]);
  }
  ctx.restore();
}

function drawPolyline(points) {
  ctx.beginPath();
  points.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
  ctx.stroke();
}

function drawArrow(from, to, color) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - 12 * Math.cos(angle - 0.45), to.y - 12 * Math.sin(angle - 0.45));
  ctx.lineTo(to.x - 12 * Math.cos(angle + 0.45), to.y - 12 * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

function label(text, point, options = {}) {
  ctx.save();
  ctx.font = options.font || "12px Inter, system-ui, sans-serif";
  ctx.textAlign = options.align || "center";
  ctx.textBaseline = "middle";
  const paddingX = 7;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 22;
  if (options.foreground) {
    ctx.shadowColor = "rgba(24, 33, 26, 0.28)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
  }
  ctx.fillStyle = options.bg || "rgba(255, 255, 255, 0.86)";
  roundRect(point.x - width / 2, point.y - height / 2, width, height, 6);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = options.color || "#18211a";
  ctx.fillText(text, point.x, point.y + 0.5);
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function segmentPoint(segment, t) {
  if (segment.points.length === 2) {
    return lerp(segment.points[0], segment.points[1], t);
  }
  const index = Math.min(segment.points.length - 2, Math.floor(t * (segment.points.length - 1)));
  return segment.points[index];
}

function segmentPointByDistance(segment, targetDistance) {
  if (segment.points.length === 2) {
    const t = segment.length === 0 ? 0 : targetDistance / segment.length;
    return lerp(segment.points[0], segment.points[1], Math.min(1, Math.max(0, t)));
  }

  let covered = 0;
  for (let i = 0; i < segment.points.length - 1; i += 1) {
    const start = segment.points[i];
    const end = segment.points[i + 1];
    const leg = distance(start, end);
    if (covered + leg >= targetDistance) {
      const t = leg === 0 ? 0 : (targetDistance - covered) / leg;
      return lerp(start, end, Math.min(1, Math.max(0, t)));
    }
    covered += leg;
  }

  return segment.points[segment.points.length - 1];
}

function selectedPathPoint(pattern) {
  const totalLength = pattern.segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = totalLength * state.pathProgress;

  for (const segment of pattern.segments) {
    if (remaining <= segment.length) {
      const segmentT = segment.length === 0 ? 0 : remaining / segment.length;
      return {
        position: segmentPointByDistance(segment, remaining),
        altitude: segment.altStart + (segment.altEnd - segment.altStart) * segmentT,
        progress: state.pathProgress
      };
    }
    remaining -= segment.length;
  }

  const finalSegment = pattern.segments[pattern.segments.length - 1];
  return {
    position: finalSegment.points[finalSegment.points.length - 1],
    altitude: 0,
    progress: 1
  };
}

function drawSelectedPathPoint(pattern, project) {
  if (state.view !== "3d") {
    return;
  }

  const selected = selectedPathPoint(pattern);
  const selectedTop = project(selected.position, selected.altitude);
  const selectedGround = project(selected.position, 0);
  const landing = project(pattern.landing, 0);
  const horizontalDistance = distance(selected.position, pattern.landing);
  const angle = horizontalDistance === 0 ? 0 : Math.atan2(selected.altitude, horizontalDistance) / DEG;

  ctx.save();
  ctx.setLineDash([8, 7]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(24, 33, 26, 0.58)";
  drawPolyline([selectedTop, landing]);
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "rgba(24, 33, 26, 0.35)";
  drawPolyline([selectedGround, selectedTop]);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#101814";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(selectedTop.x, selectedTop.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#101814";
  ctx.beginPath();
  ctx.arc(selectedTop.x, selectedTop.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  label(
    t("canvas.selected", { altitude: Math.round(selected.altitude), angle: angle.toFixed(1) }),
    { x: selectedTop.x, y: selectedTop.y - 28 },
    { bg: "rgba(255,255,255,0.98)", foreground: true }
  );
}

function drawPattern(pattern, p) {
  const project = makeProjector(pattern);
  drawGrass(project);

  const colors = {
    downwind: "#255f9e",
    turn1: "#784f9b",
    base: "#7c6a1c",
    turn2: "#784f9b",
    final: "#b53e34"
  };

  pattern.segments.forEach((segment) => {
    const pts = segment.points.map((pt, i) => {
      const t = segment.points.length === 1 ? 0 : i / (segment.points.length - 1);
      const z = segment.altStart + (segment.altEnd - segment.altStart) * t;
      return project(pt, state.view === "3d" ? z : 0);
    });

    if (state.view === "3d") {
      [segment.points[0], segment.points[segment.points.length - 1]].forEach((pt, i) => {
        const z = i === 0 ? segment.altStart : segment.altEnd;
        const top = project(pt, z);
        const bottom = project(pt, 0);
        ctx.strokeStyle = "rgba(24, 33, 26, 0.22)";
        ctx.lineWidth = 1;
        drawPolyline([bottom, top]);
      });
    }

    ctx.strokeStyle = colors[segment.id];
    ctx.lineWidth = segment.type === "turn" ? 5 : 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawPolyline(pts);

    const mid = project(segmentPoint(segment, 0.5), state.view === "3d" ? (segment.altStart + segment.altEnd) / 2 : 0);
    label(`${Math.round(segment.stats.altitudeLoss)} m`, { x: mid.x, y: mid.y - 18 });
  });

  const landing = project(pattern.landing, 0);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#b53e34";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(landing.x, landing.y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(landing.x, landing.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#b53e34";
  ctx.fill();
  label(t("canvas.landingPoint"), { x: landing.x, y: landing.y + 28 });

  const entry = project(pattern.entry, state.view === "3d" ? pattern.totalAltitude : 0);
  ctx.fillStyle = "#18211a";
  ctx.beginPath();
  ctx.arc(entry.x, entry.y, 6, 0, Math.PI * 2);
  ctx.fill();
  label(t("canvas.entry", { altitude: Math.round(pattern.totalAltitude) }), { x: entry.x, y: entry.y - 28 }, { bg: "rgba(255,255,255,0.92)" });

  const windBase = project(v(70, -35), 0);
  const windTip = project(v(70, 45), 0);
  drawArrow(windBase, windTip, "#174e77");
  label(t("canvas.wind", { speed: p.wind }), { x: windTip.x, y: windTip.y - 23 }, { color: "#174e77" });

  drawSelectedPathPoint(pattern, project);
}

function renderMetrics(pattern) {
  els.totalAltitude.textContent = `${Math.round(pattern.totalAltitude)} m`;
  els.table.innerHTML = "";
  [...pattern.segments].reverse().forEach((segment) => {
    const item = document.createElement("article");
    item.className = "metric-row";
    item.innerHTML = `
      <div class="metric-title">
        <span>${segment.name}</span>
        <span>${segment.type === "turn" ? t("segment.typeTurn") : t("segment.typeLeg")}</span>
      </div>
      <div class="metric-grid">
        <div><span>${t("metric.airDistance")}</span><span>${segment.stats.airDistance.toFixed(1)} m</span></div>
        <div><span>${t("metric.time")}</span><span>${segment.stats.time.toFixed(1)} s</span></div>
        <div><span>${t("metric.altitudeLoss")}</span><span>${segment.stats.altitudeLoss.toFixed(1)} m</span></div>
        <div><span>${t("metric.groundSpeed")}</span><span>${segment.stats.groundSpeed.toFixed(1)} km/h</span></div>
      </div>
      ${segment.stats.limited ? `<div class="warning">${t("metric.windWarning")}</div>` : ""}
    `;
    els.table.appendChild(item);
  });
}

function render() {
  resizeCanvas();
  state.pathProgress = Number(els.pathPoint.value) / 1000;
  els.pathPointOut.value = `${Math.round(state.pathProgress * 100)}%`;
  els.pathControl.classList.toggle("is-hidden", state.view !== "3d");
  const params = getParams();
  syncOutputs(params);
  const pattern = buildPattern(params);
  renderMetrics(pattern);
  drawPattern(pattern, params);
}

document.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", render);
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b === button));
    render();
  });
});

document.querySelectorAll("[data-hand]").forEach((button) => {
  button.addEventListener("click", () => {
    state.hand = button.dataset.hand;
    document.querySelectorAll("[data-hand]").forEach((b) => b.classList.toggle("active", b === button));
    render();
  });
});

document.querySelectorAll("[data-rotate]").forEach((button) => {
  button.addEventListener("click", () => {
    state.rotation += Number(button.dataset.rotate);
    render();
  });
});

document.querySelectorAll("[data-zoom]").forEach((button) => {
  button.addEventListener("click", () => {
    const direction = Number(button.dataset.zoom);
    state.zoom = Math.min(3.5, Math.max(0.45, state.zoom * (direction > 0 ? 1.15 : 0.87)));
    render();
  });
});

document.querySelector("[data-view-reset]").addEventListener("click", () => {
  resetViewport();
  render();
});

els.canvas.addEventListener("pointerdown", (event) => {
  state.isDragging = true;
  state.lastPointerX = event.clientX;
  state.lastPointerY = event.clientY;
  els.canvas.setPointerCapture(event.pointerId);
});

els.canvas.addEventListener("pointermove", (event) => {
  if (!state.isDragging) {
    return;
  }
  state.panX += event.clientX - state.lastPointerX;
  state.panY += event.clientY - state.lastPointerY;
  state.lastPointerX = event.clientX;
  state.lastPointerY = event.clientY;
  render();
});

els.canvas.addEventListener("pointerup", (event) => {
  state.isDragging = false;
  els.canvas.releasePointerCapture(event.pointerId);
});

els.canvas.addEventListener("pointercancel", () => {
  state.isDragging = false;
});

els.canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = els.canvas.getBoundingClientRect();
  const oldZoom = state.zoom;
  const nextZoom = Math.min(3.5, Math.max(0.45, oldZoom * (event.deltaY < 0 ? 1.12 : 0.89)));
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;

  state.panX = pointerX - ((pointerX - state.panX - rect.width / 2) * (nextZoom / oldZoom) + rect.width / 2);
  state.panY = pointerY - ((pointerY - state.panY - rect.height / 2) * (nextZoom / oldZoom) + rect.height / 2);
  state.zoom = nextZoom;
  render();
}, { passive: false });

applyLanguage();
window.addEventListener("resize", render);
render();
