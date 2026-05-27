const LOCATION_CACHE_MS = 24 * 60 * 60 * 1000;
const WEATHER_CACHE_MS = 30 * 60 * 1000;

const locationCache = new Map();
const weatherCache = new Map();

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const apiKey = process.env.ACCUWEATHER_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "missing_api_key",
      message: "ACCUWEATHER_API_KEY ist nicht gesetzt.",
    });
    return;
  }

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({ error: "invalid_coordinates" });
    return;
  }

  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cachedWeather = getCached(weatherCache, cacheKey);
  if (cachedWeather) {
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.status(200).json({ ...cachedWeather, cached: true });
    return;
  }

  try {
    const location = await resolveLocation(apiKey, lat, lng, cacheKey);
    const current = await fetchCurrentConditions(apiKey, location.key);
    const payload = normalizeWeather(current, location, lat, lng);

    weatherCache.set(cacheKey, {
      expires: Date.now() + WEATHER_CACHE_MS,
      value: payload,
    });

    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.status(200).json(payload);
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.code || "weather_fetch_failed",
      message: error.message || "Wetterdaten konnten nicht geladen werden.",
    });
  }
};

async function resolveLocation(apiKey, lat, lng, cacheKey) {
  const cachedLocation = getCached(locationCache, cacheKey);
  if (cachedLocation) return cachedLocation;

  const url = new URL("https://dataservice.accuweather.com/locations/v1/cities/geoposition/search");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("q", `${lat},${lng}`);
  url.searchParams.set("language", "de-de");

  const response = await fetchJson(url);
  if (!response.Key) {
    throw makeError(502, "location_not_found", "AccuWeather konnte keinen LocationKey liefern.");
  }

  const location = {
    key: response.Key,
    name: response.LocalizedName || response.EnglishName || "Unbekannter Ort",
    country: response.Country ? response.Country.LocalizedName || response.Country.ID || "" : "",
  };

  locationCache.set(cacheKey, {
    expires: Date.now() + LOCATION_CACHE_MS,
    value: location,
  });

  return location;
}

async function fetchCurrentConditions(apiKey, locationKey) {
  const url = new URL(`https://dataservice.accuweather.com/currentconditions/v1/${locationKey}`);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("details", "true");
  url.searchParams.set("language", "de-de");

  const response = await fetchJson(url);
  const current = Array.isArray(response) ? response[0] : null;
  if (!current) {
    throw makeError(502, "conditions_not_found", "AccuWeather lieferte keine aktuellen Bedingungen.");
  }
  return current;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw makeError(response.status, "accuweather_error", data && data.Message ? data.Message : "AccuWeather-Anfrage fehlgeschlagen.");
  }

  return data;
}

function normalizeWeather(current, location, lat, lng) {
  const weather = mapAccuWeatherToPokemon(current);
  const temperature = current.Temperature && current.Temperature.Metric ? current.Temperature.Metric.Value : null;
  const windSpeed = current.Wind && current.Wind.Speed && current.Wind.Speed.Metric ? current.Wind.Speed.Metric.Value : null;

  return {
    provider: "AccuWeather",
    location,
    coordinates: { lat, lng },
    observedAt: current.LocalObservationDateTime || current.EpochTime || new Date().toISOString(),
    weatherText: current.WeatherText || weather.label,
    weatherIcon: current.WeatherIcon || null,
    hasPrecipitation: Boolean(current.HasPrecipitation),
    precipitationType: current.PrecipitationType || null,
    temperatureC: Number.isFinite(temperature) ? temperature : null,
    windKmh: Number.isFinite(windSpeed) ? windSpeed : null,
    cloudCover: Number.isFinite(current.CloudCover) ? current.CloudCover : null,
    pokemonWeather: weather,
  };
}

function mapAccuWeatherToPokemon(current) {
  const icon = Number(current.WeatherIcon);
  const text = String(current.WeatherText || "").toLowerCase();
  const precipitationType = String(current.PrecipitationType || "").toLowerCase();
  const windKmh = current.Wind && current.Wind.Speed && current.Wind.Speed.Metric ? current.Wind.Speed.Metric.Value : 0;
  const cloudCover = current.CloudCover || 0;

  if (precipitationType.includes("snow") || [19, 20, 21, 22, 23, 24, 25, 26, 29, 43, 44].includes(icon)) {
    return pokemonWeather("snow", "Schnee", "#6db7d8");
  }
  if (current.HasPrecipitation || [12, 13, 14, 15, 16, 17, 18, 39, 40, 41, 42].includes(icon)) {
    return pokemonWeather("rain", "Regen", "#2563eb");
  }
  if (icon === 11 || text.includes("nebel") || text.includes("fog")) {
    return pokemonWeather("fog", "Nebel", "#64748b");
  }
  if (windKmh >= 29 || text.includes("wind")) {
    return pokemonWeather("wind", "Windig", "#0891b2");
  }
  if ([7, 8, 38].includes(icon) || cloudCover >= 80) {
    return pokemonWeather("cloudy", "Bewölkt", "#6b7280");
  }
  if ([3, 4, 5, 6, 35, 36, 37].includes(icon) || cloudCover >= 30) {
    return pokemonWeather("partly-cloudy", "Teilweise bewölkt", "#8b5cf6");
  }
  return pokemonWeather("clear", "Klar", "#d97706");
}

function pokemonWeather(id, label, color) {
  return { id, label, color };
}

function getCached(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function makeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
