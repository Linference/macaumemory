// MapLibre 樣式：以 OpenStreetMap 向量圖資 + 開放 DEM 構成 3D 立體澳門
export const COLORS = {
  sea: "#0a1a26",
  land: "#232a2e",
  gold: "#d8b45a",
  accent: "#6fb2d2",
};

// 建築高度：優先序為 ①實測高度 h（OSM／Overture，7,158 棟）
//   ②樓層數 lv × 3.2（Overture num_floors／OSM building:levels）
//   ③面積推估高度（由 scripts/build-buildings.mjs 以冪律模型 h≈k_type·面積^0.25 產生，
//      在 7,157 棟實測建築上做 80/20 驗證：MAE 14.6 m，優於類型固定值的 21.4 m）
//   ④最後才退回類型固定值（舊資料相容用）
export const BUILDING_HEIGHT = [
  "coalesce",
  ["get", "h"],
  ["*", ["get", "lv"], 3.2],
  ["match", ["get", "t"],
    ["house", "detached", "bungalow", "static_caravan", "cabin"], 6.5,
    ["garage", "garages", "shed", "hut", "carport", "garage_boxes", "roof"], 3.4,
    ["apartments", "residential", "dormitory", "terrace", "barracks"], 21,
    ["commercial", "retail", "office", "supermarket", "kiosk", "hotel"], 26,
    ["industrial", "warehouse", "factory"], 12,
    ["church", "chapel", "cathedral", "temple", "mosque", "synagogue", "shrine", "monastery"], 14,
    ["school", "university", "college", "kindergarten", "hospital", "civic", "public", "government", "museum", "train_station", "transportation"], 16,
    ["construction", "ruins"], 8,
    ["yes"], 13,
    12,
  ],
];

export const BUILDING_COLOR = [
  "match", ["get", "t"],
  ["house", "detached", "bungalow", "cabin"], "#d3c1a5",
  ["apartments", "residential", "dormitory", "terrace", "barracks"], "#c2b39b",
  ["commercial", "retail", "office", "supermarket", "hotel", "kiosk"], "#9fb2c4",
  ["industrial", "warehouse", "factory", "roof", "garage", "garages", "shed", "hut"], "#8b98a4",
  ["church", "chapel", "cathedral", "temple", "mosque", "synagogue", "shrine", "monastery"], "#dcc48c",
  ["school", "university", "college", "hospital", "museum", "civic", "public", "government"], "#cbc0a8",
  ["construction", "ruins"], "#7d8a95",
  ["yes"], "#bdb3a2",
  "#b8ae9c",
];

// 沒有類型資料的建築（多為 ML 推估足跡）依高度給色，讓天際線有層次而不是一片同色
export const BUILDING_COLOR_BY_HEIGHT = [
  "interpolate", ["linear"], ["get", "h"],
  0, "#a79d8b", 12, "#b2a895", 30, "#bdb3a0", 60, "#c9c0ae", 120, "#d6cebe", 250, "#e3ddd0",
];

export function buildStyle() {
  return {
    version: 8,
    name: "澳門立體誌",
    sources: {
      dem: {
        type: "raster-dem",
        tiles: ["dem/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        minzoom: 10,
        maxzoom: 15,
      },
      "dem-hillshade": {
        type: "raster-dem",
        tiles: ["dem/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        minzoom: 10,
        maxzoom: 15,
      },
      buildings: { type: "geojson", data: "data/macau-buildings.geojson", promoteId: "bid", maxzoom: 19, tolerance: 0.1 },
      roads: { type: "geojson", data: "data/macau-roads.geojson" },
      rail: { type: "geojson", data: "data/macau-rail.geojson" },
      landuse: { type: "geojson", data: "data/macau-landuse.geojson" },
      water: { type: "geojson", data: "data/macau-water.geojson" },
      waterways: { type: "geojson", data: "data/macau-waterways.geojson" },
      coastline: { type: "geojson", data: "data/macau-coastline.geojson" },
      boundary: { type: "geojson", data: "data/macau-boundary.geojson" },
      bus: { type: "geojson", data: "data/macau-bus.geojson" },
    },
    sky: {
      "sky-color": "#0a141f",
      "horizon-color": "#243c50",
      "fog-color": "#0d1a25",
      "sky-horizon-blend": 0.55,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.16,
    },
    light: { anchor: "map", position: [1.35, 178, 38], intensity: 0.55, color: "#fff3dd" },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": COLORS.land } },
      { id: "hillshade", type: "hillshade", source: "dem-hillshade", paint: { "hillshade-exaggeration": 0.42, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "rgba(255,240,214,0.42)", "hillshade-accent-color": "#1b2a33" } },
      { id: "landuse-fill", type: "fill", source: "landuse", paint: {
        "fill-color": ["match", ["get", "c"],
          ["park", "garden", "grass", "grassland", "recreation_ground", "village_green", "common", "playground", "pitch", "sports_centre", "stadium", "golf_course", "nature_reserve", "greenfield", "meadow", "cemetery", "grave_yard"], "#35603f",
          ["wood", "forest", "scrub", "trees", "shrub", "heath", "rough"], "#2b4a34",
          ["sand", "beach"], "#b9a377",
          ["wetland"], "#33514d",
          ["residential"], "#262c30",
          ["commercial", "retail"], "#2e3338",
          ["industrial", "railway", "quarry", "landfill", "construction", "brownfield"], "#36322c",
          ["bunker", "military"], "#383d41",
          ["barren", "bare_rock", "crop", "farmland", "orchard", "vineyard"], "#454130",
          ["university", "college", "school", "hospital"], "#4a483f",
          ["parking"], "#2f353b",
          ["marina"], "#173744",
          "#2b3135"],
        "fill-opacity": 0.55,
      } },
      { id: "water-fill", type: "fill", source: "water", paint: { "fill-color": ["case", ["==", ["get", "sea"], 1], COLORS.sea, "#14364a"], "fill-opacity": 0.96 } },
      { id: "coastline", type: "line", source: "coastline", paint: { "line-color": "#7fb2c9", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 16, 1.4], "line-opacity": 0.5 } },
      { id: "waterway", type: "line", source: "waterways", paint: { "line-color": "#3d7ea0", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 16, 1.6], "line-opacity": 0.7 } },


      { id: "buildings", type: "fill-extrusion", source: "buildings", paint: {
        "fill-extrusion-color": ["case", ["has", "t"], BUILDING_COLOR, BUILDING_COLOR_BY_HEIGHT],
        "fill-extrusion-height": BUILDING_HEIGHT,
        "fill-extrusion-base": ["coalesce", ["get", "mh"], 0],
        "fill-extrusion-opacity": 0.96,
        "fill-extrusion-vertical-gradient": true,
      } },
      // 建築輪廓：拉近時畫出邊線，讓密集街區的界線清楚（純視覺，不影響資料）
      { id: "building-outline", type: "line", source: "buildings", minzoom: 14.5, paint: {
        "line-color": "#0c1218",
        "line-width": ["interpolate", ["linear"], ["zoom"], 14.5, 0.25, 16, 0.6, 18, 1.1],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0.18, 16, 0.34, 18, 0.5],
      } },

      { id: "road-casing", type: "line", source: "roads", filter: ["all", ["!", ["has", "b"]], ["match", ["get", "c"], ["motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link"], true, false]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#10161c", "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 11, 1.2, 14, 3.2, 17, 9], "line-opacity": 0.5 } },
      { id: "road", type: "line", source: "roads", layout: { "line-cap": "round", "line-join": "round" }, paint: {
        "line-color": ["match", ["get", "c"],
          ["motorway", "trunk"], "#e8b567",
          ["primary", "motorway_link", "trunk_link", "primary_link"], "#d9b070",
          ["secondary"], "#c3b48d",
          ["tertiary"], "#b0ac9c",
          ["residential", "unclassified", "living_street", "service"], "#8b939c",
          ["pedestrian", "footway", "path", "steps"], "#6f7a84",
          "#98a0a8"],
        "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 11, 0.5, 13, 1.1, 15, 2.4, 17, 6.5],
        "line-opacity": ["match", ["get", "c"], ["footway", "path", "steps", "service"], 0.35, 0.88],
        "line-dasharray": ["match", ["get", "c"], ["footway", "path", "steps"], ["literal", [2, 2]], ["literal", [1, 0]]],
      } },
      { id: "rail", type: "line", source: "rail", filter: ["match", ["get", "c"], ["light_rail", "rail", "subway", "tram", "monorail", "narrow_gauge"], true, false], paint: { "line-color": "#7fd3ff", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 3], "line-opacity": 0.85, "line-dasharray": [3, 2] } },

      { id: "bus-stop", type: "circle", source: "bus", minzoom: 14, layout: { visibility: "none" }, paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.6, 17, 5.5],
        "circle-color": "#7ee787", "circle-stroke-color": "#0b1117", "circle-stroke-width": 1.2,
        "circle-opacity": 0.95,
      } },
      { id: "boundary-fill", type: "fill", source: "boundary", filter: ["==", ["get", "k"], "sar"], paint: { "fill-color": COLORS.gold, "fill-opacity": 0.045 } },
      { id: "boundary-line", type: "line", source: "boundary", filter: ["==", ["get", "k"], "sar"], paint: { "line-color": COLORS.gold, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 16, 2.2], "line-opacity": 0.75, "line-dasharray": [3, 1.6] } },
    ],
  };
}




// 等高線（4.3 MB）改為第一次開啟圖層時才載入，避免拖慢啟動
export function addContourLayers(map) {
  if (map.getSource("contours")) return;
  map.addSource("contours", { type: "geojson", data: "data/macau-dem-contours.geojson" });
  const before = map.getLayer("buildings") ? "buildings" : undefined;
  map.addLayer({
    id: "contour",
    type: "line",
    source: "contours",
    filter: ["!=", ["%", ["get", "e"], 50], 0],
    paint: { "line-color": "#6d8f7c", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.35, 16, 0.9], "line-opacity": 0.52 },
  }, before);
  map.addLayer({
    id: "contour-50",
    type: "line",
    source: "contours",
    filter: ["==", ["%", ["get", "e"], 50], 0],
    paint: { "line-color": "#b99a5b", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.7, 16, 1.6], "line-opacity": 0.7 },
  }, before);
}
