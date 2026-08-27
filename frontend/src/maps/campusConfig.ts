import type { GeoCoordinates } from "./locationProvider";

export interface CampusPoi {
  id: string;
  name: string;
  category: "GATE" | "BUILDING" | "DEPOT" | "HAZARD" | "CHECKPOINT";
  coordinates: GeoCoordinates;
  description?: string;
}

export interface MapTileLayer {
  name: string;
  url: string;
  subdomains: string[];
  attribution: string;
  maxZoom: number;
}

export interface CampusMapConfig {
  campusName: string;
  anchor: GeoCoordinates;
  defaultZoom: number;
  minimapZoom: number;
  extendedZoom: number;
  maxZoom: number;
  minZoom: number;
  tiles: MapTileLayer;
  pois: CampusPoi[];
}

/**
 * 100% Free, Zero-API-Key, High-Performance Tile Providers.
 */
export const MAP_TILE_PRESETS: Record<"satellite" | "dark" | "street", MapTileLayer> = {
  satellite: {
    name: "Satellite Aerial",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    attribution: "&copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 20,
  },
  dark: {
    name: "Dark Tactical",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    attribution: "&copy; Esri &copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
  street: {
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    subdomains: [],
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
};

/**
 * Configurable Campus Map Configuration.
 * Anchored at a high-detail test campus location.
 */
export const DEFAULT_CAMPUS_CONFIG: CampusMapConfig = {
  campusName: "FogSen Test Facility & Campus",
  anchor: {
    lat: 28.5458,
    lng: 77.1926,
    altitude_m: 218.0,
  },
  defaultZoom: 18,
  minimapZoom: 18,
  extendedZoom: 17,
  minZoom: 13,
  maxZoom: 20,
  tiles: MAP_TILE_PRESETS.satellite,
  pois: [
    {
      id: "poi-gate-1",
      name: "Main Campus Gate",
      category: "GATE",
      coordinates: { lat: 28.5453, lng: 77.1918 },
      description: "Entry / Exit Access Control",
    },
    {
      id: "poi-engineering",
      name: "Autonomous Systems Center",
      category: "BUILDING",
      coordinates: { lat: 28.5461, lng: 77.1932 },
      description: "Teleoperation & Telemetry Hub",
    },
    {
      id: "poi-depot",
      name: "Fleet Depot & Workshop",
      category: "DEPOT",
      coordinates: { lat: 28.5451, lng: 77.1934 },
      description: "Vehicle staging and sensor calibration bay",
    },
    {
      id: "poi-pit-junction",
      name: "Haul Road Checkpoint",
      category: "CHECKPOINT",
      coordinates: { lat: 28.5468, lng: 77.1924 },
      description: "Low-visibility haul corridor entrance",
    },
  ],
};

/**
 * Helper to fetch calculated routes from OSRM demo server
 */
export async function fetchOsrmRoute(
  start: GeoCoordinates,
  end: GeoCoordinates,
): Promise<[number, number][] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code === "Ok" && data.routes && data.routes.length > 0) {
      const coords = data.routes[0].geometry.coordinates as [number, number][];
      return coords.map(([lng, lat]) => [lat, lng]);
    }
    return null;
  } catch {
    return null;
  }
}
