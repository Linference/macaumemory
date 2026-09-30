// 三維文物模型檢視器（three.js，按需載入）
let mods = null;
async function loadThree() {
  if (!mods) {
    const [THREE, { GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
      import("three"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/loaders/DRACOLoader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/environments/RoomEnvironment.js"),
    ]);
    mods = { THREE, GLTFLoader, DRACOLoader, MeshoptDecoder, OrbitControls, RoomEnvironment };
  }
  return mods;
}

const fmtMB = (b) => `${(b / 1048576).toFixed(b > 10485760 ? 0 : 1)} MB`;
const fmtTri = (n) => `${n >= 10000 ? Math.round(n / 1000) + " 千" : n}`;

export class ModelViewer {
  constructor({ root, canvas, loadingEl, loadingTextEl, barEl, badgeEl, nameEl, metaEl, factsEl }) {
    Object.assign(this, { root, canvas, loadingEl, loadingTextEl, barEl, badgeEl, nameEl, metaEl, factsEl });
    this.current = null;
    this.triangles = null;
    this.disposed = false;
    this.autoRotate = true;
    this.wireframe = false;
    this.onKey = (e) => { if (e.key === "Escape" && this.isOpen) this.close(); };
  }

  get isOpen() { return this.root.classList.contains("open"); }

  async open({ title, subtitle, dimensions, triangles, files, sizes, facts, description, kind, realWorldScale, source }) {
    this.triangles = triangles ?? null;
    this.kind = kind ?? "artifact";
    this.realWorldScale = realWorldScale !== false;
    this.root.classList.add("open");
    this.root.setAttribute("aria-hidden", "false");
    this.nameEl.textContent = title;
    this.metaEl.textContent = subtitle ?? "";
    this.badgeEl.innerHTML = "";
    this.factsEl.innerHTML = this.renderFacts({ dimensions, triangles, sizes, facts, description, title, subtitle, kind, realWorldScale, source });
    this.loadingEl.classList.remove("gone");
    this.barEl.style.width = "0%";
    this.loadingTextEl.textContent = "正在準備三維場景…";
    window.addEventListener("keydown", this.onKey);

    const { THREE, GLTFLoader, DRACOLoader, MeshoptDecoder, OrbitControls, RoomEnvironment } = await loadThree();
    this.THREE = THREE;
    this.setupScene({ THREE, OrbitControls, RoomEnvironment });
    await this.loadModels({ THREE, GLTFLoader, DRACOLoader, MeshoptDecoder, files });
  }

  setupScene({ THREE, OrbitControls, RoomEnvironment }) {
    if (this.renderer) this.disposeScene();
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 400);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x2b2620, 0.55));
    const key = new THREE.DirectionalLight(0xfff1da, 2.35);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0008;
    scene.add(key);
    this.keyLight = key;
    const rim = new THREE.DirectionalLight(0x86b6ff, 0.75);
    scene.add(rim);
    this.rimLight = rim;

    this.group = new THREE.Group();
    scene.add(this.group);

    // 展台
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1.04, 0.03, 96),
      new THREE.MeshStandardMaterial({ color: 0x141a21, roughness: 0.85, metalness: 0.1 })
    );
    pedestal.receiveShadow = true;
    pedestal.position.y = -0.015;
    this.pedestal = pedestal;
    scene.add(pedestal);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.02, 1.045, 96),
      new THREE.MeshBasicMaterial({ color: 0xd8b45a, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    this.ring = ring;
    scene.add(ring);

    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.85;
    this.controls.zoomSpeed = 0.9;
    this.controls.autoRotateSpeed = 0.9;
    this.controls.autoRotate = this.autoRotate;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement);
    this.resize();

    renderer.setAnimationLoop(() => {
      this.controls.update();
      renderer.render(scene, camera);
    });
  }

  async loadModels({ THREE, GLTFLoader, DRACOLoader, MeshoptDecoder, files }) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(new URL("draco/", document.baseURI).href);
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.loader = loader;
    this.draco = draco;

    const load = (url, label) => new Promise((resolve, reject) => {
      loader.load(url, resolve, (ev) => {
        const pct = ev.total ? (ev.loaded / ev.total) * 100 : Math.min(96, (ev.loaded / 1048576) * 6);
        this.barEl.style.width = `${Math.min(99, pct).toFixed(1)}%`;
        this.loadingTextEl.textContent = `正在載入${label}… ${fmtMB(ev.loaded)}`;
      }, reject);
    });

    try {
      this.loadingTextEl.textContent = "正在載入快速預覽模型…";
      const lodGltf = await load(files.lod ?? files.full, "快速預覽模型");
      if (this.disposed) return;
      this.lodObject = this.prepareModel(lodGltf.scene, THREE);
      this.group.add(this.lodObject);
      this.frameToModel(this.lodObject);
      this.loadingEl.classList.add("gone");
      this.badgeEl.textContent = "快速預覽模型 · 高精度版本載入中…";
    } catch (e) {
      console.error(e);
      this.loadingTextEl.textContent = "模型載入失敗，請稍後再試";
      return;
    }

    if (files.full && files.full !== files.lod) {
      try {
        const fullGltf = await load(files.full, "高精度模型");
        if (this.disposed) return;
        const full = this.prepareModel(fullGltf.scene, THREE);
        this.group.add(full);
        this.group.remove(this.lodObject);
        this.disposeObject(this.lodObject);
        this.lodObject = null;
        this.fullObject = full;
        this.badgeEl.textContent = this.kind === "building"
          ? `建築三維模型 · ${fmtTri(this.triangles ?? 0)}面 · ${this.realWorldScale ? "1:1" : "AI 生成（非實測比例）"}`
          : `高精度掃描模型 · ${fmtTri(this.triangles ?? 0)}面 · 1:1 尺度`;
        this.applyWireframe();
      } catch (e) {
        console.warn("高精度模型載入失敗，保留快速預覽版本", e);
        this.badgeEl.textContent = "高精度版本載入失敗 · 目前顯示快速預覽模型";
      }
    }
  }

  prepareModel(root, THREE) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      if (m) {
        // 掃描檔的 KHR_materials_specular 常帶有 >1 的高光係數，這裡調回合理範圍
        if (m.specularColor?.isColor) m.specularColor.setRGB(Math.min(1, m.specularColor.r), Math.min(1, m.specularColor.g), Math.min(1, m.specularColor.b));
        if (m.specularIntensity !== undefined && m.specularIntensity > 1) m.specularIntensity = 1;
        if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.15);
        m.envMapIntensity = 0.55;
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
    return root;
  }

  frameToModel(object) {
    const { THREE, camera, controls, keyLight, rimLight, pedestal, ring } = this;
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const fitH = size.y / (2 * Math.tan(vFov / 2));
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fitW = Math.max(size.x, size.z) / (2 * Math.tan(hFov / 2));
    const dist = Math.max(fitH, fitW) * 1.18 + maxDim * 0.1;

    camera.position.set(dist * 0.58, size.y * 0.62 + maxDim * 0.3, dist * 0.82);
    camera.near = maxDim * 0.02;
    camera.far = maxDim * 60;
    camera.updateProjectionMatrix();
    controls.target.set(0, size.y * 0.48, 0);
    controls.minDistance = maxDim * 0.55;
    controls.maxDistance = maxDim * 7;
    controls.update();

    const lightDist = maxDim * 2.6;
    keyLight.position.set(lightDist * 0.8, lightDist * 1.15, lightDist * 0.7);
    keyLight.target.position.set(0, size.y * 0.5, 0);
    keyLight.target.updateMatrixWorld();
    keyLight.shadow.camera.left = -maxDim * 1.1;
    keyLight.shadow.camera.right = maxDim * 1.1;
    keyLight.shadow.camera.top = maxDim * 1.4;
    keyLight.shadow.camera.bottom = -maxDim * 0.6;
    keyLight.shadow.camera.near = maxDim * 0.3;
    keyLight.shadow.camera.far = maxDim * 8;
    keyLight.shadow.camera.updateProjectionMatrix();
    rimLight.position.set(-lightDist * 0.8, lightDist * 0.9, -lightDist * 0.9);

    const r = Math.max(size.x, size.z) * 0.95 + maxDim * 0.08;
    pedestal.scale.set(r, 1, r);
    ring.scale.set(r, r, r);
    this.modelSize = size;
  }

  renderFacts({ dimensions, triangles, sizes, facts, description, title, subtitle, kind, realWorldScale, source }) {
    const dim = dimensions
      ? `${(dimensions[1] * 100).toFixed(0)} × ${(dimensions[2] * 100).toFixed(0)} × ${(dimensions[0] * 100).toFixed(0)} cm`
      : "—";
    const rows = [
      ["模型尺寸", dim + (realWorldScale === false ? "（AI 生成，非實際比例）" : "")],
      ["網格密度", triangles ? `${Number(triangles).toLocaleString()} 個三角面` : "—"],
      ["檔案大小", sizes?.full ? fmtMB(sizes.full) : "—"],
    ];
    return `
      <h3>${subtitle ?? ""}</h3>
      <h2 class="v-title">${title ?? ""}</h2>
      ${source ? `<div class="v-sub">${source}</div>` : ""}
      ${description ? `<div class="desc">${description}</div>` : ""}
      <h3>模型規格</h3>
      <div class="fact-grid">${rows.map(([k, val]) => `<div class="fact">${k}：<b>${val}</b></div>`).join("")}</div>
      ${facts?.length ? `<h3>看點</h3><ul class="fact-list">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>` : ""}
      <h3>操作</h3>
      <ul class="fact-list">
        <li>拖曳：旋轉視角　滾輪／雙指：縮放</li>
        <li>右下工具列：自動旋轉、重設視角、線框模式、全螢幕</li>
        <li>${kind === "building" ? "建築模型由使用者提供之 AI 三維生成檔案轉換" : "掃描模型經簡化與壓縮處理"}</li>
      </ul>`;
  }

  setWireframe(on) { this.wireframe = on; this.applyWireframe(); }
  applyWireframe() {
    for (const o of [this.lodObject, this.fullObject]) {
      o?.traverse((n) => { if (n.isMesh && n.material) n.material.wireframe = this.wireframe; });
    }
  }
  setAutoRotate(on) { this.autoRotate = on; if (this.controls) this.controls.autoRotate = on; }
  resetView() { if (this.fullObject ?? this.lodObject) this.frameToModel(this.fullObject ?? this.lodObject); }

  resize() {
    if (!this.renderer || !this.camera) return;
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  disposeObject(obj) {
    obj?.traverse((n) => {
      if (n.isMesh) {
        n.geometry?.dispose?.();
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of mats) {
          if (!m) continue;
          for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "specularMap"]) m[k]?.dispose?.();
          m.dispose?.();
        }
      }
    });
  }

  disposeScene() {
    this.renderer?.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.disposeObject(this.lodObject);
    this.disposeObject(this.fullObject);
    this.scene?.traverse((n) => { if (n.isMesh) n.geometry?.dispose?.(); });
    this.scene?.environment?.dispose?.();
    this.controls?.dispose?.();
    this.renderer?.dispose?.();
    this.renderer = null; this.scene = null; this.controls = null; this.camera = null;
    this.lodObject = null; this.fullObject = null;
  }

  close() {
    this.disposed = true;
    window.removeEventListener("keydown", this.onKey);
    this.root.classList.remove("open");
    this.root.setAttribute("aria-hidden", "true");
    // 延遲釋放，避免關閉動畫期間閃爍
    setTimeout(() => {
      this.disposeScene();
      this.disposed = false;
    }, 260);
  }
}
