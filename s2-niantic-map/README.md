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

Fuer PGO-nahe Wetterdaten muss in Vercel eine Environment Variable gesetzt werden:

```txt
ACCUWEATHER_API_KEY=dein_accuweather_key
```

Die App ruft AccuWeather ueber `/api/weather` ab, damit der Key nicht im Browser sichtbar ist. Ohne Key bleibt die Karte nutzbar; der Wetterbutton zeigt dann einen Konfigurationshinweis.

## Layer

- `Level 10`: Wetterzellen fuer Pokemon-GO-Wetterboosts.
- `Level 14`: Orientierung fuer Gym- und POI-Dichte.
- `Level 17`: feine Stop- und Waypoint-Zellen.
- `Level 12`: mittlere Uebersicht fuer Ingress-Umfelder.

Die Regeln sind nicht offiziell dokumentiert und koennen sich aendern. Die App ist als Planungs- und Orientierungshilfe gedacht.
