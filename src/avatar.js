// 數位人：以 three.js 幾何體即時建模（不需外部模型檔），含嘴型、眨眼、手勢與狀態
let mods = null;
async function loadThree() {
  if (!mods) {
    const THREE = await import("three");
    mods = { THREE };
  }
  return mods;
}

const SKIN = 0xf2c9a4, HOOD = 0x2f6f6a, HOOD_DARK = 0x1f4a47, GOLD = 0xd8b45a, HAIR = 0x2b2b33, EYE = 0x1b2430;

export class DigitalHuman {
  constructor({ canvas, bubbleEl }) {
    this.canvas = canvas;
    this.bubble = bubbleEl;
    this.state = "idle"; // idle | listening | thinking | talking | happy
    this.mouth = 0;
    this.targetMouth = 0;
    this.blink = 0;
    this.nextBlink = 1.5;
    this.t = 0;
    this.gesture = null;
    this.pulse = 0;
    this.ready = false;
    this.visible = true;
  }

  async init() {
    const { THREE } = await loadThree();
    this.THREE = THREE;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    camera.position.set(0, 1.62, 3.05);
    camera.lookAt(0, 1.42, 0);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2620, 1.15));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.1);
    key.position.set(1.6, 3.2, 2.4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd0ff, 0.75);
    rim.position.set(-2, 1.6, -1.6);
    scene.add(rim);

    const mat = (color, rough = 0.62, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const root = new THREE.Group();
    scene.add(root);
    this.root = root;

    // 身體
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 6, 20), mat(HOOD, 0.72));
    body.position.y = 0.92;
    body.scale.set(1, 1, 0.82);
    root.add(body);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 10, 26), mat(GOLD, 0.35, 0.55));
    collar.position.set(0, 1.2, 0.02);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1, 0.75, 1);
    root.add(collar);
    // 胸前蓮花徽章
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.085, 5), mat(GOLD, 0.3, 0.6));
    badge.position.set(0, 1.02, 0.35);
    root.add(badge);

    // 頭
    const head = new THREE.Group();
    head.position.y = 1.55;
    root.add(head);
    this.head = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), mat(SKIN, 0.7));
    skull.scale.set(0.96, 1.04, 0.94);
    head.add(skull);
    // 頭髮／兜帽
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.312, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(HOOD_DARK, 0.8));
    hood.position.y = 0.028;
    hood.scale.set(1.0, 1.02, 1.0);
    head.add(hood);
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1), mat(HAIR, 0.85));
    fringe.position.set(0, 0.245, 0.22);
    fringe.rotation.x = 0.25;
    head.add(fringe);
    // 眼睛
    const mkEye = (x) => {
      const g = new THREE.Group();
      g.position.set(x, 0.045, 0.262);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 16), mat(0xfdfdff, 0.35));
      white.scale.set(1, 1.06, 0.6);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 12), mat(EYE, 0.4));
      pupil.position.z = 0.032;
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.058, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(SKIN, 0.7));
      lid.position.y = 0.012;
      lid.scale.set(1, 1.06, 0.62);
      g.add(white, pupil, lid);
      g.userData.lid = lid;
      return g;
    };
    this.eyeL = mkEye(-0.105);
    this.eyeR = mkEye(0.105);
    head.add(this.eyeL, this.eyeR);
    // 眉毛
    const brow = (x) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.022, 0.03), mat(HAIR, 0.9));
      b.position.set(x, 0.128, 0.265);
      b.rotation.z = x < 0 ? 0.12 : -0.12;
      return b;
    };
    head.add(brow(-0.105), brow(0.105));
    // 嘴巴
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), mat(0x8d3b3b, 0.55));
    mouth.position.set(0, -0.105, 0.253);
    mouth.scale.set(1, 0.26, 0.5);
    head.add(mouth);
    this.mouthMesh = mouth;
    const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), mat(0xd4607a, 0.6));
    tongue.position.set(0, -0.122, 0.262);
    tongue.scale.set(1, 0.3, 0.5);
    head.add(tongue);
    this.tongue = tongue;
    // 耳機（聽的時候發光）
    const mkPhone = (x) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 18), mat(GOLD, 0.35, 0.5));
      p.rotation.z = Math.PI / 2;
      p.position.set(x, 0.03, 0);
      return p;
    };
    head.add(mkPhone(-0.3), mkPhone(0.3));
    // 手臂
    const mkArm = (side) => {
      const g = new THREE.Group();
      g.position.set(side * 0.42, 1.12, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.34, 4, 14), mat(HOOD, 0.72));
      upper.position.y = -0.2;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 18, 14), mat(SKIN, 0.7));
      hand.position.y = -0.42;
      g.add(upper, hand);
      g.userData.hand = hand;
      return g;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    root.add(this.armL, this.armR);

    // 思考中的三個點
    const dots = new THREE.Group();
    dots.position.set(0, 2.02, 0);
    this.dots = [];
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), mat(GOLD, 0.4));
      d.position.x = (i - 1) * 0.13;
      dots.add(d);
      this.dots.push(d);
    }
    dots.visible = false;
    root.add(dots);
    this.dotGroup = dots;

    // 聽語音的脈衝環
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.018, 8, 40), new THREE.MeshBasicMaterial({ color: 0x6fb2d2, transparent: true, opacity: 0.75 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.55;
    ring.visible = false;
    root.add(ring);
    this.ring = ring;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas.parentElement);
    this.ro = ro;
    this.resize();
    this.ready = true;
    renderer.setAnimationLoop((t) => this.tick(t / 1000));
    return this;
  }

  resize() {
    if (!this.renderer) return;
    const el = this.canvas.parentElement;
    const w = el.clientWidth || 200, h = el.clientHeight || 200;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    if (!this.ready) return;
    this.dotGroup.visible = s === "thinking";
    this.ring.visible = s === "listening";
    if (s === "happy") this.gesture = { type: "wave", t: 0, dur: 1.4 };
    if (s === "talking") this.gesture = { type: "talk", t: 0, dur: 2 };
  }

  say(text, { ms = 3200 } = {}) {
    if (!this.bubble) return;
    this.bubble.textContent = text;
    this.bubble.classList.add("on");
    clearTimeout(this._bubbleTimer);
    this._bubbleTimer = setTimeout(() => this.bubble.classList.remove("on"), ms);
  }

  /** 朗讀時驅動嘴型：依字詞界線與節奏隨機開合 */
  talkTick(intensity = 1) {
    this.targetMouth = (0.35 + Math.random() * 0.65) * intensity;
  }

  tick(t) {
    if (!this.ready) return;
    const dt = Math.min(0.05, t - (this._last ?? t));
    this._last = t;
    this.t += dt;

    // 嘴型平滑
    if (this.state === "talking") {
      if (Math.random() < 0.35) this.talkTick(0.85 + Math.random() * 0.3);
      this.targetMouth *= 0.82;
    } else {
      this.targetMouth = this.state === "happy" ? 0.5 : 0;
    }
    this.mouth += (this.targetMouth - this.mouth) * Math.min(1, dt * 16);
    const m = Math.max(0.06, this.mouth);
    this.mouthMesh.scale.set(0.86 + m * 0.34, 0.2 + m * 0.95, 0.5);
    this.tongue.scale.set(1, 0.24 + m * 0.4, 0.5);
    this.tongue.visible = m > 0.25;

    // 眨眼
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blink = 1; this.nextBlink = 1.8 + Math.random() * 3.4; }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lidY = this.blink > 0 ? 1 - this.blink : 1;
    for (const e of [this.eyeL, this.eyeR]) e.userData.lid.scale.set(1, 1.06 * lidY, 0.62);

    // 待機動作
    const idle = this.state === "idle" || this.state === "happy";
    this.root.position.y = Math.sin(this.t * 1.5) * 0.016 + (this.state === "listening" ? -0.015 : 0);
    this.head.rotation.z = Math.sin(this.t * 0.85) * 0.05;
    this.head.rotation.x = (this.state === "listening" ? 0.1 : 0) + Math.sin(this.t * 1.1) * 0.025;
    this.head.rotation.y = Math.sin(this.t * 0.6) * 0.1;
    this.armL.rotation.z = 0.12 + Math.sin(this.t * 1.3) * 0.06;
    this.armR.rotation.z = -0.12 - Math.sin(this.t * 1.3) * 0.06;

    // 手勢
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt;
      const p = Math.min(1, g.t / g.dur);
      const swing = Math.sin(p * Math.PI);
      if (g.type === "wave") {
        this.armR.rotation.z = -0.12 - swing * 1.5;
        this.armR.rotation.x = -swing * 0.4;
        this.armR.position.y = 1.12 + swing * 0.22;
      } else {
        this.armR.rotation.z = -0.12 - swing * 0.7;
        this.armR.rotation.x = -swing * 0.55;
      }
      if (p >= 1) {
        this.gesture = null;
        this.armR.rotation.set(0, 0, -0.12);
        this.armR.position.y = 1.12;
      }
    }

    // 思考點
    if (this.dotGroup.visible) {
      this.dots.forEach((d, i) => {
        d.position.y = Math.sin(this.t * 3 + i * 0.7) * 0.07;
        d.material.opacity = 0.5 + 0.5 * Math.sin(this.t * 3 + i * 0.7);
      });
      this.dotGroup.rotation.y = Math.sin(this.t * 0.8) * 0.35;
    }
    // 聆聽脈衝
    if (this.ring.visible) {
      this.pulse += dt * 2.2;
      const s = 1 + (Math.sin(this.pulse) + 1) * 0.12;
      this.ring.scale.set(s, s, s);
      this.ring.material.opacity = 0.35 + 0.4 * (Math.sin(this.pulse * 1.4) + 1) / 2;
    }
    this.renderer.render(this.scene, this.camera);
  }

  setVisible(on) {
    this.visible = on;
    if (this.canvas.parentElement) this.canvas.parentElement.style.display = on ? "" : "none";
  }
}
