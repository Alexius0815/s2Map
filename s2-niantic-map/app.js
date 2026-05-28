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

const WAYPOINT_STORAGE_KEY = "s2MapsWaypoints";
const LOCATION_CHOICE_STORAGE_KEY = "s2MapsLocationChoice";
const OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

let tesseractLoader = null;

const state = {
  active: new Set(layers.filter((layer) => layer.checked).map((layer) => layer.id)),
  groups: new Map(),
  labels: new Map(),
  weather: new Map(),
  weatherPending: new Set(),
  weatherFailed: new Set(),
  weatherEnabled: false,
  waypointGroup: null,
  waypoints: [],
  installPrompt: null,
  renderTimer: 0,
  collapsed: true,
  locationCollapsed: false,
  locationMode: "place",
  locationMarker: null,
  waypointPlacement: false,
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

map.createPane("waypointPane");
map.getPane("waypointPane").style.zIndex = 680;
map.getPane("waypointPane").style.pointerEvents = "auto";

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
  waypointNameInput: document.querySelector("#waypointNameInput"),
  waypointTypeInput: document.querySelector("#waypointTypeInput"),
  waypointAreaInput: document.querySelector("#waypointAreaInput"),
  waypointPasteInput: document.querySelector("#waypointPasteInput"),
  waypointStatus: document.querySelector("#waypointStatus"),
  addWaypointButton: document.querySelector("#addWaypointButton"),
  exportWaypointsButton: document.querySelector("#exportWaypointsButton"),
  importWaypointsButton: document.querySelector("#importWaypointsButton"),
  waypointImportInput: document.querySelector("#waypointImportInput"),
  clearWaypointsButton: document.querySelector("#clearWaypointsButton"),
  cellPanel: document.querySelector("#cellPanel"),
  cellPanelToggle: document.querySelector("#cellPanelToggle"),
  closeCellPanel: document.querySelector("#closeCellPanel"),
  weatherPanel: document.querySelector("#weatherPanel"),
  weatherPanelToggle: document.querySelector("#weatherPanelToggle"),
  closeWeatherPanel: document.querySelector("#closeWeatherPanel"),
  helpToggle: document.querySelector("#helpToggle"),
  helpPanel: document.querySelector("#helpPanel"),
  closeHelpPanel: document.querySelector("#closeHelpPanel"),
  brandButton: document.querySelector("#brandButton"),
  aboutPanel: document.querySelector("#aboutPanel"),
  closeAboutPanel: document.querySelector("#closeAboutPanel"),
  installButton: document.querySelector("#installButton"),
  installStatus: document.querySelector("#installStatus"),
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

state.waypointGroup = L.layerGroup().addTo(map);
loadWaypoints();

ui.panelToggle.addEventListener("click", () => setPanelCollapsed(!state.collapsed));
ui.closePanel.addEventListener("click", () => setPanelCollapsed(true));
ui.locationPanelToggle.addEventListener("click", () => setLocationPanelCollapsed(!state.locationCollapsed));
ui.closeLocationPanel.addEventListener("click", () => setLocationPanelCollapsed(true));
ui.ownLocationButton.addEventListener("click", locateUser);
ui.locationGoButton.addEventListener("click", jumpToLocation);
ui.weatherButton.addEventListener("change", toggleWeather);
ui.addWaypointButton.addEventListener("click", addWaypointFromForm);
ui.exportWaypointsButton.addEventListener("click", exportWaypoints);
ui.importWaypointsButton.addEventListener("click", () => ui.waypointImportInput.click());
ui.waypointImportInput.addEventListener("change", importWaypointsFromFile);
ui.clearWaypointsButton.addEventListener("click", clearWaypoints);
ui.cellPanelToggle.addEventListener("click", () => setCellPanelCollapsed(!ui.cellPanel.classList.contains("is-collapsed")));
ui.closeCellPanel.addEventListener("click", () => setCellPanelCollapsed(true));
ui.weatherPanelToggle.addEventListener("click", () => setWeatherPanelCollapsed(!ui.weatherPanel.classList.contains("is-collapsed")));
ui.closeWeatherPanel.addEventListener("click", () => setWeatherPanelCollapsed(true));
ui.helpToggle.addEventListener("click", () => setHelpPanelCollapsed(!ui.helpPanel.classList.contains("is-collapsed")));
ui.closeHelpPanel.addEventListener("click", () => setHelpPanelCollapsed(true));
ui.brandButton.addEventListener("click", () => setAboutPanelCollapsed(!ui.aboutPanel.classList.contains("is-collapsed")));
ui.brandButton.addEventListener("mouseenter", () => setAboutPanelCollapsed(false));
ui.closeAboutPanel.addEventListener("click", () => setAboutPanelCollapsed(true));
ui.installButton.addEventListener("click", installApp);
ui.allowLocationButton.addEventListener("click", () => {
  saveLocationChoice("use-location");
  setLocationConsentVisible(false);
  setCellPanelCollapsed(true);
  setWeatherPanelCollapsed(true);
  setPanelCollapsed(true);
  setHelpPanelCollapsed(true);
  setAboutPanelCollapsed(true);
  locateUser({ initial: true });
});
ui.skipLocationButton.addEventListener("click", () => {
  saveLocationChoice("skip-location");
  setLocationConsentVisible(false);
  setCellPanelCollapsed(true);
  setWeatherPanelCollapsed(true);
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
map.on("click", addWaypointFromMapClick);
window.addEventListener("beforeinstallprompt", handleInstallPrompt);
window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  ui.installButton.classList.add("is-hidden");
  ui.installStatus.textContent = "App ist installiert.";
});
registerServiceWorker();
updateInstallHelp();
scheduleRender();
window.setTimeout(requestInitialLocation, 300);
window.setTimeout(focusActiveS14Cell, 1200);

function setPanelCollapsed(collapsed) {
  state.collapsed = collapsed;
  ui.panel.classList.toggle("is-collapsed", collapsed);
  ui.panelToggle.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) {
    setCellPanelCollapsed(true);
    setWeatherPanelCollapsed(true);
    setHelpPanelCollapsed(true);
    setAboutPanelCollapsed(true);
  }
}

function setCellPanelCollapsed(collapsed) {
  ui.cellPanel.classList.toggle("is-collapsed", collapsed);
  ui.cellPanelToggle.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) {
    setWeatherPanelCollapsed(true);
    setPanelCollapsed(true);
    setHelpPanelCollapsed(true);
    setAboutPanelCollapsed(true);
  }
}

function setWeatherPanelCollapsed(collapsed) {
  ui.weatherPanel.classList.toggle("is-collapsed", collapsed);
  ui.weatherPanelToggle.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) {
    setCellPanelCollapsed(true);
    setPanelCollapsed(true);
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
    setCellPanelCollapsed(true);
    setWeatherPanelCollapsed(true);
    setAboutPanelCollapsed(true);
  }
}

function setAboutPanelCollapsed(collapsed) {
  ui.aboutPanel.classList.toggle("is-collapsed", collapsed);
  ui.brandButton.setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) {
    setCellPanelCollapsed(true);
    setWeatherPanelCollapsed(true);
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
  const locationChoice = loadLocationChoice();
  if (locationChoice === "use-location") {
    setLocationConsentVisible(false);
    locateUser({ initial: true });
    return;
  }
  if (locationChoice === "skip-location") {
    setLocationConsentVisible(false);
    return;
  }
  setLocationConsentVisible(true);
}

function saveLocationChoice(choice) {
  try {
    localStorage.setItem(LOCATION_CHOICE_STORAGE_KEY, choice);
  } catch {
    // Standortwahl ist Komfortzustand; ohne Storage bleibt die App nutzbar.
  }
}

function loadLocationChoice() {
  try {
    return localStorage.getItem(LOCATION_CHOICE_STORAGE_KEY);
  } catch {
    return null;
  }
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
  const occupiedStopS17Keys = occupiedS17StopKeys();

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
      const key = cellKey(cell);
      const hasStop = layer.id === "stop" && occupiedStopS17Keys.has(key);
      const weatherColor = weather && weather.pokemonWeather ? weather.pokemonWeather.color : layer.color;
      const polygon = cellPolygon(cell.face, cell.i, cell.j, cell.level);
      const lineWeight = gridWeight(layer.level, zoom);
      const leafletPolygon = L.polygon(polygon, {
        color: weatherColor,
        weight: lineWeight,
        opacity: 0.9,
        fillColor: hasStop ? "#475569" : weatherColor,
        fillOpacity: hasStop ? 0.2 : layer.id === "weather" ? 0.04 : 0,
        interactive: true,
      }).bindTooltip(buildTooltip(layer, cell, weather), {
        sticky: true,
        direction: "top",
      });
      if (layer.id === "gym") {
        wireS14CellPopup(leafletPolygon, cell, lineWeight);
      }
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

function occupiedS17StopKeys() {
  return new Set(
    state.waypoints
      .filter((waypoint) => waypoint.active && waypoint.type === "stop")
      .map((waypoint) => cellKey(latLngToCell(waypoint.lat, waypoint.lng, 17))),
  );
}

function wireS14CellPopup(polygon, cell, lineWeight) {
  const openInfo = () => {
    polygon.setPopupContent(s14CellPopupHtml(cell));
    polygon.openPopup();
  };

  polygon.bindPopup(s14CellPopupHtml(cell), {
    className: "s14-cell-popup-wrapper",
    closeButton: true,
    autoPanPadding: [18, 18],
  });
  polygon.on("mouseover", () => polygon.setStyle({ weight: lineWeight + 2.4, opacity: 1 }));
  polygon.on("mouseout", () => polygon.setStyle({ weight: lineWeight, opacity: 0.9 }));
  polygon.on("touchstart", () => polygon.setStyle({ weight: lineWeight + 2.4, opacity: 1 }));
  polygon.on("click", openInfo);
  polygon.on("dblclick", openInfo);
  polygon.on("popupclose", () => polygon.setStyle({ weight: lineWeight, opacity: 0.9 }));
}

function toggleWeather() {
  state.weatherEnabled = ui.weatherButton.checked;
  if (state.weatherEnabled) {
    state.weatherFailed.clear();
  }
  ui.weatherStatus.textContent = state.weatherEnabled
    ? `An · ${weatherSourceText()}`
    : `Aus · ${weatherSourceText()}`;
  scheduleRender();
}

function weatherSourceText() {
  return "Quelle: Open-Meteo über den eigenen API-Proxy";
}

function fetchWeatherForCells(cells) {
  const missing = cells
    .filter((cell) => {
      const key = cellKey(cell);
      return !state.weather.has(key) && !state.weatherPending.has(key) && !state.weatherFailed.has(key);
    })
    .slice(0, 18);

  const loaded = cells.filter((cell) => state.weather.has(cellKey(cell))).length;
  const failed = cells.filter((cell) => state.weatherFailed.has(cellKey(cell))).length;
  const pending = state.weatherPending.size;

  if (!missing.length) {
    ui.weatherStatus.textContent = loaded
      ? `${loaded} Wetterzellen geladen · ${weatherSourceText()}`
      : pending
        ? `${pending} Wetterzellen werden geladen · ${weatherSourceText()}`
        : failed
          ? `Wetterdaten nicht erreichbar · ${weatherSourceText()}`
          : `Keine neuen Wetterzellen sichtbar · ${weatherSourceText()}`;
    return;
  }

  ui.weatherStatus.textContent = `${loaded} geladen, ${missing.length} neue Abfragen · ${weatherSourceText()}`;
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
    ui.weatherStatus.textContent = `${state.weather.size} Wetterzellen geladen · ${weatherSourceText()}`;
  } catch (error) {
    state.weatherFailed.add(key);
    ui.weatherStatus.textContent = `${error.message} · ${weatherSourceText()}`;
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

function loadWaypoints() {
  try {
    const raw = localStorage.getItem(WAYPOINT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    state.waypoints = Array.isArray(parsed) ? parsed.filter(isValidWaypoint).map(normalizeWaypoint) : [];
  } catch {
    state.waypoints = [];
  }
  enforceActiveWaypoints();
  renderWaypoints();
}

function saveWaypoints() {
  try {
    localStorage.setItem(WAYPOINT_STORAGE_KEY, JSON.stringify(state.waypoints));
  } catch {
    ui.waypointStatus.textContent = "Waypoints konnten nicht lokal gespeichert werden.";
  }
}

function isValidWaypoint(waypoint) {
  return waypoint && typeof waypoint.name === "string" && Number.isFinite(waypoint.lat) && Number.isFinite(waypoint.lng);
}

function normalizeWaypoint(waypoint) {
  return {
    id: waypoint.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: waypoint.name,
    lat: waypoint.lat,
    lng: waypoint.lng,
    type: waypoint.type === "arena" ? "arena" : "stop",
    areaKind: ["park", "sponsor", "unclear"].includes(waypoint.areaKind) ? waypoint.areaKind : "normal",
    active: waypoint.active !== false,
    createdAt: waypoint.createdAt || new Date().toISOString(),
  };
}

async function addWaypointFromForm() {
  const input = ui.waypointPasteInput.value;
  ui.waypointStatus.textContent = "Waypoint wird gelesen ...";

  const draft = await parseWaypointInput(input);
  if (!draft) {
    startWaypointPlacement();
    return;
  }

  const name = ui.waypointNameInput.value.trim() || draft.name || "Eigener Waypoint";
  addWaypoint(name, draft.coordinates.lat, draft.coordinates.lng, waypointFormMeta());
  ui.waypointNameInput.value = "";
  ui.waypointPasteInput.value = "";
}

function startWaypointPlacement() {
  state.waypointPlacement = true;
  map.getContainer().classList.add("is-placing-waypoint");
  ui.addWaypointButton.textContent = "Auf Karte tippen";
  ui.waypointStatus.textContent = "Tippe auf die Karte, um den Waypoint zu setzen.";
}

function stopWaypointPlacement() {
  state.waypointPlacement = false;
  map.getContainer().classList.remove("is-placing-waypoint");
  ui.addWaypointButton.textContent = "Waypoint hinzufügen";
}

function addWaypointFromMapClick(event) {
  if (!state.waypointPlacement) return;
  L.DomEvent.stop(event);
  const name = ui.waypointNameInput.value.trim() || "Eigener Waypoint";
  stopWaypointPlacement();
  addWaypoint(name, event.latlng.lat, event.latlng.lng, waypointFormMeta());
  ui.waypointNameInput.value = "";
  ui.waypointPasteInput.value = "";
}

function waypointFormMeta() {
  return {
    type: ui.waypointTypeInput.value === "arena" ? "arena" : "stop",
    areaKind: ui.waypointAreaInput.value,
  };
}

function addWaypoint(name, lat, lng, meta = {}) {
  const s17Key = cellKey(latLngToCell(lat, lng, 17));
  const hasActiveInCell = state.waypoints.some((waypoint) => waypoint.active && cellKey(latLngToCell(waypoint.lat, waypoint.lng, 17)) === s17Key);
  const waypoint = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    lat,
    lng,
    type: meta.type === "arena" ? "arena" : "stop",
    areaKind: ["park", "sponsor", "unclear"].includes(meta.areaKind) ? meta.areaKind : "normal",
    active: !hasActiveInCell,
    createdAt: new Date().toISOString(),
  };
  state.waypoints.push(waypoint);
  enforceActiveWaypoints();
  saveWaypoints();
  renderWaypoints();
  moveToLocation(lat, lng, name);
  ui.waypointStatus.textContent = `${state.waypoints.length} eigene Waypoints gespeichert`;
}

function removeWaypoint(id) {
  state.waypoints = state.waypoints.filter((waypoint) => waypoint.id !== id);
  enforceActiveWaypoints();
  saveWaypoints();
  renderWaypoints();
}

function clearWaypoints() {
  state.waypoints = [];
  saveWaypoints();
  renderWaypoints();
}

function renderWaypoints() {
  if (!state.waypointGroup) return;
  enforceActiveWaypoints();
  state.waypointGroup.clearLayers();
  scheduleRender();

  if (!state.waypoints.length) {
    ui.waypointStatus.textContent = "Noch keine eigenen Waypoints";
    return;
  }

  const s17Groups = groupWaypointsByCell(17);
  const activeWaypoints = state.waypoints.filter((waypoint) => waypoint.active);
  ui.waypointStatus.textContent = `${activeWaypoints.length}/${state.waypoints.length} aktive Waypoints`;

  state.waypoints.forEach((waypoint) => {
    const s14 = latLngToCell(waypoint.lat, waypoint.lng, 14);
    const s17 = latLngToCell(waypoint.lat, waypoint.lng, 17);
    const s14Key = cellKey(s14);
    const s17Key = cellKey(s17);
    const hasS17Duplicates = (s17Groups.get(s17Key) || []).length > 1;
    const inactive = hasS17Duplicates && !waypoint.active;

    const markerTitle = waypoint.name;
    const marker = L.marker([waypoint.lat, waypoint.lng], {
      pane: "waypointPane",
      icon: waypointIcon(waypoint, inactive),
      interactive: true,
      title: markerTitle,
      alt: markerTitle,
      keyboard: true,
      draggable: true,
    });
    marker
      .bindTooltip(markerTitle, {
        sticky: true,
        direction: "top",
        className: "waypoint-tooltip",
      })
      .on("mouseover", () => marker.openTooltip())
      .on("focus", () => marker.openTooltip())
      .on("touchstart", () => marker.openTooltip())
      .on("dragend", (event) => moveWaypointToLatLng(waypoint.id, event.target.getLatLng()))
      .bindPopup(waypointPopupHtml(waypoint))
      .on("popupopen", () => {
        marker.closeTooltip();
        wireWaypointPopup(marker, waypoint.id);
      })
      .addTo(state.waypointGroup);
  });
}

function waypointIcon(waypoint, inactive) {
  const typeClass = waypoint.type === "arena" ? "is-arena" : "is-stop";
  const inactiveClass = inactive ? " is-inactive" : "";
  const label = waypoint.type === "arena" ? "A" : "S";
  return L.divIcon({
    className: "",
    html: `<span class="waypoint-marker ${typeClass}${inactiveClass}" aria-hidden="true">${label}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
    tooltipAnchor: [0, -18],
  });
}

function waypointPopupHtml(waypoint) {
  const isStop = waypoint.type !== "arena";
  return `
    <div class="waypoint-popup">
      <label class="waypoint-name-field">
        <input type="text" value="${escapeHtml(waypoint.name)}" data-waypoint-name data-original-name="${escapeHtml(waypoint.name)}" />
      </label>
      <div class="waypoint-type-toggle" role="group" aria-label="Waypoint-Typ">
        <label>
          <input type="radio" name="waypoint-type-${escapeHtml(waypoint.id)}" value="stop" data-waypoint-type data-original-type="${escapeHtml(waypoint.type)}" ${isStop ? "checked" : ""} />
          <span>Stop</span>
        </label>
        <label>
          <input type="radio" name="waypoint-type-${escapeHtml(waypoint.id)}" value="arena" data-waypoint-type data-original-type="${escapeHtml(waypoint.type)}" ${!isStop ? "checked" : ""} />
          <span>Arena</span>
        </label>
      </div>
      <div class="waypoint-popup-actions">
        <button type="button" data-waypoint-action="save" hidden>Speichern</button>
        <button type="button" data-waypoint-action="focus">Fokus</button>
        <button type="button" data-waypoint-action="delete">Löschen</button>
      </div>
    </div>
  `;
}

function wireWaypointPopup(marker, id) {
  const popup = marker.getPopup();
  const root = popup && popup.getElement();
  if (!root) return;
  const nameInput = root.querySelector("[data-waypoint-name]");
  const typeInputs = Array.from(root.querySelectorAll("[data-waypoint-type]"));
  const saveButton = root.querySelector('[data-waypoint-action="save"]');
  const updateSaveButton = () => {
    if (!nameInput || !saveButton) return;
    const originalName = nameInput.getAttribute("data-original-name");
    const originalType = typeInputs[0] ? typeInputs[0].getAttribute("data-original-type") : "";
    const selectedType = selectedWaypointType(root);
    saveButton.hidden = nameInput.value.trim() === originalName && selectedType === originalType;
  };
  if (nameInput) nameInput.addEventListener("input", updateSaveButton);
  typeInputs.forEach((input) => input.addEventListener("change", updateSaveButton));
  root.querySelectorAll("[data-waypoint-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-waypoint-action");
      if (action === "save") saveWaypointFromPopup(id, root);
      if (action === "focus") focusWaypoint(id);
      if (action === "delete") {
        removeWaypoint(id);
        map.closePopup();
      }
    });
  });
}

function selectedWaypointType(root) {
  const selected = root.querySelector("[data-waypoint-type]:checked");
  return selected && selected.value === "arena" ? "arena" : "stop";
}

function saveWaypointFromPopup(id, root) {
  const input = root.querySelector("[data-waypoint-name]");
  const name = input ? input.value.trim() : "";
  if (!name) {
    ui.waypointStatus.textContent = "Name darf nicht leer sein.";
    return;
  }
  const waypoint = state.waypoints.find((entry) => entry.id === id);
  if (!waypoint) return;
  waypoint.name = name;
  waypoint.type = selectedWaypointType(root);
  enforceActiveWaypoints();
  saveWaypoints();
  renderWaypoints();
  ui.waypointStatus.textContent = `Waypoint gespeichert: ${name}`;
}

function focusWaypoint(id) {
  const waypoint = state.waypoints.find((entry) => entry.id === id);
  if (!waypoint) return;
  moveToLocation(waypoint.lat, waypoint.lng, waypoint.name, { level: 14 });
}

function moveWaypointToLatLng(id, latLng, options = {}) {
  const waypoint = state.waypoints.find((entry) => entry.id === id);
  if (!waypoint) return;
  const center = L.latLng(latLng);
  waypoint.lat = center.lat;
  waypoint.lng = center.lng;
  enforceActiveWaypoints();
  saveWaypoints();
  renderWaypoints();
  if (options.focus) moveToLocation(waypoint.lat, waypoint.lng, waypoint.name, { level: 14 });
  ui.waypointStatus.textContent = `${waypoint.name} verschoben`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setActiveWaypoint(id) {
  const selected = state.waypoints.find((waypoint) => waypoint.id === id);
  if (!selected) return;
  const selectedS17 = cellKey(latLngToCell(selected.lat, selected.lng, 17));
  state.waypoints.forEach((waypoint) => {
    if (cellKey(latLngToCell(waypoint.lat, waypoint.lng, 17)) === selectedS17) {
      waypoint.active = waypoint.id === id;
    }
  });
  saveWaypoints();
  renderWaypoints();
}

function enforceActiveWaypoints() {
  const groups = groupWaypointsByCell(17);
  groups.forEach((waypoints) => {
    if (waypoints.length === 1) {
      waypoints[0].active = true;
      return;
    }
    const active = waypoints.find((waypoint) => waypoint.active) || waypoints[0];
    waypoints.forEach((waypoint) => {
      waypoint.active = waypoint.id === active.id;
    });
  });
}

function groupWaypointsByCell(level, onlyActive = false) {
  const groups = new Map();
  state.waypoints
    .filter((waypoint) => !onlyActive || waypoint.active)
    .forEach((waypoint) => {
      const key = cellKey(latLngToCell(waypoint.lat, waypoint.lng, level));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(waypoint);
    });
  return groups;
}

function waypointMarkerColor(waypoint, inactive) {
  if (inactive) return "#94a3b8";
  return waypoint.type === "arena" ? "#ef3b78" : "#1d8cf8";
}

function s14CellPopupHtml(cell) {
  const key = cellKey(cell);
  const validation = s14GymValidationForCell(key);
  const statusLabel = {
    empty: "Keine aktiven POI",
    next: "Nächster Kipppunkt",
    near: "Kipppunkt nah",
    ok: "Plausibel",
    full: "S14 voll",
    over: "Zu viele Arenen",
  }[validation.status] || "S14-Info";

  return `
    <div class="s14-cell-popup is-${escapeHtml(validation.status)}">
      <div>
        <strong>S14 ${escapeHtml(shortCellKey(key))}</strong>
        <span>${escapeHtml(statusLabel)}</span>
      </div>
      <p>${escapeHtml(validation.text)}</p>
      <dl>
        <div><dt>Aktive POI</dt><dd>${validation.activeCount}</dd></div>
        <div><dt>Arenen</dt><dd>${validation.arenaCount}/${validation.expected}</dd></div>
        <div><dt>Nächste Arena</dt><dd>${validation.next ? `${validation.missing} bis ${validation.next}` : "-"}</dd></div>
      </dl>
    </div>
  `;
}

function s14GymValidationForCell(s14Key) {
  const s14Waypoints = groupWaypointsByCell(14, true).get(s14Key) || [];
  const activeCount = s14Waypoints.length;
  const arenaCount = s14Waypoints.filter((entry) => entry.type === "arena").length;
  const expected = expectedGymCount(activeCount);
  const next = nextGymThreshold(activeCount);
  const missing = next ? Math.max(0, next - activeCount) : 0;

  if (!activeCount) {
    return {
      status: "empty",
      text: "In dieser S14-Zelle sind noch keine aktiven Waypoints erfasst.",
      activeCount,
      arenaCount,
      expected,
      next,
      missing,
    };
  }

  if (arenaCount > expected) {
    return {
      status: "over",
      text: `Zu viele Arenen nach Heuristik: ${arenaCount}/${expected} bei ${activeCount} aktiven POI.`,
      activeCount,
      arenaCount,
      expected,
      next,
      missing,
    };
  }

  if (!next) {
    return {
      status: "full",
      text: `S14 wirkt voll: ${activeCount} aktive POI, bis zu ${expected} Arenen plausibel.`,
      activeCount,
      arenaCount,
      expected,
      next,
      missing,
    };
  }

  if (missing === 1) {
    return {
      status: "near",
      text: `Kipppunkt nah: 1 weiterer aktiver POI bis zur nächsten Arena-Schwelle bei ${next}.`,
      activeCount,
      arenaCount,
      expected,
      next,
      missing,
    };
  }

  return {
    status: "next",
    text: `Nächste Arena-Schwelle bei ${next} aktiven POI. Es fehlen noch ${missing}.`,
    activeCount,
    arenaCount,
    expected,
    next,
    missing,
  };
}

function s14GymValidationForWaypoint(waypoint) {
  const s14Key = cellKey(latLngToCell(waypoint.lat, waypoint.lng, 14));
  const validation = s14GymValidationForCell(s14Key);
  const { activeCount, arenaCount, expected, next, missing } = validation;
  const parkHint = waypoint.areaKind === "park" ? " · Park: guter Kandidat" : "";

  if (arenaCount > expected) {
    return {
      status: "over",
      text: `Zu viele Arenen: ${arenaCount}/${expected} bei ${activeCount} POI${parkHint}`,
    };
  }

  if (waypoint.type === "arena") {
    return {
      status: "ok",
      text: `Arena plausibel: ${arenaCount}/${expected} bei ${activeCount} POI${parkHint}`,
    };
  }

  if (!next) {
    return {
      status: "full",
      text: `S14 voll: ${activeCount} POI · bis ${expected} Arenen plausibel`,
    };
  }

  if (missing === 1) {
    return {
      status: "near",
      text: `Kipppunkt nah: 1 POI bis Arena ${expected + 1} (${activeCount}/${next})`,
    };
  }

  return {
    status: "next",
    text: `Nächste Arena: noch ${missing} POI bis ${next} (${arenaCount}/${expected})`,
  };
}

function gymPlausibilityForWaypoint(waypoint) {
  return s14GymValidationForWaypoint(waypoint).text;
}

function expectedGymCount(activeCount) {
  if (activeCount >= 20) return 3;
  if (activeCount >= 6) return 2;
  if (activeCount >= 2) return 1;
  return 0;
}

function nextGymThreshold(activeCount) {
  if (activeCount < 2) return 2;
  if (activeCount < 6) return 6;
  if (activeCount < 20) return 20;
  return null;
}

function exportWaypoints() {
  if (!state.waypoints.length) {
    ui.waypointStatus.textContent = "Keine Waypoints zum Exportieren.";
    return;
  }
  enforceActiveWaypoints();
  const rows = [
    ["name", "type", "area", "active", "lat", "lng", "s14", "s17", "plausibility"],
    ...state.waypoints.map((waypoint) => [
      waypoint.name,
      waypoint.type,
      waypoint.areaKind,
      waypoint.active ? "yes" : "no",
      waypoint.lat.toFixed(6),
      waypoint.lng.toFixed(6),
      cellKey(latLngToCell(waypoint.lat, waypoint.lng, 14)),
      cellKey(latLngToCell(waypoint.lat, waypoint.lng, 17)),
      gymPlausibilityForWaypoint(waypoint),
    ]),
  ];
  const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `s2-waypoints-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  ui.waypointStatus.textContent = `${state.waypoints.length} Waypoints exportiert`;
}

async function importWaypointsFromFile(event) {
  const [file] = Array.from(event.target.files || []);
  if (!file) return;

  try {
    const isImage = isImageImportFile(file);
    ui.waypointStatus.textContent = isImage
      ? "Screenshot wird gelesen ..."
      : "Import wird gelesen ...";
    await yieldToBrowser();

    const text = isImage ? await textFromImageFile(file) : await file.text();
    const imported = parseWaypointImport(text, file.name);
    if (!imported.length) {
      ui.waypointStatus.textContent = isImage
        ? "Bildimport: Name und Koordinaten wurden nicht sicher erkannt."
        : "Import: keine gültigen Waypoints gefunden.";
      return;
    }

    const known = new Set(state.waypoints.map(waypointIdentity));
    const additions = imported.filter((waypoint) => {
      const identity = waypointIdentity(waypoint);
      if (known.has(identity)) return false;
      known.add(identity);
      return true;
    });

    if (!additions.length) {
      ui.waypointStatus.textContent = "Import: alle Waypoints waren bereits vorhanden.";
      return;
    }

    state.waypoints.push(...additions);
    enforceActiveWaypoints();
    saveWaypoints();
    renderWaypoints();
    focusActiveS14Cell();
    ui.waypointStatus.textContent = `${additions.length} Waypoints importiert`;
  } catch (error) {
    ui.waypointStatus.textContent = error.message || "Import konnte nicht gelesen werden.";
  } finally {
    event.target.value = "";
  }
}

async function textFromImageFile(file) {
  if (isHeicFile(file)) {
    throw new Error("HEIC-Bilder kann der Browser nicht sicher lesen. Bitte den Screenshot als PNG/JPEG importieren.");
  }

  if (window.TextDetector && window.createImageBitmap) {
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new TextDetector();
      const blocks = await detector.detect(bitmap);
      bitmap.close();
      const nativeText = blocks.map((block) => block.rawValue).filter(Boolean).join("\n");
      if (nativeText.trim()) return nativeText;
    } catch (error) {
      // Fall through to Tesseract.js. Some browsers expose TextDetector but disable it.
    }
  }

  ui.waypointStatus.textContent = "OCR-Modul wird geladen ...";
  await yieldToBrowser();
  await loadTesseract();

  ui.waypointStatus.textContent = "Screenshot wird erkannt ...";
  await yieldToBrowser();
  const imageUrl = await fileToDataUrl(file);
  const result = await window.Tesseract.recognize(imageUrl, "deu+eng", {
    logger: (progress) => {
      if (progress.status !== "recognizing text" || !Number.isFinite(progress.progress)) return;
      ui.waypointStatus.textContent = `Screenshot wird erkannt ... ${Math.round(progress.progress * 100)}%`;
    },
  });

  return result && result.data ? result.data.text : "";
}

function isImageImportFile(file) {
  const name = String(file.name || "").toLowerCase();
  return String(file.type || "").startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
}

function isHeicFile(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/i.test(name);
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractLoader) {
    tesseractLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = OCR_SCRIPT_URL;
      script.async = true;
      script.onload = () => (window.Tesseract ? resolve() : reject(new Error("OCR-Modul konnte nicht gestartet werden.")));
      script.onerror = () => reject(new Error("OCR-Modul konnte nicht geladen werden. Bitte Internetverbindung prüfen."));
      document.head.appendChild(script);
    });
  }
  return tesseractLoader;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Screenshot konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function parseWaypointImport(text, fileName = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];

  if (fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonWaypoints(trimmed);
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0].toLowerCase();
  if (firstLine.includes("lat") && firstLine.includes("lng")) {
    return parseCsvWaypoints(trimmed);
  }

  const screenshotWaypoints = parseScreenshotWaypoints(trimmed);
  if (screenshotWaypoints.length) return screenshotWaypoints;

  return parseTextWaypoints(trimmed);
}

function parseJsonWaypoints(text) {
  const parsed = JSON.parse(text);
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.waypoints) ? parsed.waypoints : [];
  return entries.map(importedWaypointFromObject).filter(Boolean);
}

function parseCsvWaypoints(text) {
  const rows = parseCsvRows(text);
  const header = rows.shift() || [];
  const indexes = new Map(header.map((name, index) => [String(name).trim().toLowerCase(), index]));

  return rows
    .map((row, index) => importedWaypointFromObject({
      name: cellValue(row, indexes, "name") || `Import ${index + 1}`,
      type: cellValue(row, indexes, "type"),
      areaKind: cellValue(row, indexes, "area") || cellValue(row, indexes, "areakind"),
      active: cellValue(row, indexes, "active"),
      lat: cellValue(row, indexes, "lat"),
      lng: cellValue(row, indexes, "lng"),
    }))
    .filter(Boolean);
}

function parseTextWaypoints(text) {
  return text
    .split(/\r?\n/)
    .map((line, index) => {
      const coordinates = parseCoordinates(line);
      if (!coordinates) return null;
      const name = line
        .replace(/@?-?\d+(?:[\.,]\d+)?[^\d-]+-?\d+(?:[\.,]\d+)?.*$/, "")
        .replace(/[;,|]+$/, "")
        .trim();
      return importedWaypointFromObject({
        name: name || `Import ${index + 1}`,
        lat: coordinates.lat,
        lng: coordinates.lng,
      });
    })
    .filter(Boolean);
}

function parseScreenshotWaypoints(text) {
  const coordinates = parseCoordinates(text);
  if (!coordinates) return [];

  const name = nameFromScreenshotText(text);
  if (!name) return [];

  return [importedWaypointFromObject({
    name,
    lat: coordinates.lat,
    lng: coordinates.lng,
  })].filter(Boolean);
}

function nameFromScreenshotText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const coordinateIndex = lines.findIndex((line) => parseCoordinates(line));
  const detailsIndex = lines.findIndex((line) => /^(details|adresse|koordinaten)$/i.test(line));
  const candidates = lines
    .map((line, index) => ({ line: cleanScreenshotNameLine(line), index }))
    .filter(({ line }) => isLikelyWaypointName(line));

  const titleCandidates = candidates.filter(({ index }) => detailsIndex > 0 && index < detailsIndex);
  if (titleCandidates.length) return titleCandidates[titleCandidates.length - 1].line;

  const beforeCoordinates = candidates
    .filter(({ index }) => coordinateIndex < 0 || index < coordinateIndex)
    .pop();

  return (beforeCoordinates || candidates[0] || {}).line || "";
}

function cleanScreenshotNameLine(line) {
  return String(line || "")
    .replace(/^[^a-zäöüß]+/i, "")
    .replace(/\s+[x×✕]$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyWaypointName(line) {
  if (line.length < 3 || line.length > 70) return false;
  if (parseCoordinates(line)) return false;
  if (/^\d{5}\b/.test(line)) return false;
  if (/^\d+[:.,]\d+$/.test(line)) return false;
  if (/^\d+\s*°?$/.test(line)) return false;
  if (/^(adresse|details|koordinaten|deutschland|anpinnen|problem melden|pokémon go|pokemon go|min\.?|karte|auf karte ansehen)$/i.test(line)) return false;
  if (/^(straße|strasse|weg|platz)$/i.test(line)) return false;
  return /[a-zäöüß]/i.test(line);
}

async function parseWaypointInput(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const url = firstUrl(text);
  const directCoordinates = parseCoordinates(text);
  if (directCoordinates) {
    return {
      coordinates: directCoordinates,
      name: nameFromWaypointText(text, url),
    };
  }

  if (!url) return null;

  try {
    const response = await fetch(`/api/resolve-link?url=${encodeURIComponent(url)}`);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data && data.message ? data.message : "Link konnte nicht aufgelöst werden.");
    const coordinates = normalizeCoordinates(data.lat, data.lng);
    if (!coordinates) return null;
    return {
      coordinates,
      name: nameFromWaypointText(text, url) || data.name || "",
    };
  } catch (error) {
    ui.waypointStatus.textContent = error.message;
    return null;
  }
}

function importedWaypointFromObject(entry) {
  if (!entry) return null;
  const lat = parseCoordinateNumber(entry.lat ?? entry.latitude);
  const lng = parseCoordinateNumber(entry.lng ?? entry.lon ?? entry.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return normalizeWaypoint({
    id: entry.id,
    name: String(entry.name || entry.title || "Importierter Waypoint").trim(),
    lat,
    lng,
    type: String(entry.type || "").toLowerCase() === "arena" ? "arena" : "stop",
    areaKind: entry.areaKind || entry.area || "normal",
    active: parseImportedActive(entry.active),
    createdAt: entry.createdAt || new Date().toISOString(),
  });
}

function parseCoordinateNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  return Number(value.trim().replace(",", "."));
}

function parseImportedActive(value) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "yes").trim().toLowerCase();
  return !["false", "0", "no", "nein", "inactive", "inaktiv"].includes(text);
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function cellValue(row, indexes, key) {
  const index = indexes.get(key);
  return typeof index === "number" ? row[index] : "";
}

function waypointIdentity(waypoint) {
  return `${waypoint.name.trim().toLowerCase()}|${waypoint.lat.toFixed(6)}|${waypoint.lng.toFixed(6)}`;
}

function csvValue(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function focusActiveS14Cell() {
  const waypoint = state.waypoints.find((entry) => entry.active) || state.waypoints[0];
  if (!waypoint) return;
  focusS2CellForLocation(waypoint.lat, waypoint.lng, 14);
}

function shortCellKey(key) {
  const parts = key.split(":");
  return `${parts[0]}/${parts[1]}/${parts[2]}`;
}

function parseCoordinates(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const appleCoordinateMatch = text.match(/[?&]coordinate=(-?\d+(?:[\.,]\d+)?),\s*(-?\d+(?:[\.,]\d+)?)/);
  if (appleCoordinateMatch) return normalizeCoordinates(appleCoordinateMatch[1], appleCoordinateMatch[2]);

  const latLngParams = parseLatLngUrlParams(text);
  if (latLngParams) return latLngParams;

  const atMatch = text.match(/@(-?\d+(?:[\.,]\d+)?),\s*(-?\d+(?:[\.,]\d+)?)/);
  if (atMatch) return normalizeCoordinates(atMatch[1], atMatch[2]);

  const queryMatch = text.match(/[?&](?:q|ll|center)=(-?\d+(?:[\.,]\d+)?),\s*(-?\d+(?:[\.,]\d+)?)/);
  if (queryMatch) return normalizeCoordinates(queryMatch[1], queryMatch[2]);

  const directionalMatch = text.match(/(-?\d+(?:[\.,]\d+)?)\s*°?\s*([NS])[,;\s]+(-?\d+(?:[\.,]\d+)?)\s*°?\s*([EOW])/i);
  if (directionalMatch) {
    let lat = parseNumber(directionalMatch[1]);
    let lng = parseNumber(directionalMatch[3]);
    if (/S/i.test(directionalMatch[2])) lat *= -1;
    if (/W/i.test(directionalMatch[4])) lng *= -1;
    return validLatLng(lat, lng) ? { lat, lng } : null;
  }

  const numbers = text.match(/-?\d+(?:[\.,]\d+)?/g) || [];
  for (let index = 0; index < numbers.length - 1; index += 1) {
    const coordinates = normalizeCoordinates(numbers[index], numbers[index + 1]);
    if (coordinates) return coordinates;
  }
  return null;
}

function parseLatLngUrlParams(text) {
  const url = firstUrl(text);
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const lat = parsed.searchParams.get("lat");
    const lng = parsed.searchParams.get("lng") || parsed.searchParams.get("lon") || parsed.searchParams.get("longitude");
    return lat && lng ? normalizeCoordinates(lat, lng) : null;
  } catch (error) {
    return null;
  }
}

function firstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.;]+$/, "") : "";
}

function nameFromWaypointText(text, url) {
  return String(text || "")
    .replace(url || "", "")
    .replace(/https?:\/\/[^\s<>"']+/gi, "")
    .replace(/[;,|]+$/, "")
    .trim();
}

function normalizeCoordinates(latValue, lngValue) {
  const lat = parseNumber(latValue);
  const lng = parseNumber(lngValue);
  return validLatLng(lat, lng) ? { lat, lng } : null;
}

function parseNumber(value) {
  return Number(String(value).replace(",", "."));
}

function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
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
      moveToLocation(position.coords.latitude, position.coords.longitude, "Eigene Location", { level: 14 });
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
    return "Standort braucht HTTPS. Bitte die Vercel-URL nutzen und die App zum Home-Bildschirm hinzufügen.";
  }
  if (error && error.code === error.PERMISSION_DENIED) {
    return "Standort blockiert. Auf iPhone in Safari öffnen und „Zum Home-Bildschirm“ wählen oder Website-Einstellungen prüfen.";
  }
  if (error && error.code === error.TIMEOUT) {
    return "Standort hat zu lange gedauert. Bitte erneut versuchen oder Koordinaten eingeben.";
  }
  return "Standort konnte nicht gelesen werden. Bitte Safari öffnen oder Koordinaten eingeben.";
}

function handleInstallPrompt(event) {
  event.preventDefault();
  state.installPrompt = event;
  ui.installButton.classList.remove("is-hidden");
  ui.installStatus.textContent = "Android/Chrome: Tippe auf „App installieren“, um die Web-App zum Startbildschirm hinzuzufügen.";
}

async function installApp() {
  if (isStandaloneApp()) {
    ui.installButton.classList.add("is-hidden");
    ui.installStatus.textContent = "App ist bereits als Home-Bildschirm-App geöffnet.";
    return;
  }

  if (state.installPrompt) {
    const prompt = state.installPrompt;
    state.installPrompt = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    ui.installStatus.textContent =
      choice && choice.outcome === "accepted"
        ? "Installation gestartet."
        : "Installation abgebrochen. Du kannst sie später erneut über das Browser-Menü starten.";
    return;
  }

  updateInstallHelp();
}

function updateInstallHelp() {
  if (isStandaloneApp()) {
    ui.installButton.classList.add("is-hidden");
    ui.installStatus.textContent = "App ist bereits als Home-Bildschirm-App geöffnet.";
    return;
  }

  if (isIos()) {
    ui.installButton.textContent = "iOS-Anleitung";
    ui.installStatus.textContent = "iPhone/iPad: In Safari öffnen, Teilen-Symbol antippen und „Zum Home-Bildschirm“ wählen.";
    return;
  }

  ui.installButton.textContent = "App installieren";
  ui.installStatus.textContent = state.installPrompt
    ? "Android/Chrome: Tippe auf „App installieren“."
    : "Android: In Chrome das Menü öffnen und „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.";
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      ui.installStatus.textContent = "Installationshilfe ist verfügbar; Offline-Cache konnte nicht aktiviert werden.";
    });
  });
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

function moveToLocation(lat, lng, label, options = {}) {
  focusS2CellForLocation(lat, lng, options.level || 14);
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

function focusS2CellForLocation(lat, lng, level) {
  const cell = latLngToCell(lat, lng, level);
  const polygon = cellPolygon(cell.face, cell.i, cell.j, cell.level);
  const bounds = L.latLngBounds(polygon);
  const padding = level >= 14 ? [28, 96] : [28, 92];
  const baseZoom = map.getBoundsZoom(bounds.pad(0.02), false, padding);
  const targetZoom = Math.min(level >= 14 ? 16 : 13.25, baseZoom + 0.8);

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
