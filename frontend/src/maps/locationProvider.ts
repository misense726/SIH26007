export interface GeoCoordinates {
  lat: number;
  lng: number;
  altitude_m?: number;
}

export type LocationSource = "SIMULATED" | "LIVE" | "REPLAY";
export type LocationFixStatus = "FIXED" | "SEARCHING" | "OFFLINE";

export interface LocationState {
  coordinates: GeoCoordinates;
  heading_deg: number;
  speed_mps: number;
  accuracy_m: number;
  source: LocationSource;
  status: LocationFixStatus;
  timestamp_ms: number;
}

export interface LocationProvider {
  getLocation(): LocationState;
  subscribe(callback: (loc: LocationState) => void): () => void;
}

/**
 * Approximate flat-earth conversion from local Cartesian offsets (x=East/Right, y=North/Forward)
 * in metres to geodetic WGS84 latitude/longitude degrees.
 */
export function cartesianToGeodetic(
  x_m: number,
  y_m: number,
  anchor: GeoCoordinates,
): GeoCoordinates {
  const METRES_PER_DEGREE_LAT = 111320.0;
  const latRad = (anchor.lat * Math.PI) / 180.0;
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos(latRad);

  const latOffset = y_m / METRES_PER_DEGREE_LAT;
  const lngOffset = metresPerDegreeLng > 0 ? x_m / metresPerDegreeLng : 0;

  return {
    lat: anchor.lat + latOffset,
    lng: anchor.lng + lngOffset,
    altitude_m: anchor.altitude_m,
  };
}

/**
 * Convert geodetic WGS84 coordinates to local Cartesian (x, y) metres relative to an anchor.
 */
export function geodeticToCartesian(
  coords: GeoCoordinates,
  anchor: GeoCoordinates,
): { x_m: number; y_m: number } {
  const METRES_PER_DEGREE_LAT = 111320.0;
  const latRad = (anchor.lat * Math.PI) / 180.0;
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos(latRad);

  const y_m = (coords.lat - anchor.lat) * METRES_PER_DEGREE_LAT;
  const x_m = (coords.lng - anchor.lng) * metresPerDegreeLng;

  return { x_m, y_m };
}

/**
 * Formats GPS coordinates in clean human-readable standard notation.
 */
export function formatCoordinates(coords: GeoCoordinates, precision = 5): string {
  const latHemisphere = coords.lat >= 0 ? "N" : "S";
  const lngHemisphere = coords.lng >= 0 ? "E" : "W";
  const absLat = Math.abs(coords.lat).toFixed(precision);
  const absLng = Math.abs(coords.lng).toFixed(precision);
  return `${absLat}° ${latHemisphere}, ${absLng}° ${lngHemisphere}`;
}
