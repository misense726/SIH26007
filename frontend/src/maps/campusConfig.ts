import type { GeoCoordinates } from "./locationProvider";

export interface MapTileLayer {
  name: string;
  url: string;
  subdomains: string[];
  attribution: string;
  maxZoom: number;
}

export interface CampusMapConfig {
  campusName: string;
  locationLabel: string;
  locationCode: string;
  siteCenter: GeoCoordinates;
  anchor: GeoCoordinates;
  defaultZoom: number;
  minimapZoom: number;
  extendedZoom: number;
  maxZoom: number;
  minZoom: number;
  tiles: MapTileLayer;
}

export const ROAD_MAP_TILES: MapTileLayer = {
  name: "Road map",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  subdomains: [],
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 18,
};

// A transparent fallback prevents browser image errors from covering the route.
export const EMPTY_MAP_TILE =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

/**
 * The local Cartesian origin is tied to the V699+X9 Chennai site. The anchor is
 * offset slightly west so the canonical route starts on the nearest mapped
 * campus road while remaining inside the requested site area.
 */
export const DEFAULT_CAMPUS_CONFIG: CampusMapConfig = {
  campusName: "FogSen Chennai route",
  locationLabel: "V699+X9, Chennai, Tamil Nadu",
  locationCode: "V699+X9",
  siteCenter: {
    lat: 12.86965,
    lng: 80.219921875,
  },
  anchor: {
    lat: 12.8696442659944,
    lng: 80.2197883739638,
    altitude_m: 18.0,
  },
  defaultZoom: 17,
  minimapZoom: 17,
  extendedZoom: 17,
  minZoom: 15,
  maxZoom: 18,
  tiles: ROAD_MAP_TILES,
};
