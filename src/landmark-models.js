import { MercatorCoordinate } from "maplibre-gl";
import { parseLandmarkPlacements, replacementFilter } from "./landmark-placement.js";

/** Optional surveyed GLBs drawn directly into the map's shared WebGL context. */
export async function installLandmarkModels(map, attractions, { visible = true } = {}) {
  const response = await fetch(new URL("models/landmarks.json", document.baseURI));
  if (!response.ok) throw new Error(`landmarks.json HTTP ${response.status}`);
  const placements = parseLandmarkPlacements(await response.json(), attractions);
  if (!placements.length) return { setVisible() {}, status: [] };
  const [THREE, { GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three"), import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/loaders/DRACOLoader.js"), import("three/addons/libs/meshopt_decoder.module.js"),
  ]);
  let removed = false, renderFailed = false, renderer;
  const status = placements.map((p) => ({ ...p, loaded: false, error: null }));
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x71808f, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(-70, 130, 100); scene.add(sun);
  const draco = new DRACOLoader().setDecoderPath(new URL("draco/", document.baseURI).href);
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const bases = new Map(["buildings", "building-outline"].filter((id) => map.getLayer(id)).map((id) => [id, map.getFilter(id) ?? null]));
  let filterKey = "";
  const updateFilter = () => {
    if (removed) return;
    const key = JSON.stringify(status.filter((p) => visible && p.loaded && map.getZoom() >= p.minZoom).flatMap((p) => p.buildingIds));
    if (key === filterKey) return;
    filterKey = key;
    for (const [id, base] of bases) if (map.getLayer(id)) map.setFilter(id, replacementFilter(base, status, map.getZoom(), visible));
  };
  const disposeObject = (object) => object.traverse((o) => {
    o.geometry?.dispose();
    for (const material of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
  const loadObject = async (p, file) => {
    const gltf = await loader.loadAsync(new URL(file, document.baseURI).href);
    if (removed || renderFailed) { disposeObject(gltf.scene); return false; }
    const root = new THREE.Group(); root.matrixAutoUpdate = false; root.add(gltf.scene);
    if (p.object) { scene.remove(p.object); disposeObject(p.object); }
    p.object = root; p.loaded = true; scene.add(root);
    console.info(`[landmark ${p.id}] loaded ${file}`);
    updateFilter(); map.triggerRepaint();
    return true;
  };
  const loadNearbyDetail = () => {
    if (removed || !visible) return;
    for (const p of status) {
      if (!p.lodFile || !p.loaded || p.detailLoaded || p.detailLoading || p.detailError || map.getZoom() < p.detailZoom || !map.getBounds().contains(p.coords)) continue;
      p.detailLoading = true;
      loadObject(p, p.file).then((loaded) => { p.detailLoaded = loaded; }).catch((error) => {
        p.detailError = error.message;
        console.warn(`[landmark ${p.id}] detail failed; keeping preview`, error);
      }).finally(() => { p.detailLoading = false; });
    }
  };
  const layer = {
    id: "landmark-models", type: "custom", renderingMode: "3d",
    onAdd(_map, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl, args) {
      if (renderFailed) return;
      try {
      const zoom = map.getZoom();
      const sceneOrigin = MercatorCoordinate.fromLngLat(placements[0].coords, 0);
      const originScale = sceneOrigin.meterInMercatorCoordinateUnits();
      for (const p of status) {
        if (!p.object) continue;
        p.object.visible = visible && zoom >= p.minZoom;
        if (!p.object.visible) continue;
        const terrain = map.queryTerrainElevation(p.coords) ?? 0;
        const origin = MercatorCoordinate.fromLngLat(p.coords, terrain + p.altitudeM);
        const scale = origin.meterInMercatorCoordinateUnits() / originScale * p.metersPerUnit;
        // GLTF Y-up: X east, Y up, Z south. Rotation is in model space; anchor is the surveyed ground point.
        const local = new THREE.Matrix4().makeTranslation((origin.x - sceneOrigin.x) / originScale, origin.z / originScale, (origin.y - sceneOrigin.y) / originScale)
          .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
          .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...p.rotationDeg.map(THREE.MathUtils.degToRad), "XYZ")))
          .multiply(new THREE.Matrix4().makeTranslation(-p.anchor[0], -p.anchor[1], -p.anchor[2]));
        p.object.matrix.copy(local);
        p.object.matrixWorldNeedsUpdate = true;
      }
      // Merge the geographic origin on the CPU, keeping GPU model coordinates in meters.
      // This avoids loss of precision from tiny GLB coordinates beside ~0.8 Mercator values.
      const sceneTransform = new THREE.Matrix4().makeTranslation(sceneOrigin.x, sceneOrigin.y, sceneOrigin.z)
        .multiply(new THREE.Matrix4().makeScale(originScale, -originScale, originScale))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(sceneTransform);
      renderer.resetState();
      renderer.render(scene, camera);
      // Static scene: repaint only when the map moves/terrain changes or a model finishes loading.
      } catch (error) {
        renderFailed = true;
        for (const p of status) { p.loaded = false; p.error = `Rendering failed: ${error.message}`; }
        updateFilter();
        console.warn("[landmarks] rendering failed; restoring whiteboxes", error);
        map.triggerRepaint();
      }
    },
    onRemove() {
      removed = true;
      map.off("zoom", updateFilter);
      map.off("moveend", loadNearbyDetail);
      for (const [id, base] of bases) if (map.getLayer(id)) map.setFilter(id, base);
      for (const p of status) if (p.object) disposeObject(p.object);
      draco.dispose(); renderer?.dispose(); // Do not lose the map's shared WebGL context.
    },
  };
  map.addLayer(layer);
  map.on("zoom", updateFilter);
  map.on("moveend", loadNearbyDetail);
  const ready = Promise.all(status.map(async (p) => {
    try {
      await loadObject(p, p.lodFile ?? p.file);
      p.detailLoaded = !p.lodFile;
      loadNearbyDetail();
    } catch (error) {
      p.error = error.message;
      console.warn(`[landmark ${p.id}] model failed; retaining whitebox`, error);
    }
  }));
  return { status, ready, setVisible(value) { visible = !!value; updateFilter(); loadNearbyDetail(); map.triggerRepaint(); } };
}
