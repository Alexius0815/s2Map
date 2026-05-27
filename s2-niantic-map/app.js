const layers = [
  {
    id: "weather",
    level: 10,
    title: "Level 10 · Wetterzellen",
    color: "#0f766e",
    checked: true,
    minZoom: 10,
    labelZoom: 11,
    description:
      "Orientierung für Pokémon-GO-Wetterboosts. Eine S2-L10-Zelle deckt einen größeren Stadtbereich ab; Wetter kann an Zellgrenzen sichtbar wechseln.",
  },
  {
    id: "gym",
    level: 14,
    title: "Level 14 · Gym-Planung",
    color: "#7c3aed",
    checked: true,
    minZoom: 13,
    labelZoom: 15,
    description:
      "Nützlich, um POI-Dichte in Pokémon GO einzuschätzen. Viele Community-Planungen betrachten L14-Zellen für die Anzahl möglicher Arenen.",
  },
  {
    id: "stop",
    level: 17,
    title: "Level 17 · Stop/Waypoint",
    color: "#d97706",
    checked: true,
    minZoom: 16,
    labelZoom: 17,
    description:
      "Feine Zellen für PokéStop- und Waypoint-Orientierung. Meist zählt nur ein Wayspot pro L17-Zelle in Pokémon GO.",
  },
];

const state = {
  active: new Set(layers.filter((layer) => layer.checked).map((layer) => layer.id)),
  groups: new Map(),
  labels: new Map(),
  weather: new Map(),
  weatherPending: new Set(),
  weatherEnabled: false,
  renderTimer: 0,
  collapsed: true,
  locationCollapsed: false,
  locationMode: "place",
  locationMarker: null,
};

const map = L.map("map", {
  zoomControl: false,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  preferCanvas: false,
  worldCopyJump: true,
  attributionControl: false,
}).setView([48.137, 11.575], 11);

L.control.zoom({ position: "bottomleft" }).addTo(map);
L.control
  .attribution({
    prefix: false,
    position: "bottomright",
  })
  .addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>',
}).addTo(map);

const ui = {
  layerList: document.querySelector("#layerList"),
  layerTemplate: document.querySelector("#layerTemplate"),
  renderStatus: document.querySelector("#renderStatus"),
  panel: document.querySelector("#controlPanel"),
  panelToggle: document.querySelector("#panelToggle"),
  closePanel: document.querySelector("#closePanel"),
  locationPanel: document.querySelector(".location-panel"),
  locationPanelToggle: document.querySelector("#locationPanelToggle"),
  closeLocationPanel: document.querySelector("#closeLocationPanel"),
  locationInput: document.querySelector("#locationInput"),
  locationGoButton: document.querySelector("#locationGoButton"),
  locationStatus: document.querySelector("#locationStatus"),
  locationModes: document.querySelectorAll("input[name='locationMode']"),
  ownLocationButton: document.querySelector("#ownLocationButton"),
  weatherButton: document.querySelector("#weatherButton"),
  weatherStatus: document.querySelector("#weatherStatus"),
  helpToggle: document.querySelector("#helpToggle"),
  helpPanel: document.querySelector("#helpPanel"),
  closeHelpPanel: document.querySelector("#closeHelpPanel"),
  brandButton: document.querySelector("#brandButton"),
  aboutPanel: document.querySelector("#aboutPanel"),
  closeAboutPanel: document.querySelector("#closeAboutPanel"),
  locationConsent: document.querySelector("#locationConsent"),
  allowLocationButton: document.querySelector("#allowLocationButton"),
  skipLocationButton: document.querySelector("#skipLocationButton"),
};

layers.forEach((layer) => {
  const group = L.layerGroup().addTo(map);
  state.groups.set(layer.id, group);
  state.labels.set(layer.id, L.layerGroup().addTo(map));

  const node = ui.layerTemplate.content.firstElementChild.cloneNode(true);
  const input = node.querySelector("input");
  const swatch = node.querySelector(".swatch");
  const title = node.querySelector(".layer-title");
  const info = node.querySelector(".info-button");
  const description = node.querySelector(".layer-description");

  input.checked = layer.checked;
  input.id = `toggle-${layer.id}`;
  swatch.style.color = layer.color;
  title.textContent = layer.title;
  description.textContent = layer.description;
  info.title = layer.description;
  info.addEventListener("click", () => node.classList.toggle("is-open"));
  input.addEventListener("change", () => {
    if (input.checked) {
      state.active.add(layer.id);
    } else {
      state.active.delete(layer.id);
    }
    scheduleRender();
  });

  ui.layerList.appendChild(node);
});

ui.panelToggle.addEventListener("click", () => setPanelCollapsed(!state.collapsed));
ui.closePanel.addEventListener("click", () => setPanelCollapsed(true));
ui.locationPanelToggle.addEventListener("click", () => setLocationPanelCollapsed(!state.locationCollapsed));
ui.closeLocationPanel.addEventListener("click", () => setLocationPanelCollapsed(true));
ui.ownLocationButton.addEventListener("click", locateUser);
ui.locationGoButton.addEventListener("click", jumpToLocation);
ui.weatherButton.addEventListener("click", toggleWeather);
ui.helpToggle.addEventListener("click", () => setHelpPanelCollapsed(!ui.helpPanel.classList.contains("is-collapsed")));
ui.closeHelpPanel.addEventListener("click", () => setHelpPanelCollapsed(true));
ui.brandButton.addEventListener("click", () => setAboutPanelCollapsed(!ui.aboutPanel.classList.contains("is-collapsed")));
ui.brandButton.addEventListener("mouseenter", () => setAboutPanelCollapsed(false));
ui.closeAboutPanel.addEventListener("click", () => setAboutPanelCollapsed(true));
ui.allowLocationButton.addEventListener("click", () => {
  setLocationConsentVisible(false);
  setPanelCollapsed(true);
  setHelpPanelCollapsed(true);
  setAboutPanelCollapsed(true);
  locateUser({ initial: true });
});
ui.skipLocationButton.addEventListener("click", () => {
  setLocationConsentVisible(false);
  setPanelCollapsed(true);
  setHelpPanelCollapsed(true);
  setAboutPanelCollapsed(true);
});
ui.locationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") jumpToLocation();
});
ui.locationModes.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    state.locationMode = input.value;
    ui.locationInput.placeholder = input.value === "place" ? "München, Berlin, Köln ..." : "48.137, 11.575";
    ui.locationStatus.textContent = input.value === "place" ? "Ort oder PLZ suchen" : "Koordinaten eingeben";
    ui.locationInput.focus();
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setAboutPanelCollapsed(true);
});

map.on("moveend zoomend resize", scheduleRender);
scheduleRender();
window.setTimeout(requestInitialLocation, 300);

function setPanelCollapsed(collapsed) {
  state.collapsed = collapsed;
  ui.panel.classList.toggle("is-collapsed", collapsed);
  ui.panelToggle.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) {
    setHelpPanelCollapsed(true);
    setAboutPanelCollapsed(true);
  }
}

function setLocationPanelCollapsed(collapsed) {
  state.locationCollapsed = collapsed;
  ui.locationPanel.classList.toggle("is-collapsed", collapsed);
  ui.locationPanelToggle.classList.toggle("is-visible", collapsed);
  ui.locationPanelToggle.setAttribute("aria-expanded", String(!collapsed));
}

function setHelpPanelCollapsed(collapsed) {
  ui.helpPanel.classList.toggle("is-collapsed", collapsed);
  ui.helpToggle.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed && !state.collapsed) {
    setPanelCollapsed(true);
  }
  if (!collapsed) {
    setAboutPanelCollapsed(true);
  }
}

function setAboutPanelCollapsed(collapsed) {
  ui.aboutPanel.classList.toggle("is-collapsed", collapsed);
  ui.brandButton.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) {
    setPanelCollapsed(true);
    setHelpPanelCollapsed(true);
  }
}

function setLocationConsentVisible(visible) {
  ui.locationConsent.classList.toggle("is-hidden", !visible);
  document.body.classList.toggle("awaiting-location", visible);
}

function requestInitialLocation() {
  if (!navigator.geolocation) {
    setLocationConsentVisible(false);
    return;
  }
  setLocationConsentVisible(true);
}

function scheduleRender() {
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderCells, 80);
}

function renderCells() {
  const zoom = map.getZoom();
  const viewBounds = map.getBounds();
  let totalCells = 0;
  let visibleWeatherCells = [];
  const activeLayers = layers.filter((layer) => state.active.has(layer.id));

  layers.forEach((layer) => {
    state.groups.get(layer.id).clearLayers();
    state.labels.get(layer.id).clearLayers();
  });

  if (!activeLayers.length) {
    ui.renderStatus.textContent = "Keine Layer aktiv";
    return;
  }

  activeLayers.forEach((layer) => {
    if (zoom < layer.minZoom) {
      return;
    }

    const cells = collectVisibleCells(layer.level);
    totalCells += cells.length;
    if (layer.id === "weather") {
      visibleWeatherCells = cells;
    }

    cells.forEach((cell) => {
      const weather = layer.id === "weather" && state.weatherEnabled ? state.weather.get(cellKey(cell)) : null;
      const weatherColor = weather && weather.pokemonWeather ? weather.pokemonWeather.color : layer.color;
      const polygon = cellPolygon(cell.face, cell.i, cell.j, cell.level);
      const leafletPolygon = L.polygon(polygon, {
        color: weatherColor,
        weight: gridWeight(layer.level, zoom),
        opacity: 0.9,
        fillColor: weatherColor,
        fillOpacity: layer.id === "weather" ? 0.04 : 0,
        interactive: true,
      }).bindTooltip(buildTooltip(layer, cell, weather), {
        sticky: true,
        direction: "top",
      });
      leafletPolygon.addTo(state.groups.get(layer.id));

      if ((zoom >= layer.labelZoom || weather) && shouldLabelCell(cell, layer.level)) {
        const center = weather ? visibleLabelPosition(polygon, viewBounds) : cellCenter(cell.face, cell.i, cell.j, cell.level);
        L.marker(center, {
          interactive: false,
          icon: L.divIcon({
            className: "",
            html: buildLabel(layer, weather),
            iconSize: weather ? [74, 18] : [34, 18],
            iconAnchor: weather ? [37, 9] : [17, 9],
          }),
        }).addTo(state.labels.get(layer.id));
      }
    });
  });

  const hidden = activeLayers.filter((layer) => zoom < layer.minZoom);
  if (hidden.length) {
    ui.renderStatus.textContent = `${totalCells} Zellen · weiter hineinzoomen für ${hidden
      .map((layer) => `L${layer.level}`)
      .join(", ")}`;
  } else {
    ui.renderStatus.textContent = `${totalCells} Zellen sichtbar`;
  }

  if (state.weatherEnabled && state.active.has("weather") && zoom >= 10) {
    fetchWeatherForCells(visibleWeatherCells);
  }
}

function toggleWeather() {
  state.weatherEnabled = !state.weatherEnabled;
  ui.weatherButton.textContent = state.weatherEnabled ? "Aus" : "Laden";
  ui.weatherButton.classList.toggle("is-active", state.weatherEnabled);
  ui.weatherStatus.textContent = state.weatherEnabled
    ? "Lade Open-Meteo fuer sichtbare L10-Zellen ..."
    : "Open-Meteo-Daten sind aus";
  scheduleRender();
}

function fetchWeatherForCells(cells) {
  const missing = cells
    .filter((cell) => !state.weather.has(cellKey(cell)) && !state.weatherPending.has(cellKey(cell)))
    .slice(0, 18);

  const loaded = cells.filter((cell) => state.weather.has(cellKey(cell))).length;
  const pending = state.weatherPending.size;

  if (!missing.length) {
    ui.weatherStatus.textContent = loaded
      ? `${loaded} Wetterzellen geladen`
      : pending
        ? `${pending} Wetterzellen werden geladen ...`
        : "Keine neuen Wetterzellen sichtbar";
    return;
  }

  ui.weatherStatus.textContent = `${loaded} geladen, ${missing.length} neue Abfragen ...`;
  missing.forEach((cell) => fetchWeatherForCell(cell));
}

async function fetchWeatherForCell(cell) {
  const key = cellKey(cell);
  state.weatherPending.add(key);

  try {
    const [lat, lng] = cellCenter(cell.face, cell.i, cell.j, cell.level);
    const response = await fetch(`/api/weather?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`);
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      data = { message: "Wetter-API ist lokal nicht aktiv oder noch nicht deployed." };
    }

    if (!response.ok) {
      throw new Error(data.message || "Wetterdaten konnten nicht geladen werden.");
    }

    state.weather.set(key, data);
    ui.weatherStatus.textContent = `${state.weather.size} Wetterzellen geladen`;
  } catch (error) {
    ui.weatherStatus.textContent = error.message;
  } finally {
    state.weatherPending.delete(key);
    scheduleRender();
  }
}

function buildTooltip(layer, cell, weather) {
  const lines = [`${layer.title}`, `Face ${cell.face}, i ${cell.i}, j ${cell.j}`];
  if (weather) {
    lines.push(
      `${weather.provider}: ${weather.weatherText}`,
      `Wetterboost-Naeherung: ${weather.pokemonWeather.label}`,
      `Boost: ${formatBoostedTypes(weather)}`,
      `Temp: ${formatValue(weather.temperatureC, "°C")} · Wind: ${formatValue(weather.windKmh, "km/h")}`,
      `Ort: ${weather.location.name}`,
    );
  }
  return lines.join("<br>");
}

function buildLabel(layer, weather) {
  if (!weather) return `<span class="s2-label">L${layer.level}</span>`;
  return `<span class="s2-label is-weather" style="background:${weather.pokemonWeather.color}">${weather.pokemonWeather.label}</span>`;
}

function formatBoostedTypes(weather) {
  const types = weather && weather.pokemonWeather && Array.isArray(weather.pokemonWeather.boostedTypes)
    ? weather.pokemonWeather.boostedTypes
    : [];
  return types.length ? types.join(", ") : "-";
}

function formatValue(value, unit) {
  return Number.isFinite(value) ? `${Math.round(value)} ${unit}` : "-";
}

function cellKey(cell) {
  return `${cell.face}:${cell.i}:${cell.j}:${cell.level}`;
}

function gridWeight(level, zoom) {
  const levelWeight = {
    10: 3,
    14: 1.25,
    17: 0.65,
  };
  const base = levelWeight[level] || Math.max(0.6, 3.2 - (level - 10) * 0.26);
  const zoomTrim = Math.max(0, Math.min(base * 0.22, (zoom - 10) * 0.055));
  return Math.max(0.45, base - zoomTrim);
}

function collectVisibleCells(level) {
  const bounds = map.getBounds().pad(0.08);
  const zoom = map.getZoom();
  const sampleCount = Math.max(5, Math.min(44, Math.ceil((level - zoom + 8) * 4)));
  const cells = new Map();
  const latStep = (bounds.getNorth() - bounds.getSouth()) / sampleCount;
  const lngStep = (bounds.getEast() - bounds.getWest()) / sampleCount;
  const radius = level >= 17 ? 2 : 1;

  for (let y = 0; y <= sampleCount; y += 1) {
    for (let x = 0; x <= sampleCount; x += 1) {
      const lat = bounds.getSouth() + latStep * y;
      const lng = bounds.getWest() + lngStep * x;
      const base = latLngToCell(lat, lng, level);
      for (let di = -radius; di <= radius; di += 1) {
        for (let dj = -radius; dj <= radius; dj += 1) {
          const cell = normalizeCell(base.face, base.i + di, base.j + dj, level);
          if (!cell) continue;
          const polygon = cellPolygon(cell.face, cell.i, cell.j, cell.level);
          if (!polygonTouchesBounds(polygon, bounds)) continue;
          cells.set(`${cell.face}:${cell.i}:${cell.j}:${level}`, cell);
        }
      }
    }
  }

  return Array.from(cells.values()).slice(0, 4200);
}

function shouldLabelCell(cell, level) {
  if (level >= 17) return (cell.i + cell.j) % 3 === 0;
  if (level >= 14) return (cell.i + cell.j) % 2 === 0;
  return true;
}

function polygonTouchesBounds(polygon, bounds) {
  return L.latLngBounds(polygon).intersects(bounds);
}

function visibleLabelPosition(polygon, bounds) {
  const cellBounds = L.latLngBounds(polygon);
  const south = Math.max(cellBounds.getSouth(), bounds.getSouth());
  const north = Math.min(cellBounds.getNorth(), bounds.getNorth());
  const west = Math.max(cellBounds.getWest(), bounds.getWest());
  const east = Math.min(cellBounds.getEast(), bounds.getEast());
  if (south <= north && west <= east) {
    return [(south + north) / 2, (west + east) / 2];
  }
  return cellBounds.getCenter();
}

function latLngToCell(lat, lng, level) {
  const faceUv = latLngToFaceUv(lat, lng);
  const s = uvToSt(faceUv.u);
  const t = uvToSt(faceUv.v);
  const max = 1 << level;
  return normalizeCell(faceUv.face, Math.floor(clamp(s, 0, 0.999999999) * max), Math.floor(clamp(t, 0, 0.999999999) * max), level);
}

function normalizeCell(face, i, j, level) {
  const max = 1 << level;
  if (face < 0 || face > 5 || i < 0 || j < 0 || i >= max || j >= max) return null;
  return { face, i, j, level };
}

function cellPolygon(face, i, j, level) {
  const max = 1 << level;
  return [
    stToLatLng(face, i / max, j / max),
    stToLatLng(face, (i + 1) / max, j / max),
    stToLatLng(face, (i + 1) / max, (j + 1) / max),
    stToLatLng(face, i / max, (j + 1) / max),
  ];
}

function cellCenter(face, i, j, level) {
  const max = 1 << level;
  return stToLatLng(face, (i + 0.5) / max, (j + 0.5) / max);
}

function stToLatLng(face, s, t) {
  const u = stToUv(s);
  const v = stToUv(t);
  const point = faceUvToXyz(face, u, v);
  const norm = Math.hypot(point.x, point.y, point.z);
  const lat = radiansToDegrees(Math.asin(point.z / norm));
  const lng = radiansToDegrees(Math.atan2(point.y, point.x));
  return [lat, lng];
}

function latLngToFaceUv(lat, lng) {
  const phi = degreesToRadians(lat);
  const theta = degreesToRadians(lng);
  const cosPhi = Math.cos(phi);
  const x = cosPhi * Math.cos(theta);
  const y = cosPhi * Math.sin(theta);
  const z = Math.sin(phi);
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);

  if (ax >= ay && ax >= az) {
    return x > 0 ? { face: 0, u: y / x, v: z / x } : { face: 3, u: z / x, v: y / x };
  }
  if (ay >= ax && ay >= az) {
    return y > 0 ? { face: 1, u: -x / y, v: z / y } : { face: 4, u: z / y, v: -x / y };
  }
  return z > 0 ? { face: 2, u: -x / z, v: -y / z } : { face: 5, u: -y / z, v: -x / z };
}

function faceUvToXyz(face, u, v) {
  if (face === 0) return { x: 1, y: u, z: v };
  if (face === 1) return { x: -u, y: 1, z: v };
  if (face === 2) return { x: -u, y: -v, z: 1 };
  if (face === 3) return { x: -1, y: -v, z: -u };
  if (face === 4) return { x: v, y: -1, z: -u };
  return { x: v, y: u, z: -1 };
}

function stToUv(s) {
  return s >= 0.5 ? (4 * s * s - 1) / 3 : (1 - 4 * (1 - s) * (1 - s)) / 3;
}

function uvToSt(u) {
  return u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u);
}

function locateUser(options = {}) {
  if (!navigator.geolocation) {
    ui.locationStatus.textContent = "Standort wird nicht unterstützt";
    setLocationPanelCollapsed(false);
    return;
  }
  ui.locationStatus.textContent = "Suche eigene Location ...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      moveToLocation(position.coords.latitude, position.coords.longitude, "Eigene Location");
      if (options.initial) {
        setLocationPanelCollapsed(true);
      }
    },
    (error) => {
      ui.locationStatus.textContent = geolocationErrorMessage(error);
      setLocationPanelCollapsed(false);
    },
    { enableHighAccuracy: true, timeout: 8000 },
  );
}

function geolocationErrorMessage(error) {
  if (!window.isSecureContext) {
    return "Standort braucht HTTPS. Bitte die Vercel-URL oder Home-Bildschirm-App nutzen.";
  }
  if (error && error.code === error.PERMISSION_DENIED) {
    return "Standort blockiert. Auf iPhone: Safari/Website-Einstellungen prüfen oder zum Home-Bildschirm hinzufügen.";
  }
  if (error && error.code === error.TIMEOUT) {
    return "Standort hat zu lange gedauert. Bitte erneut versuchen oder Koordinaten eingeben.";
  }
  return "Standort konnte nicht gelesen werden. Bitte Safari öffnen oder Koordinaten eingeben.";
}

function jumpToLocation() {
  if (state.locationMode === "coordinates") {
    jumpToCoordinates();
  } else {
    jumpToPlace();
  }
}

async function jumpToPlace() {
  const query = ui.locationInput.value.trim();
  if (query.length < 2) {
    ui.locationStatus.textContent = "Bitte Ort oder PLZ eingeben";
    return;
  }

  ui.locationStatus.textContent = "Suche Ort ...";
  try {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", query);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "de");
    url.searchParams.set("format", "json");

    const response = await fetch(url);
    const data = await response.json();
    const result = data.results && data.results[0];
    if (!response.ok || !result) {
      ui.locationStatus.textContent = "Ort nicht gefunden";
      return;
    }

    const label = [result.name, result.admin1, result.country].filter(Boolean).join(", ");
    moveToLocation(result.latitude, result.longitude, label);
  } catch (error) {
    ui.locationStatus.textContent = "Ortssuche konnte nicht geladen werden";
  }
}

function jumpToCoordinates() {
  const match = ui.locationInput.value.trim().match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!match) {
    ui.locationStatus.textContent = "Koordinatenformat: 48.137, 11.575";
    return;
  }
  const lat = Number(match[1].replace(",", "."));
  const lng = Number(match[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    ui.locationStatus.textContent = "Koordinaten außerhalb des gültigen Bereichs";
    return;
  }
  moveToLocation(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
}

function moveToLocation(lat, lng, label) {
  fitWeatherCellForLocation(lat, lng);
  ui.locationStatus.textContent = label;
  if (!state.locationMarker) {
    state.locationMarker = L.circleMarker([lat, lng], {
      radius: 7,
      color: "#ffffff",
      weight: 3,
      fillColor: "#0f766e",
      fillOpacity: 1,
    }).addTo(map);
  } else {
    state.locationMarker.setLatLng([lat, lng]);
  }
  state.locationMarker.bindTooltip(label, { permanent: false, direction: "top" });
}

function fitWeatherCellForLocation(lat, lng) {
  const cell = latLngToCell(lat, lng, 10);
  const polygon = cellPolygon(cell.face, cell.i, cell.j, cell.level);
  const bounds = L.latLngBounds(polygon);
  const baseZoom = map.getBoundsZoom(bounds.pad(0.04), false, [36, 120]);
  const targetZoom = Math.min(12.5, baseZoom + 0.25);

  map.setView([lat, lng], targetZoom, {
    animate: true,
  });
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
