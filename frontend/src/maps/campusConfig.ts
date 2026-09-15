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
 * The local Cartesian origin is tied to the NMDC Bailadila iron ore mining
 * complex in Dantewada district, Chhattisgarh. The anchor sits on the haul
 * road between Deposit-14 and the Kirandul rail loading point.
 */
export const DEFAULT_CAMPUS_CONFIG: CampusMapConfig = {
  campusName: "NMDC Bailadila iron ore mines",
  locationLabel: "Bailadila, Dantewada, Chhattisgarh",
  locationCode: "Bailadila",
  siteCenter: {
    lat: 18.6731,
    lng: 81.2481,
  },
  anchor: {
    lat: 18.6731,
    lng: 81.2481,
    altitude_m: 920.0,
  },
  defaultZoom: 15,
  minimapZoom: 15,
  extendedZoom: 14,
  minZoom: 12,
  maxZoom: 18,
  tiles: ROAD_MAP_TILES,
};
