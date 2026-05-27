# S2 Niantic Map

Mobile Web-App zur Orientierung mit S2-Zellen fuer Niantic-Spiele wie Ingress und Pokemon GO.

## Nutzung

Oeffne `index.html` direkt im Browser oder starte im Ordner einen lokalen Server:

```sh
python3 -m http.server 4173
```

Danach ist die App unter `http://127.0.0.1:4173/` erreichbar.

## Hosting mit Vercel

Das Repository ist fuer Vercel vorbereitet. Beim Import kann das Projekt ohne Build Command deployed werden; `vercel.json` leitet die Root-URL auf die statische App in `s2-niantic-map/`.

Der Wetterbutton nutzt standardmaessig Open-Meteo ueber `/api/weather`. Dafuer ist kein API-Key noetig.

Optional kann AccuWeather als PGO-naehere, aber keypflichtige Quelle im API-Proxy genutzt werden. Dafuer muss in Vercel eine Environment Variable gesetzt werden:

```txt
ACCUWEATHER_API_KEY=dein_accuweather_key
```

Der Key bleibt serverseitig und wird nicht im Browser sichtbar.

## Layer

- `Level 10`: Wetterzellen fuer Pokemon-GO-Wetterboosts.
- `Level 14`: Orientierung fuer Gym- und POI-Dichte.
- `Level 17`: feine Stop- und Waypoint-Zellen.
- `Level 12`: mittlere Uebersicht fuer Ingress-Umfelder.

Die Regeln sind nicht offiziell dokumentiert und koennen sich aendern. Die App ist als Planungs- und Orientierungshilfe gedacht.

## Hinweise zu Marken, Daten und Links

Diese App ist eine inoffizielle Orientierungshilfe und nicht mit Niantic, Pokemon GO, The Pokemon Company oder PokéWiki verbunden.

- Karten: OpenStreetMap-Mitwirkende, siehe https://www.openstreetmap.org/copyright
- Wetterdaten: Open-Meteo, siehe https://open-meteo.com/
- Kartenbibliothek: Leaflet, BSD-2-Clause
- Externe Typ-Links fuehren zu PokéWiki. PokéWiki-Inhalte werden nicht in diese App uebernommen.
