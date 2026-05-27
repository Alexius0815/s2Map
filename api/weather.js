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

  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({ error: "invalid_coordinates" });
    return;
  }

  const provider = req.query.provider === "accuweather" ? "accuweather" : "openmeteo";
  const cacheKey = `${provider}:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cachedWeather = getCached(weatherCache, cacheKey);
  if (cachedWeather) {
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.status(200).json({ ...cachedWeather, cached: true });
    return;
  }

  try {
    const payload =
      provider === "accuweather"
        ? await fetchAccuWeather(lat, lng, cacheKey)
        : await fetchOpenMeteoWeather(lat, lng);

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

async function fetchOpenMeteoWeather(lat, lng) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("current", "weather_code,temperature_2m,precipitation,cloud_cover,wind_speed_10m,is_day");
  url.searchParams.set("timezone", "auto");

  const response = await fetchJson(url);
  const current = response.current || {};
  const weather = mapOpenMeteoToPokemon(current);

  return {
    provider: "Open-Meteo",
    location: { name: "Zellmittelpunkt", country: "" },
    coordinates: { lat, lng },
    observedAt: current.time || new Date().toISOString(),
    weatherText: openMeteoWeatherText(current.weather_code),
    weatherIcon: current.weather_code,
    hasPrecipitation: Number(current.precipitation) > 0,
    precipitationType: Number(current.precipitation) > 0 ? "rain" : null,
    temperatureC: Number.isFinite(current.temperature_2m) ? current.temperature_2m : null,
    windKmh: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m : null,
    cloudCover: Number.isFinite(current.cloud_cover) ? current.cloud_cover : null,
    pokemonWeather: weather,
  };
}

async function fetchAccuWeather(lat, lng, cacheKey) {
  const apiKey = process.env.ACCUWEATHER_API_KEY;
  if (!apiKey) {
    throw makeError(503, "missing_api_key", "ACCUWEATHER_API_KEY ist nicht gesetzt.");
  }

  const location = await resolveLocation(apiKey, lat, lng, cacheKey);
  const current = await fetchCurrentConditions(apiKey, location.key);
  return normalizeAccuWeather(current, location, lat, lng);
}

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

function normalizeAccuWeather(current, location, lat, lng) {
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

function mapOpenMeteoToPokemon(current) {
  const code = Number(current.weather_code);
  const windKmh = Number(current.wind_speed_10m) || 0;
  const cloudCover = Number(current.cloud_cover) || 0;

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return pokemonWeather("snow", "Schnee", "#6db7d8");
  }
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) {
    return pokemonWeather("rain", "Regen", "#2563eb");
  }
  if ([45, 48].includes(code)) {
    return pokemonWeather("fog", "Nebel", "#64748b");
  }
  if (windKmh >= 29) {
    return pokemonWeather("wind", "Windig", "#0891b2");
  }
  if (code === 3 || cloudCover >= 80) {
    return pokemonWeather("cloudy", "Bewölkt", "#6b7280");
  }
  if (code === 2 || cloudCover >= 30) {
    return pokemonWeather("partly-cloudy", "Teilweise bewölkt", "#8b5cf6");
  }
  return pokemonWeather("clear", "Klar", "#d97706");
}

function openMeteoWeatherText(code) {
  const labels = {
    0: "Klar",
    1: "Überwiegend klar",
    2: "Teilweise bewölkt",
    3: "Bewölkt",
    45: "Nebel",
    48: "Reifnebel",
    51: "Leichter Nieselregen",
    53: "Nieselregen",
    55: "Starker Nieselregen",
    56: "Gefrierender Nieselregen",
    57: "Starker gefrierender Nieselregen",
    61: "Leichter Regen",
    63: "Regen",
    65: "Starker Regen",
    66: "Gefrierender Regen",
    67: "Starker gefrierender Regen",
    71: "Leichter Schneefall",
    73: "Schneefall",
    75: "Starker Schneefall",
    77: "Schneegriesel",
    80: "Leichte Regenschauer",
    81: "Regenschauer",
    82: "Starke Regenschauer",
    85: "Leichte Schneeschauer",
    86: "Starke Schneeschauer",
    95: "Gewitter",
    96: "Gewitter mit Hagel",
    99: "Starkes Gewitter mit Hagel",
  };
  return labels[code] || "Unbekannt";
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
