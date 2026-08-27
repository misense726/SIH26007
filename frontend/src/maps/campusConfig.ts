import type { GeoCoordinates } from "./locationProvider";

export interface CampusPoi {
  id: string;
  name: string;
  category: "GATE" | "BUILDING" | "DEPOT" | "HAZARD" | "CHECKPOINT";
  coordinates: GeoCoordinates;
  description?: string;
}

export interface CampusMapConfig {
  campusName: string;
  anchor: GeoCoordinates;
  defaultZoom: number;
  minimapZoom: number;
  extendedZoom: number;
  maxZoom: number;
  minZoom: number;
  tiles: {
    url: string;
    subdomains: string[];
    attribution: string;
    maxZoom: number;
  };
  pois: CampusPoi[];
}

/**
 * Configurable Campus Map Configuration.
 * Anchored at a high-detail college campus test location.
 * Coordinates and POIs can be freely replaced or configured via environment/props.
 */
export const DEFAULT_CAMPUS_CONFIG: CampusMapConfig = {
  campusName: "FogSen Campus Test Facility",
  anchor: {
    lat: 28.5458,
    lng: 77.1926,
    altitude_m: 218.0,
  },
  defaultZoom: 17,
  minimapZoom: 18,
  extendedZoom: 17,
  minZoom: 14,
  maxZoom: 20,
  tiles: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    subdomains: ["a", "b", "c", "d"],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>',
    maxZoom: 19,
  },
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
      name: "Mining & Autonomous Systems Lab",
      category: "BUILDING",
      coordinates: { lat: 28.5461, lng: 77.1932 },
      description: "Teleoperation Command Center",
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
      description: "Low-visibility corridor entrance",
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
      // GeoJSON coordinates are [lng, lat] -> convert to Leaflet [lat, lng]
      const coords = data.routes[0].geometry.coordinates as [number, number][];
      return coords.map(([lng, lat]) => [lat, lng]);
    }
    return null;
  } catch {
    return null;
  }
}
