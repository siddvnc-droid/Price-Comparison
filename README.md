# Ride Price Compare

Compare **Uber, Lyft, Curb and Empower** fares from point A to point B, side by side.

Type a pickup and drop-off (or use your location) and the app:

- finds the driving route and shows it on a map,
- estimates a price range for every ride type (UberX, Comfort, XL, Black; Lyft Standard, Extra Comfort, XL; taxi via Curb; Empower),
- itemizes each estimate (base fare, distance, time, booking fee, taxes and city surcharges),
- highlights the cheapest option and how much it saves,
- gives an **Open** button for each service. Uber and Lyft links open the app with the trip filled in.

Results have a shareable URL (`?from=…&to=…`), so you can bookmark a regular commute.

## How prices are estimated

None of these services offer a public price API. Uber and Lyft closed their fare-estimate APIs to new developers, and Curb and Empower never had one. So the app **estimates** fares from each service's typical rates:

| Service | Model |
| --- | --- |
| Uber, Lyft | base fare + per mile + per minute + booking fee, with a minimum fare. The range runs from normal demand to busy-time pricing (up to +45%). |
| Curb | The local taxi meter (Curb's upfront prices are based on it) plus a booking fee. The meter charges distance while moving and time in slow traffic. |
| Empower | Drivers set their own prices; modeled on reported averages (about 20–35% below Uber/Lyft). |

City-specific rates and fees are built in for:

- **New York City:** TLC taxi meter; rush-hour and overnight taxi surcharges; NY State congestion surcharge (Manhattan below 96th St); MTA congestion toll (Manhattan at or below 60th St); sales tax and Black Car Fund on Uber/Lyft. The Manhattan zones are checked against the actual route, so a trip that only passes through Midtown still picks them up.
- **Washington, DC:** DFHV taxi meter (2024 rates) plus the temporary fuel surcharge; DC Uber/Lyft rates.
- **Everywhere else:** US-average Uber/Lyft rates and a generic taxi meter. Curb is marked "limited", and Empower shows as not available.

Driving distance and time come from [OSRM](https://project-osrm.org). Time is scaled up for typical city traffic. If routing is unavailable, the app falls back to a straight-line estimate and says so.

**Treat results as a guide, not a quote.** Real prices move with demand, traffic, tolls, airport fees and promotions, and tips aren't included. Always check the live price in the app before booking.

### Known gaps

- Airport flat fares (e.g. JFK ↔ Manhattan taxi), airport access fees and bridge/tunnel tolls aren't modeled.
- Holidays are treated as regular days for taxi surcharges.
- Empower's legal status is in flux. NYC sued to shut it down in March 2026, and reports say a court order stopped it in DC in April 2026. In DC it's shown with a warning and never picked as "cheapest".

## Updating the rates

All rates live in [`src/markets.js`](src/markets.js), with comments explaining each field. To adjust a price, edit the numbers there. To add a city, copy the DC block, give it an `area` polygon, and add it to `MARKETS`.

## Running it

It's a static site with no build step and no dependencies. You need [Node.js](https://nodejs.org) 20 or newer for the local server and tests.

```bash
npm start      # serves the app at http://localhost:8080
npm test       # runs the unit tests
```

Opening `index.html` straight from disk won't work (browsers block ES modules on `file://`), so use `npm start` or any static server.

### Putting it online (free)

Because it's plain static files, any static host works. With **GitHub Pages**: repo **Settings → Pages → Build and deployment → Deploy from a branch**, pick your main branch and `/ (root)`, and save. The app will be at `https://<your-user>.github.io/<repo>/`. "Use my location" needs HTTPS, which Pages provides.

### External services

All free, keyless and called straight from the browser:

- [Photon](https://photon.komoot.io) (OpenStreetMap) for address search
- [OSRM](https://project-osrm.org) for driving routes
- [Leaflet](https://leafletjs.com) with OpenStreetMap tiles for the map

Photon and OSRM run public demo servers meant for light use. If you put this in front of a lot of people, host your own instances and change the URLs in [`src/api.js`](src/api.js).

## Project layout

```
index.html          page markup
styles.css          styles (light and dark mode)
src/app.js          UI: address search, map, rendering results
src/compare.js      picks the city, measures the trip, prices and ranks every service
src/fares.js        fare engine (rate cards, taxi meter, surcharges, ranges)
src/markets.js      rate cards per city: edit these to tune prices
src/api.js          Photon (search) and OSRM (routing) clients
src/links.js        "Open in app" links
src/geo.js          distance and zone (polygon) math
src/time.js         local time and surcharge schedules
scripts/serve.js    tiny local web server
test/               unit tests (node --test)
```

## Rate sources (October 2026)

- NYC yellow taxi fares and surcharges: [NYC TLC taxi fare page](https://www.nyc.gov/site/tlc/passengers/taxi-fare.page)
- DC taxi fares: [DFHV fare change announcement](https://dfhv.dc.gov/release/taxi-fares-are-changing-august-2-help-improve-driver-wages-0)
- Uber/Lyft city rates: third-party summaries ([RideWise NYC](https://getridewise.com/us/new-york/new-york), [RideWise DC](https://getridewise.com/us/district-of-columbia/washington)). These aren't official, so treat them as approximate.
- Empower pricing: [Obi research via press release](https://digital-release.wowktv.com/business/press-releases/cision/20260520LA63731/30-cheaper-and-growing-fast-new-obi-research-reveals-empowers-surge-in-new-york-city), [Axios](https://www.axios.com/2026/05/20/new-york-rideshare-battle)

Not affiliated with Uber, Lyft, Curb or Empower.
