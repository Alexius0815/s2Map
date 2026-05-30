const APP_VERSION = "0.8.6";
const APP_RELEASE_DATE = "30.05.2026";
const APP_CHANGELOG = [
  {
    version: "0.8.6",
    date: "30.05.2026",
    changes: [
      "UX: Icon-Buttons im Waypoint-Panel, Touch-Targets auf 44px",
      "UX: Bottom-Buttons vereinheitlicht, Schatten reduziert",
      "UX: Schriftgewicht-Hierarchie bereinigt (700/600 statt 900/1000)",
      "UX: Impressum/Datenschutz aus Karten-Topbar entfernt",
      "UX: Leer-Zustand im Waypoint-Panel mit Illustration",
      "UX: Undo für Waypoint-Aktionen (bis 20 Schritte)",
      "UX: Waypoint-Import zeigt fehlgeschlagene Dateinamen",
      "UX: locationMode wird nach Reload gespeichert",
    ],
  },
  {
    version: "0.8.5",
    date: "30.05.2026",
    changes: [
      "Sichtrichtung per default aktiv",
      "GPS-Button springt sofort zur aktuellen Position wenn GPS läuft",
      "Standortmodus (Ort/Koordinaten) wird nach Reload gespeichert",
      "Lupe als Standortsuche-Symbol überarbeitet",
      "S14 ok-Status für plausible Arena-Zellen ergänzt",
      "Panel-Management vereinheitlicht: Panels schließen sich gegenseitig korrekt",
      "Scroll-Performance: diff-basiertes Karten-Rendering statt Komplett-Neuaufbau",
    ],
  },
  {
    version: "0.8.4",
    date: "30.05.2026",
    changes: [
      "GPS-Rückführung als eigener Navigationspfeil und Standortsuche als Lupe",
    ],
  },
  {
    version: "0.8.3",
    date: "30.05.2026",
    changes: [
      "Kartenrotation per Blickrichtung mit Kompass zum Einnorden",
    ],
  },
  {
    version: "0.8.2",
    date: "30.05.2026",
    changes: [
      "Bulk-Import für mehrere Screenshots, Bilder und Importdateien",
    ],
  },
  {
    version: "0.8.1",
    date: "29.05.2026",
    changes: [
      "S2-Zellen für Wetter, S14-Planung und S17-Waypoints",
      "Waypoint-Import, Export, Bearbeiten und lokale Speicherung",
      "GPS-Following mit 80-m-Drehradius und Blickrichtungsanzeige",
      "Wetterboost-Overlay mit reduzierter S10-Anzeige",
      "PWA-Installationshilfe, Rechtstexte und App-Info",
    ],
  },
];

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
      "Orientierung für Pokémon-GO-Wetterboosts. Eine S2-L10-Zelle deckt einen größeren Bereich ab; Wetter kann an Zellgrenzen sichtbar wechseln.",
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
      "Nützlich, um POI-Dichte in Pokémon GO einzuschätzen. Community-Planungen nutzen oft L14-Zellen für mögliche Arena-Kipppunkte.",
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
      "Feine Zellen für PokéStop- und Waypoint-Orientierung. Häufig gilt ein aktiver Wayspot pro L17-Zelle als sinnvolle Planungshilfe.",
  },
];

const WAYPOINT_STORAGE_KEY = "s2MapsWaypoints";
const LOCATION_CHOICE_STORAGE_KEY = "s2MapsLocationChoice";
const LOCATION_MODE_STORAGE_KEY = "s2MapsLocationMode";
const OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const INTERACTION_RADIUS_METERS = 80;

let tesseractLoader = null;

const state = {
  active: new Set(layers.filter((layer) => layer.checked).map((layer) => layer.id)),
  groups: new Map(),
  labels: new Map(),
  renderedCells: new Map(), // Map<layerId, Map<cellKey, {polygon, labelMarker, fingerprint}>>
  undoStack: [], // Snapshots von state.waypoints vor Mutationen

  weather: new Map(),
  weatherPending: new Set(),
  weatherFailed: new Set(),
  weatherEnabled: false,
  waypointGroup: null,
  waypointsVisible: true,
  waypoints: [],
  installPrompt: null,
  renderTimer: 0,
  collapsed: true,
  locationCollapsed: false,
  locationMode: (() => { try { return localStorage.getItem("s2MapsLocationMode") || "place"; } catch { return "place"; } })(),
  locationMarker: null,
  locationRadiusCircle: null,
  locationFollow: true,
  locationRadiusVisible: true,
  locationWatchId: null,
  locationTrackStarted: false,
  locationHeading: null,
  orientationListening: false,
  mapBearing: 0,
  mapRotationEnabled: true,
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
  mapStage: document.querySelector(".map-stage"),
  layerList: document.querySelector("#layerList"),
  layerTemplate: document.querySelector("#layerTemplate"),
  renderStatus: document.querySelector("#renderStatus"),
  panel: document.querySelector("#controlPanel"),
  panelToggle: document.querySelector("#panelToggle"),
  closePanel: document.querySelector("#closePanel"),
  locationPanel: document.querySelector(".location-panel"),
  locationPanelToggle: document.querySelector("#locationPanelToggle"),
  gpsReturnButton: document.querySelector("#gpsReturnButton"),
  closeLocationPanel: document.querySelector("#closeLocationPanel"),
  locationInput: document.querySelector("#locationInput"),
  locationGoButton: document.querySelector("#locationGoButton"),
  locationStatus: document.querySelector("#locationStatus"),
  locationModes: document.querySelectorAll("input[name='locationMode']"),
  compassButton: document.querySelector("#compassButton"),
  locationRadiusButton: document.querySelector("#locationRadiusButton"),
  weatherButton: document.querySelector("#weatherButton"),
  weatherStatus: document.querySelector("#weatherStatus"),
  waypointNameInput: document.querySelector("#waypointNameInput"),
  waypointTypeInput: document.querySelector("#waypointTypeInput"),
  waypointAreaInput: document.querySelector("#waypointAreaInput"),
  waypointPasteInput: document.querySelector("#waypointPasteInput"),
  waypointStatus: document.querySelector("#waypointStatus"),
  waypointEmptyState: document.querySelector("#waypointEmptyState"),
  addWaypointButton: document.querySelector("#addWaypointButton"),
  exportWaypointsButton: document.querySelector("#exportWaypointsButton"),
  importWaypointsButton: document.querySelector("#importWaypointsButton"),
  waypointImportInput: document.querySelector("#waypointImportInput"),
  clearWaypointsButton: document.querySelector("#clearWaypointsButton"),
  undoWaypointButton: document.querySelector("#undoWaypointButton"),
  waypointsVisibilityButton: document.querySelector("#waypointsVisibilityButton"),
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
  appVersion: document.querySelector("#appVersion"),
  appReleaseDate: document.querySelector("#appReleaseDate"),
  changelogList: document.querySelector("#changelogList"),
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
  state.renderedCells.set(layer.id, new Map());

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
  info.addEventListener("click", () => {
    const isOpen = node.classList.toggle("is-open");
    info.setAttribute("aria-expanded", String(isOpen));
  });
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
renderAppMetadata();
loadWaypoints();

ui.panelToggle.addEventListener("click", () => setPanelCollapsed(!state.collapsed));
ui.closePanel.addEventListener("click", () => setPanelCollapsed(true));
ui.locationPanelToggle.addEventListener("click", () => setLocationPanelCollapsed(!state.locationCollapsed));
ui.closeLocationPanel.addEventListener("click", () => setLocationPanelCollapsed(true));
ui.gpsReturnButton.addEventListener("click", locateUser);
ui.compassButton.addEventListener("click", resetMapBearing);
ui.locationRadiusButton.addEventListener("change", toggleLocationRadius);
ui.locationGoButton.addEventListener("click", jumpToLocation);
ui.weatherButton.addEventListener("change", toggleWeather);
ui.addWaypointButton.addEventListener("click", addWaypointFromForm);
ui.exportWaypointsButton.addEventListener("click", exportWaypoints);
ui.importWaypointsButton.addEventListener("click", () => ui.waypointImportInput.click());
ui.waypointImportInput.addEventListener("change", importWaypointsFromFile);
ui.clearWaypointsButton.addEventListener("click", clearWaypoints);
ui.undoWaypointButton.addEventListener("click", undoWaypointAction);
ui.waypointsVisibilityButton.addEventListener("change", toggleWaypointsVisibility);
ui.cellPanelToggle.addEventListener("click", () => setCellPanelCollapsed(!ui.cellPanel.classList.contains("is-collapsed")));
ui.closeCellPanel.addEventListener("click", () => setCellPanelCollapsed(true));
ui.weatherPanelToggle.addEventListener("click", () => setWeatherPanelCollapsed(!ui.weatherPanel.classList.contains("is-collapsed")));
ui.closeWeatherPanel.addEventListener("click", () => setWeatherPanelCollapsed(true));
ui.helpToggle.addEventListener("click", () => setHelpPanelCollapsed(!ui.helpPanel.classList.contains("is-collapsed")));
ui.closeHelpPanel.addEventListener("click", () => setHelpPanelCollapsed(true));
ui.brandButton.addEventListener("click", () => setAboutPanelCollapsed(!ui.aboutPanel.classList.contains("is-collapsed")));
ui.brandButton.addEventListener("mouseenter", () => setAboutPanelCollapsed(false));
ui.appVersion.addEventListener("click", toggleChangelog);
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
  if (input.value === state.locationMode) input.checked = true;
  input.addEventListener("change", () => {
    if (!input.checked) return;
    state.locationMode = input.value;
    try { localStorage.setItem(LOCATION_MODE_STORAGE_KEY, input.value); } catch { /* ignorieren */ }
    ui.locationInput.placeholder = input.value === "place" ? "München, Berlin, Köln ..." : "48.137, 11.575";
    ui.locationStatus.textContent = input.value === "place" ? "Ort oder PLZ suchen" : "Koordinaten eingeben";
    ui.locationInput.focus();
  });
});
// Placeholder und Status beim Start auf gespeicherten Modus setzen
ui.locationInput.placeholder = state.locationMode === "place" ? "München, Berlin, Köln ..." : "48.137, 11.575";
ui.locationStatus.textContent = state.locationMode === "place" ? "Ort oder PLZ suchen" : "Koordinaten eingeben";
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setAboutPanelCollapsed(true);
});

map.on("dragstart", disableLocationFollow);
map.on("zoomstart", (event) => {
  if (event.originalEvent) disableLocationFollow();
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

function closeAllPanels() {
  state.collapsed = true;
  ui.panel.classList.add("is-collapsed");
  ui.panelToggle.setAttribute("aria-expanded", "false");

  ui.cellPanel.classList.add("is-collapsed");
  ui.cellPanelToggle.setAttribute("aria-expanded", "false");

  ui.weatherPanel.classList.add("is-collapsed");
  ui.weatherPanelToggle.setAttribute("aria-expanded", "false");

  ui.helpPanel.classList.add("is-collapsed");
  ui.helpToggle.setAttribute("aria-expanded", "false");

  ui.aboutPanel.classList.add("is-collapsed");
  ui.brandButton.setAttribute("aria-expanded", "false");
}

function setPanelCollapsed(collapsed) {
  if (!collapsed) closeAllPanels();
  state.collapsed = collapsed;
  ui.panel.classList.toggle("is-collapsed", collapsed);
  ui.panelToggle.setAttribute("aria-expanded", String(!collapsed));
}

function setCellPanelCollapsed(collapsed) {
  if (!collapsed) closeAllPanels();
  ui.cellPanel.classList.toggle("is-collapsed", collapsed);
  ui.cellPanelToggle.setAttribute("aria-expanded", String(!collapsed));
}

function setWeatherPanelCollapsed(collapsed) {
  if (!collapsed) closeAllPanels();
  ui.weatherPanel.classList.toggle("is-collapsed", collapsed);
  ui.weatherPanelToggle.setAttribute("aria-expanded", String(!collapsed));
}

function setLocationPanelCollapsed(collapsed) {
  state.locationCollapsed = collapsed;
  ui.locationPanel.classList.toggle("is-collapsed", collapsed);
  ui.locationPanelToggle.classList.toggle("is-visible", collapsed);
  ui.locationPanelToggle.setAttribute("aria-expanded", String(!collapsed));
}

function setHelpPanelCollapsed(collapsed) {
  if (!collapsed) closeAllPanels();
  ui.helpPanel.classList.toggle("is-collapsed", collapsed);
  ui.helpToggle.setAttribute("aria-expanded", String(!collapsed));
}

function setAboutPanelCollapsed(collapsed) {
  if (!collapsed) closeAllPanels();
  ui.aboutPanel.classList.toggle("is-collapsed", collapsed);
  ui.brandButton.setAttribute("aria-expanded", String(!collapsed));
}

function renderAppMetadata() {
  const versionText = `V${APP_VERSION}`;
  if (ui.appVersion) ui.appVersion.textContent = versionText;
  if (ui.appReleaseDate) ui.appReleaseDate.textContent = APP_RELEASE_DATE;
  if (!ui.changelogList) return;

  ui.changelogList.innerHTML = APP_CHANGELOG.map((entry) => `
    <article class="changelog-entry">
      <h3>${escapeHtml(`V${entry.version}`)} <span>${escapeHtml(entry.date)}</span></h3>
      <ul>
        ${entry.changes.map((change) => `<li><span>${escapeHtml(change)}</span></li>`).join("")}
      </ul>
    </article>
  `).join("");
}

function toggleChangelog() {
  const expanded = ui.appVersion.getAttribute("aria-expanded") === "true";
  ui.appVersion.setAttribute("aria-expanded", String(!expanded));
  ui.changelogList.hidden = expanded;
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
  const weatherLabelKey = state.weatherEnabled ? currentWeatherCellKey() : null;
  let totalCells = 0;
  let visibleWeatherCells = [];
  const activeLayers = layers.filter((layer) => state.active.has(layer.id));
  const occupiedS17Keys = occupiedS17CellKeys();
  const occupiedS14Keys = occupiedS14CellKeys();
  const s14StatusColors = {
    next: "#7c3aed",
    near: "#f59e0b",
    ok: "#22c55e",
    full: "#22c55e",
    over: "#ef4444",
  };

  if (!activeLayers.length) {
    layers.forEach((layer) => clearRenderedLayer(layer.id));
    ui.renderStatus.textContent = "Keine Layer aktiv";
    return;
  }

  // Layer die nicht mehr aktiv sind komplett leeren
  layers.forEach((layer) => {
    if (!state.active.has(layer.id)) clearRenderedLayer(layer.id);
  });

  activeLayers.forEach((layer) => {
    const currentMap = state.renderedCells.get(layer.id);

    if (zoom < layer.minZoom) {
      clearRenderedLayer(layer.id);
      return;
    }

    const cells = collectVisibleCells(layer.level);
    totalCells += cells.length;
    if (layer.id === "weather") visibleWeatherCells = cells;

    const newKeys = new Set();

    cells.forEach((cell) => {
      const key = cellKey(cell);
      newKeys.add(key);

      const weather = layer.id === "weather" && state.weatherEnabled ? state.weather.get(key) : null;
      const hasWaypoint = layer.id === "stop" && occupiedS17Keys.has(key);
      const s14Validation = layer.id === "gym" && occupiedS14Keys.has(key) ? s14GymValidationForCell(key) : null;
      const lineWeight = gridWeight(layer.level, zoom);
      const shouldShowS14Status = layer.id === "gym" && occupiedS14Keys.has(key);
      const shouldShowWeatherLabel = layer.id === "weather" && weather && key === weatherLabelKey;
      const shouldShowLabel = shouldShowS14Status || shouldShowWeatherLabel || ((zoom >= layer.labelZoom && !weather) && shouldLabelCell(cell, layer.level, zoom));

      const fingerprint = [
        weather ? weather.pokemonWeather.id : "",
        hasWaypoint,
        s14Validation ? s14Validation.status : "",
        lineWeight,
        shouldShowLabel,
        shouldShowWeatherLabel,
      ].join("|");

      const existing = currentMap.get(key);
      if (existing && existing.fingerprint === fingerprint) return; // nichts geändert

      // Altes Entry entfernen bevor neues gebaut wird
      if (existing) {
        existing.polygon.remove();
        if (existing.labelMarker) existing.labelMarker.remove();
      }

      // Polygon neu bauen
      const weatherColor = weather && weather.pokemonWeather ? weather.pokemonWeather.color : layer.color;
      const s14StatusColor = s14Validation ? s14StatusColors[s14Validation.status] || layer.color : null;
      const polygon = cellPolygon(cell.face, cell.i, cell.j, cell.level);
      const leafletPolygon = L.polygon(polygon, {
        color: s14StatusColor || weatherColor,
        weight: lineWeight,
        opacity: 0.9,
        fillColor: s14StatusColor || (hasWaypoint ? "#475569" : weatherColor),
        fillOpacity: s14StatusColor ? 0.1 : hasWaypoint ? 0.2 : layer.id === "weather" ? 0.04 : 0,
        interactive: true,
      }).bindTooltip(buildTooltip(layer, cell, weather), {
        sticky: true,
        direction: "top",
      });
      if (layer.id === "gym") wireS14CellPopup(leafletPolygon, cell, lineWeight);
      leafletPolygon.addTo(state.groups.get(layer.id));

      // Label neu bauen
      let labelMarker = null;
      if (shouldShowLabel) {
        const center = shouldShowWeatherLabel ? visibleLabelPosition(polygon, viewBounds) : cellCenter(cell.face, cell.i, cell.j, cell.level);
        const labelHtml = buildLabel(layer, weather, cell, shouldShowS14Status);
        const weatherIconSize = shouldShowWeatherLabel ? weatherLabelIconSize(zoom) : null;
        labelMarker = L.marker(center, {
          interactive: layer.id === "gym",
          icon: L.divIcon({
            className: "",
            html: labelHtml,
            iconSize: layer.id === "gym" ? [92, 22] : weatherIconSize || [34, 18],
            iconAnchor: layer.id === "gym" ? [46, 11] : weatherIconSize ? [weatherIconSize[0] / 2, weatherIconSize[1] / 2] : [17, 9],
          }),
        })
          .on("click", () => L.popup({ className: "s14-cell-popup-wrapper", autoPanPadding: [18, 18] })
            .setLatLng(center)
            .setContent(s14CellPopupHtml(cell))
            .openOn(map))
          .addTo(state.labels.get(layer.id));
      }

      currentMap.set(key, { polygon: leafletPolygon, labelMarker, fingerprint });
    });

    // Zellen die nicht mehr sichtbar sind entfernen
    currentMap.forEach((entry, key) => {
      if (!newKeys.has(key)) {
        entry.polygon.remove();
        if (entry.labelMarker) entry.labelMarker.remove();
        currentMap.delete(key);
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

function clearRenderedLayer(layerId) {
  const currentMap = state.renderedCells.get(layerId);
  if (!currentMap) return;
  currentMap.forEach((entry) => {
    entry.polygon.remove();
    if (entry.labelMarker) entry.labelMarker.remove();
  });
  currentMap.clear();
}

function occupiedS17CellKeys() {
  return new Set(
    state.waypoints
      .filter((waypoint) => waypoint.active)
      .map((waypoint) => cellKey(latLngToCell(waypoint.lat, waypoint.lng, 17))),
  );
}

function occupiedS14CellKeys() {
  return new Set(
    state.waypoints
      .filter((waypoint) => waypoint.active)
      .map((waypoint) => cellKey(latLngToCell(waypoint.lat, waypoint.lng, 14))),
  );
}

function currentWeatherCellKey() {
  const center = map.getCenter();
  return cellKey(latLngToCell(center.lat, center.lng, 10));
}

function weatherLabelIconSize(zoom) {
  if (zoom >= 17) return [108, 24];
  if (zoom >= 14) return [94, 22];
  return [78, 19];
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
      `${escapeHtml(weather.provider)}: ${escapeHtml(weather.weatherText)}`,
      `Wetterboost-Naeherung: ${escapeHtml(weather.pokemonWeather.label)}`,
      `Boost: ${escapeHtml(formatBoostedTypes(weather))}`,
      `Temp: ${formatValue(weather.temperatureC, "°C")} · Wind: ${formatValue(weather.windKmh, "km/h")}`,
      `Ort: ${escapeHtml(weather.location.name)}`,
    );
  }
  return lines.join("<br>");
}

function buildLabel(layer, weather, cell = null, showS14Status = false) {
  if (layer.id === "gym" && cell && showS14Status) return buildS14StatusLabel(cell);
  if (!weather) return `<span class="s2-label">L${layer.level}</span>`;
  return `<span class="s2-label is-weather" style="background:${weather.pokemonWeather.color}">${weather.pokemonWeather.label}</span>`;
}

function buildS14StatusLabel(cell) {
  const validation = s14GymValidationForCell(cellKey(cell));
  const text = validation.activeCount
    ? `${validation.arenaCount}/${validation.expected} · ${validation.activeCount}`
    : "0 POI";
  return `<span class="s2-label is-s14-status is-${escapeHtml(validation.status)}">${escapeHtml(text)}</span>`;
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

const UNDO_MAX = 20;

function pushUndoSnapshot() {
  state.undoStack.push(JSON.parse(JSON.stringify(state.waypoints)));
  if (state.undoStack.length > UNDO_MAX) state.undoStack.shift();
  updateUndoButton();
}

function undoWaypointAction() {
  if (!state.undoStack.length) return;
  state.waypoints = state.undoStack.pop();
  saveWaypoints();
  renderWaypoints();
  scheduleRender();
  updateUndoButton();
  ui.waypointStatus.textContent = "Rückgängig gemacht";
}

function updateUndoButton() {
  ui.undoWaypointButton.disabled = state.undoStack.length === 0;
}

function addWaypoint(name, lat, lng, meta = {}) {
  pushUndoSnapshot();
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
  pushUndoSnapshot();
  state.waypoints = state.waypoints.filter((waypoint) => waypoint.id !== id);
  enforceActiveWaypoints();
  saveWaypoints();
  renderWaypoints();
}

function clearWaypoints() {
  if (!state.waypoints.length) {
    ui.waypointStatus.textContent = "Keine Waypoints zum Leeren vorhanden.";
    return;
  }
  const confirmed = window.confirm("alle aktuell sichtbaren waypoints werden gelöscht. fortfahren?");
  if (!confirmed) return;
  pushUndoSnapshot();
  state.waypoints = [];
  saveWaypoints();
  renderWaypoints();
}

function toggleWaypointsVisibility() {
  // Checkbox-Label ist "Waypoints ausblenden": checked=true → nicht sichtbar
  state.waypointsVisible = !ui.waypointsVisibilityButton.checked;
  renderWaypoints();
}

function renderWaypoints() {
  if (!state.waypointGroup) return;
  enforceActiveWaypoints();
  state.waypointGroup.clearLayers();
  scheduleRender();

  const isEmpty = !state.waypoints.length;
  ui.waypointEmptyState.hidden = !isEmpty;
  if (isEmpty) {
    ui.waypointStatus.textContent = "";
    return;
  }

  const s17Groups = groupWaypointsByCell(17);
  const activeWaypoints = state.waypoints.filter((waypoint) => waypoint.active);
  ui.waypointStatus.textContent = `${activeWaypoints.length}/${state.waypoints.length} aktive Waypoints`;

  if (!state.waypointsVisible) {
    ui.waypointStatus.textContent = `Waypoints ausgeblendet · ${state.waypoints.length} gespeichert`;
    return;
  }

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
      .on("dragend", (event) => {
        moveWaypointToLatLng(waypoint.id, event.target.getLatLng());
        marker.dragging.disable();
        const element = marker.getElement();
        if (element) element.classList.remove("is-moving-waypoint");
      })
      .bindPopup(waypointPopupHtml(waypoint))
      .on("popupopen", () => {
        marker.closeTooltip();
        wireWaypointPopup(marker, waypoint.id);
      })
      .addTo(state.waypointGroup);
    marker.dragging.disable();
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
        <button type="button" data-waypoint-action="move">Verschieben</button>
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
      if (action === "move") startWaypointMove(marker, id);
      if (action === "focus") focusWaypoint(id);
      if (action === "delete") {
        removeWaypoint(id);
        map.closePopup();
      }
    });
  });
}

function startWaypointMove(marker, id) {
  const waypoint = state.waypoints.find((entry) => entry.id === id);
  if (!waypoint || !marker.dragging) return;
  marker.dragging.enable();
  marker.closePopup();
  marker.openTooltip();
  const element = marker.getElement();
  if (element) element.classList.add("is-moving-waypoint");
  ui.waypointStatus.textContent = `${waypoint.name}: Marker jetzt ziehen.`;
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
  pushUndoSnapshot();
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
  pushUndoSnapshot();
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
        <strong>S14</strong>
        <span>${escapeHtml(statusLabel)}</span>
      </div>
      <dl>
        <div><dt>POI</dt><dd>${validation.activeCount}</dd></div>
        <div><dt>Arenen</dt><dd>${validation.arenaCount}/${validation.expected}</dd></div>
        <div><dt>Nächste</dt><dd>${validation.next ? `${validation.missing}/${validation.next}` : "-"}</dd></div>
      </dl>
      <p>${escapeHtml(validation.text)}</p>
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

  if (arenaCount === expected && arenaCount > 0 && next) {
    return {
      status: "ok",
      text: `Arenen plausibel: ${arenaCount}/${expected} bei ${activeCount} aktiven POI. Nächste Schwelle bei ${next}.`,
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
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  try {
    const known = new Set(state.waypoints.map(waypointIdentity));
    const additions = [];
    let duplicates = 0;
    let empty = 0;
    const failedFiles = [];

    for (const [index, file] of files.entries()) {
      const isImage = isImageImportFile(file);
      const progressLabel = files.length > 1 ? `${index + 1}/${files.length}: ` : "";
      ui.waypointStatus.textContent = isImage
        ? `${progressLabel}Screenshot wird gelesen ...`
        : `${progressLabel}Import wird gelesen ...`;
      await yieldToBrowser();

      try {
        const text = isImage ? await textFromImageFile(file, `${progressLabel}Screenshot`) : await file.text();
        const imported = parseWaypointImport(text, file.name);
        if (!imported.length) {
          empty += 1;
          continue;
        }

        imported.forEach((waypoint) => {
          const identity = waypointIdentity(waypoint);
          if (known.has(identity)) {
            duplicates += 1;
            return;
          }
          known.add(identity);
          additions.push(waypoint);
        });
      } catch (error) {
        failedFiles.push(file.name);
      }
    }

    if (!additions.length) {
      ui.waypointStatus.textContent = importSummary(files.length, 0, duplicates, empty, failedFiles);
      return;
    }

    state.waypoints.push(...additions);
    enforceActiveWaypoints();
    saveWaypoints();
    renderWaypoints();
    focusActiveS14Cell();
    ui.waypointStatus.textContent = importSummary(files.length, additions.length, duplicates, empty, failedFiles);
  } catch (error) {
    ui.waypointStatus.textContent = error.message || "Import konnte nicht gelesen werden.";
  } finally {
    event.target.value = "";
  }
}

function importSummary(fileCount, added, duplicates, empty, failedFiles) {
  const parts = [`${added} Waypoint${added === 1 ? "" : "s"} importiert`];
  if (fileCount > 1) parts.unshift(`${fileCount} Dateien`);
  if (duplicates) parts.push(`${duplicates} doppelt`);
  if (empty) parts.push(`${empty} ohne sicheren Treffer`);
  if (failedFiles.length) {
    const names = failedFiles.join(", ");
    parts.push(`Fehler: ${names}`);
  }
  return parts.join(" · ");
}

async function textFromImageFile(file, label = "Screenshot") {
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

  ui.waypointStatus.textContent = `${label} wird erkannt ...`;
  await yieldToBrowser();
  const imageUrl = await fileToDataUrl(file);
  const result = await window.Tesseract.recognize(imageUrl, "deu+eng", {
    logger: (progress) => {
      if (progress.status !== "recognizing text" || !Number.isFinite(progress.progress)) return;
      ui.waypointStatus.textContent = `${label} wird erkannt ... ${Math.round(progress.progress * 100)}%`;
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
      script.integrity = "sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb";
      script.crossOrigin = "anonymous";
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
      // data.name kommt vom API-Proxy; String-Cast schützt vor unerwarteten Typen
      name: nameFromWaypointText(text, url) || String(data.name || "").trim(),
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

  // Fallback: nur Zahlen mit Dezimalstellen matchen, um reine Ganzzahlen
  // (z.B. "5 Sterne, 48 Stunden, 11 Tage") nicht als Koordinaten zu interpretieren.
  const numbers = text.match(/-?\d+[\.,]\d+/g) || [];
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

function shouldLabelCell(cell, level, zoom) {
  if (level >= 17) return false;
  if (level >= 14) {
    const density = zoom >= 17.5 ? 4 : 2;
    return positiveModulo(cell.i * 11 + cell.j * 19, density) === 0;
  }
  return true;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
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

  // GPS läuft bereits und Marker ist gesetzt → sofort zur aktuellen Position springen
  if (state.locationTrackStarted && state.locationMarker) {
    state.locationFollow = true;
    const { lat, lng } = state.locationMarker.getLatLng();
    const targetZoom = Math.max(map.getZoom(), 17);
    map.setView([lat, lng], targetZoom, { animate: true });
    ui.locationStatus.textContent = "GPS aktiv · Karte folgt deiner Position";
    return;
  }

  if (state.locationWatchId !== null) {
    navigator.geolocation.clearWatch(state.locationWatchId);
  }

  state.locationTrackStarted = false;
  state.locationFollow = true;
  state.mapRotationEnabled = true;
  if (Number.isFinite(state.locationHeading)) setMapBearing(state.locationHeading);
  ui.locationStatus.textContent = "GPS wird gestartet ...";
  enableHeadingUpdates();
  state.locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const firstUpdate = !state.locationTrackStarted;
      state.locationTrackStarted = true;
      const gpsHeading = Number.isFinite(position.coords.heading) ? position.coords.heading : null;
      if (gpsHeading !== null) updateHeading(gpsHeading);
      moveToLocation(position.coords.latitude, position.coords.longitude, locationLabel(position), {
        level: 14,
        tracking: true,
        firstUpdate,
        heading: state.locationHeading,
      });
      ui.locationStatus.textContent = state.locationFollow
        ? "GPS aktiv · Karte folgt deiner Position"
        : "GPS aktiv · Karte frei bewegt";
      if (options.initial && firstUpdate) {
        setLocationPanelCollapsed(true);
      }
    },
    (error) => {
      ui.locationStatus.textContent = geolocationErrorMessage(error);
      setLocationPanelCollapsed(false);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 },
  );
}

function disableLocationFollow() {
  if (!state.locationTrackStarted || !state.locationFollow) return;
  state.locationFollow = false;
  ui.locationStatus.textContent = "GPS aktiv · Karte frei bewegt";
}

function toggleLocationRadius() {
  state.locationRadiusVisible = ui.locationRadiusButton.checked;
  if (state.locationRadiusCircle) {
    if (state.locationRadiusVisible) {
      state.locationRadiusCircle.addTo(map);
    } else {
      state.locationRadiusCircle.remove();
    }
  }
}

function locationLabel(position) {
  const accuracy = Math.round(position.coords.accuracy || 0);
  return accuracy > 0 ? `Eigene Location · ±${accuracy} m` : "Eigene Location";
}

function enableHeadingUpdates() {
  if (state.orientationListening || typeof window === "undefined") return;

  const attachListener = () => {
    if (state.orientationListening) return;
    window.addEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
    state.orientationListening = true;
  };

  if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === "function") {
    window.DeviceOrientationEvent.requestPermission()
      .then((permission) => {
        if (permission === "granted") attachListener();
      })
      .catch(() => {});
    return;
  }

  attachListener();
}

function handleDeviceOrientation(event) {
  const compassHeading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : null;
  const alphaHeading = event.absolute && Number.isFinite(event.alpha) ? 360 - event.alpha : null;
  const heading = compassHeading ?? alphaHeading;
  if (!Number.isFinite(heading)) return;

  updateHeading(heading);
}

function updateHeading(heading) {
  state.locationHeading = normalizeBearing(heading);
  if (state.locationMarker) {
    state.locationMarker.setIcon(locationIcon(state.locationHeading));
  }
  if (state.mapRotationEnabled) {
    setMapBearing(state.locationHeading);
  }
}


function setMapBearing(bearing) {
  const normalized = normalizeBearing(bearing);
  state.mapBearing = normalized;
  ui.mapStage.style.setProperty("--map-bearing", `${-normalized}deg`);
  ui.mapStage.style.setProperty("--compass-bearing", `${-normalized}deg`);
  ui.compassButton.classList.toggle("is-rotated", Math.abs(normalized) > 0.5 && Math.abs(normalized - 360) > 0.5);
}

function resetMapBearing() {
  state.mapRotationEnabled = false;
  setMapBearing(0);
  ui.locationStatus.textContent = state.locationTrackStarted
    ? "GPS aktiv · Karte eingenordet"
    : "Karte eingenordet";
}

function normalizeBearing(value) {
  return ((Number(value) % 360) + 360) % 360;
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
  if (options.tracking) {
    if (options.firstUpdate && state.locationFollow) {
      focusS2CellForLocation(lat, lng, options.level || 14);
    } else if (state.locationFollow) {
      const targetZoom = Math.max(map.getZoom(), options.level >= 14 ? 17 : 16);
      map.setView([lat, lng], targetZoom, { animate: true });
    }
  } else {
    focusS2CellForLocation(lat, lng, options.level || 14);
  }
  ui.locationStatus.textContent = label;
  if (!state.locationMarker) {
    state.locationMarker = L.marker([lat, lng], {
      icon: locationIcon(options.heading),
      interactive: true,
      zIndexOffset: 900,
    }).addTo(map);
  } else {
    state.locationMarker.setLatLng([lat, lng]);
    state.locationMarker.setIcon(locationIcon(options.heading));
  }
  state.locationMarker.bindTooltip(label, { permanent: false, direction: "top" });
  updateLocationRadius(lat, lng);
}

function locationIcon(heading) {
  const hasHeading = Number.isFinite(heading);
  const headingStyle = hasHeading ? ` style="--heading:${heading}deg"` : "";
  const headingClass = hasHeading ? " has-heading" : "";
  return L.divIcon({
    className: "",
    html: `<span class="location-marker${headingClass}"${headingStyle} aria-hidden="true"></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function updateLocationRadius(lat, lng) {
  if (!state.locationRadiusCircle) {
    state.locationRadiusCircle = L.circle([lat, lng], {
      radius: INTERACTION_RADIUS_METERS,
      color: "#1d8cf8",
      weight: 1.25,
      opacity: 0.45,
      fillColor: "#1d8cf8",
      fillOpacity: 0.055,
      interactive: false,
    });
    if (state.locationRadiusVisible) state.locationRadiusCircle.addTo(map);
    return;
  }

  state.locationRadiusCircle.setLatLng([lat, lng]);
  state.locationRadiusCircle.setRadius(INTERACTION_RADIUS_METERS);
  if (state.locationRadiusVisible && !map.hasLayer(state.locationRadiusCircle)) {
    state.locationRadiusCircle.addTo(map);
  }
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
