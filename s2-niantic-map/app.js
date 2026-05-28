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

const state = {
  active: new Set(layers.filter((layer) => layer.checked).map((layer) => layer.id)),
  groups: new Map(),
  labels: new Map(),
  weather: new Map(),
  weatherPending: new Set(),
  weatherEnabled: false,
  waypointGroup: null,
  waypoints: [],
  installPrompt: null,
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
  waypointNameInput: document.querySelector("#waypointNameInput"),
  waypointTypeInput: document.querySelector("#waypointTypeInput"),
  waypointAreaInput: document.querySelector("#waypointAreaInput"),
  waypointPasteInput: document.querySelector("#waypointPasteInput"),
  waypointStatus: document.querySelector("#waypointStatus"),
  waypointList: document.querySelector("#waypointList"),
  addWaypointButton: document.querySelector("#addWaypointButton"),
  addWaypointHereButton: document.querySelector("#addWaypointHereButton"),
  exportWaypointsButton: document.querySelector("#exportWaypointsButton"),
  clearWaypointsButton: document.querySelector("#clearWaypointsButton"),
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
ui.weatherButton.addEventListener("click", toggleWeather);
ui.addWaypointButton.addEventListener("click", addWaypointFromForm);
ui.addWaypointHereButton.addEventListener("click", addWaypointAtCenter);
ui.exportWaypointsButton.addEventListener("click", exportWaypoints);
ui.clearWaypointsButton.addEventListener("click", clearWaypoints);
ui.helpToggle.addEventListener("click", () => setHelpPanelCollapsed(!ui.helpPanel.classList.contains("is-collapsed")));
ui.closeHelpPanel.addEventListener("click", () => setHelpPanelCollapsed(true));
ui.brandButton.addEventListener("click", () => setAboutPanelCollapsed(!ui.aboutPanel.classList.contains("is-collapsed")));
ui.brandButton.addEventListener("mouseenter", () => setAboutPanelCollapsed(false));
ui.closeAboutPanel.addEventListener("click", () => setAboutPanelCollapsed(true));
ui.installButton.addEventListener("click", installApp);
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

function addWaypointFromForm() {
  const coordinates = parseCoordinates(ui.waypointPasteInput.value);
  if (!coordinates) {
    ui.waypointStatus.textContent = "Keine Koordinaten erkannt. Beispiel: 50,04079° N, 8,43239° O";
    ui.waypointPasteInput.focus();
    return;
  }
  const name = ui.waypointNameInput.value.trim() || "Eigener Waypoint";
  addWaypoint(name, coordinates.lat, coordinates.lng, waypointFormMeta());
  ui.waypointNameInput.value = "";
  ui.waypointPasteInput.value = "";
}

function addWaypointAtCenter() {
  const center = map.getCenter();
  const name = ui.waypointNameInput.value.trim() || "Waypoint Kartenmitte";
  addWaypoint(name, center.lat, center.lng, waypointFormMeta());
  ui.waypointNameInput.value = "";
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
  ui.waypointList.textContent = "";

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
    const plausibility = gymPlausibilityForWaypoint(waypoint);

    const marker = L.circleMarker([waypoint.lat, waypoint.lng], {
      radius: waypoint.type === "arena" ? 10 : 8,
      color: "#ffffff",
      weight: 3,
      fillColor: waypointMarkerColor(waypoint, inactive),
      fillOpacity: inactive ? 0.42 : 1,
      opacity: inactive ? 0.55 : 1,
    });
    marker
      .bindTooltip(`${waypoint.name} · ${waypoint.type === "arena" ? "Arena" : "Stop"}`, {
        sticky: true,
        direction: "top",
      })
      .bindPopup(waypointPopupHtml(waypoint, s14Key, s17Key, hasS17Duplicates, inactive, plausibility))
      .on("popupopen", () => wireWaypointPopup(marker, waypoint.id))
      .addTo(state.waypointGroup);

    ui.waypointList.appendChild(createWaypointListItem(waypoint, s17Key, hasS17Duplicates, inactive, plausibility));
  });
}

function createWaypointListItem(waypoint, s17Key, hasS17Duplicates, inactive, plausibility) {
  const item = document.createElement("article");
  item.className = "waypoint-item";
  if (hasS17Duplicates) item.classList.add("has-conflict");
  if (inactive) item.classList.add("is-inactive");
  if (waypoint.type === "arena") item.classList.add("is-arena");

  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${waypoint.name} · ${waypoint.type === "arena" ? "Arena" : "Stop"}`;
  const meta = document.createElement("span");
  meta.textContent = `${waypoint.lat.toFixed(5)}, ${waypoint.lng.toFixed(5)} · S17 ${shortCellKey(s17Key)}`;
  const note = document.createElement("em");
  note.textContent = inactive ? "Inaktiv in S17" : hasS17Duplicates ? "Aktiv in S17" : "S17 frei";
  const plausibilityText = document.createElement("span");
  plausibilityText.textContent = plausibility;
  text.append(title, meta, note, plausibilityText);

  const actions = document.createElement("div");
  if (hasS17Duplicates && !waypoint.active) {
    const active = document.createElement("button");
    active.type = "button";
    active.textContent = "Aktiv";
    active.addEventListener("click", () => setActiveWaypoint(waypoint.id));
    actions.append(active);
  }
  const focus = document.createElement("button");
  focus.type = "button";
  focus.textContent = "Fokus";
  focus.addEventListener("click", () => moveToLocation(waypoint.lat, waypoint.lng, waypoint.name));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `${waypoint.name} löschen`);
  remove.addEventListener("click", () => removeWaypoint(waypoint.id));
  actions.append(focus, remove);

  item.append(text, actions);
  return item;
}

function waypointPopupHtml(waypoint, s14Key, s17Key, hasS17Duplicates, inactive, plausibility) {
  const stateText = hasS17Duplicates
    ? waypoint.active
      ? "Aktiver Eintrag in dieser S17-Zelle"
      : "Inaktiv: anderer Eintrag in dieser S17-Zelle ist aktiv"
    : "S17-Zelle ist in deiner Liste frei";
  return `
    <div class="waypoint-popup">
      <strong>${escapeHtml(waypoint.name)}</strong>
      <span>${waypoint.type === "arena" ? "Arena" : "Stop"} · ${waypoint.lat.toFixed(5)}, ${waypoint.lng.toFixed(5)}</span>
      <span>S14: ${escapeHtml(s14Key)}</span>
      <span>S17: ${escapeHtml(s17Key)}</span>
      <em>${escapeHtml(stateText)}</em>
      <span>${escapeHtml(plausibility)}</span>
      <div>
        <button type="button" data-waypoint-action="focus">Fokus</button>
        <button type="button" data-waypoint-action="move">Auf Kartenmitte verschieben</button>
        <button type="button" data-waypoint-action="delete">Löschen</button>
      </div>
    </div>
  `;
}

function wireWaypointPopup(marker, id) {
  const popup = marker.getPopup();
  const root = popup && popup.getElement();
  if (!root) return;
  root.querySelectorAll("[data-waypoint-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-waypoint-action");
      if (action === "focus") focusWaypoint(id);
      if (action === "move") moveWaypointToCenter(id);
      if (action === "delete") {
        removeWaypoint(id);
        map.closePopup();
      }
    });
  });
}

function focusWaypoint(id) {
  const waypoint = state.waypoints.find((entry) => entry.id === id);
  if (!waypoint) return;
  moveToLocation(waypoint.lat, waypoint.lng, waypoint.name, { level: 14 });
}

function moveWaypointToCenter(id) {
  const waypoint = state.waypoints.find((entry) => entry.id === id);
  if (!waypoint) return;
  const center = map.getCenter();
  waypoint.lat = center.lat;
  waypoint.lng = center.lng;
  enforceActiveWaypoints();
  saveWaypoints();
  renderWaypoints();
  moveToLocation(waypoint.lat, waypoint.lng, waypoint.name, { level: 14 });
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

function gymPlausibilityForWaypoint(waypoint) {
  const s14Key = cellKey(latLngToCell(waypoint.lat, waypoint.lng, 14));
  const s14Waypoints = groupWaypointsByCell(14, true).get(s14Key) || [];
  const activeCount = s14Waypoints.length;
  const arenaCount = s14Waypoints.filter((entry) => entry.type === "arena").length;
  const expected = expectedGymCount(activeCount);
  const parkHint = waypoint.areaKind === "park" ? " · Park: Top-Arena-Kandidat" : "";

  if (waypoint.type === "arena") {
    if (arenaCount <= expected) return `Arena plausibel: ${arenaCount}/${expected} bei ${activeCount} aktiven POI${parkHint}`;
    return `Arena über Schwellenheuristik: ${arenaCount}/${expected} bei ${activeCount} aktiven POI${parkHint}`;
  }

  const next = nextGymThreshold(activeCount);
  if (!next) return `S14 wirkt voll: ${activeCount} aktive POI, bis zu ${expected} Arenen plausibel`;
  return `S14: ${activeCount} aktive POI · nächste Arena-Heuristik bei ${next}`;
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
  focusS2CellForLocation(lat, lng, options.level || 10);
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
  const padding = level >= 14 ? [42, 150] : [36, 120];
  const baseZoom = map.getBoundsZoom(bounds.pad(0.04), false, padding);
  const targetZoom = Math.min(level >= 14 ? 15 : 12.5, baseZoom + 0.25);

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
