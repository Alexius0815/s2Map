const MAX_REDIRECTS = 5;

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

  const rawUrl = String(req.query.url || "").trim();
  const initialUrl = safeMapUrl(rawUrl);
  if (!initialUrl) {
    res.status(400).json({ error: "invalid_url", message: "Nur Apple-Maps-, Google-Maps- oder Pokémon-GO-Maplinks werden unterstützt." });
    return;
  }

  try {
    const resolvedUrl = await followRedirects(initialUrl);
    const waypoint = waypointFromUrl(resolvedUrl);
    if (!waypoint) {
      res.status(422).json({ error: "coordinates_not_found", url: resolvedUrl, message: "Im Link wurden keine Koordinaten gefunden." });
      return;
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({ ...waypoint, url: resolvedUrl });
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.code || "resolve_failed",
      message: error.message || "Link konnte nicht aufgelöst werden.",
    });
  }
};

async function followRedirects(initialUrl) {
  let current = initialUrl;

  for (let count = 0; count < MAX_REDIRECTS; count += 1) {
    const response = await fetch(current, { method: "GET", redirect: "manual" });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return current;
    current = new URL(location, current).toString();
    if (!safeMapUrl(current)) throw makeError(400, "unsupported_redirect", "Der Link leitet auf eine nicht unterstützte Domain um.");
  }

  throw makeError(508, "too_many_redirects", "Der Kartenlink hat zu viele Weiterleitungen.");
}

function safeMapUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const allowed =
    host === "maps.apple" ||
    host === "maps.apple.com" ||
    host === "maps.google.com" ||
    host === "www.google.com" ||
    host === "goo.gl" ||
    host === "pokemongo.com" ||
    host.endsWith(".pokemongo.com");

  return allowed ? url.toString() : null;
}

function waypointFromUrl(value) {
  const url = new URL(value);
  const coordinate = url.searchParams.get("coordinate");
  const ll = url.searchParams.get("ll") || url.searchParams.get("center") || url.searchParams.get("q");
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng") || url.searchParams.get("lon") || url.searchParams.get("longitude");

  const coordinates =
    parseLatLng(coordinate) ||
    parseLatLng(ll) ||
    parseLatLng(lat && lng ? `${lat},${lng}` : "");

  if (!coordinates) return null;

  const name = url.searchParams.get("name") || url.searchParams.get("q") || "";
  return {
    name: cleanName(name),
    lat: coordinates.lat,
    lng: coordinates.lng,
  };
}

function parseLatLng(value) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

function cleanName(value) {
  return decodeURIComponent(String(value || ""))
    .replace(/^\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\s*$/, "")
    .trim();
}

function makeError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
