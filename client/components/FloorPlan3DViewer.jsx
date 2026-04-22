import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { X } from "lucide-react";

// ─── Scene constants ──────────────────────────────────────────────────────────
const WALL_H      = 2.6;
const WALL_T      = 0.18;
const DOOR_W      = 0.90;
const DOOR_H      = 2.1;
const WINDOW_W    = 1.0;
const WINDOW_H    = 1.2;
const WINDOW_SILL = 0.9;

const FLOOR_COLORS = { wood: 0xD4B896, tile: 0xC2D0DB, other: 0xD8D0C0 };
const WALL_COLOR   = 0xF5F1EC;
const BASE_COLOR   = 0xE8E4DC;
const DOOR_COLOR   = 0xC4A46A;

// ─── addBox ───────────────────────────────────────────────────────────────────
function addBox(scene, mat, cx, cy, cz, w, h, d, rotY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(cx, cy, cz);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ─── Wall builder with doors + windows ───────────────────────────────────────
// Fix Issue #4 (window artifacts): removed incorrect frame forEach.
// Fix Issue #3 (doors invisible): added colored door panel.
function buildWall(scene, wallMat, x1, z1, x2, z2, openings) {
  const dx  = x2 - x1, dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.01) return;
  const angle = Math.atan2(-dz, dx);

  const sorted = [...openings].sort((a, b) => a.position - b.position);
  const cuts = [];
  let cursor = 0;

  for (const op of sorted) {
    const opW  = op.type === 'door' ? DOOR_W : WINDOW_W;
    const opS  = Math.max(0, op.position * len - opW / 2);
    const opE  = Math.min(len, opS + opW);
    if (opS > cursor) cuts.push({ start: cursor, end: opS, type: null });
    cuts.push({ start: opS, end: opE, type: op.type });
    cursor = opE;
  }
  if (cursor < len) cuts.push({ start: cursor, end: len, type: null });

  const doorMat = new THREE.MeshLambertMaterial({ color: DOOR_COLOR });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xB8D8F4, transparent: true, opacity: 0.32,
    roughness: 0.05, metalness: 0.08, side: THREE.DoubleSide,
  });

  for (const cut of cuts) {
    const sl = Math.max(0, cut.end - cut.start);
    if (sl < 0.005) continue;
    const t  = (cut.start + cut.end) / 2 / len;
    const cx = x1 + dx * t, cz = z1 + dz * t;

    if (!cut.type) {
      // Solid wall
      addBox(scene, wallMat, cx, WALL_H / 2, cz, sl, WALL_H, WALL_T, angle);

    } else if (cut.type === 'door') {
      // Lintel above door
      const lh = WALL_H - DOOR_H;
      if (lh > 0.02) addBox(scene, wallMat, cx, DOOR_H + lh / 2, cz, sl, lh, WALL_T, angle);
      // Door panel — warm wood color, slightly thinner than wall
      const panel = new THREE.Mesh(new THREE.BoxGeometry(sl * 0.96, DOOR_H * 0.99, WALL_T * 0.40), doorMat);
      panel.position.set(cx, DOOR_H / 2, cz);
      panel.rotation.y = angle;
      panel.castShadow = true;
      scene.add(panel);

    } else if (cut.type === 'window') {
      // Below sill
      if (WINDOW_SILL > 0.02) addBox(scene, wallMat, cx, WINDOW_SILL / 2, cz, sl, WINDOW_SILL, WALL_T, angle);
      // Above window
      const ah = WALL_H - WINDOW_SILL - WINDOW_H;
      if (ah > 0.02) addBox(scene, wallMat, cx, WINDOW_SILL + WINDOW_H + ah / 2, cz, sl, ah, WALL_T, angle);
      // Glass pane only — wall itself acts as the frame, no extra geometry needed
      const glass = new THREE.Mesh(new THREE.BoxGeometry(sl, WINDOW_H, WALL_T * 0.18), glassMat);
      glass.position.set(cx, WINDOW_SILL + WINDOW_H / 2, cz);
      glass.rotation.y = angle;
      scene.add(glass);
    }
  }
}

// ─── Furniture 3D ─────────────────────────────────────────────────────────────
const FURN_META = {
  bed:          { color: 0xD4C4B0, style: 'bed'    },
  wardrobe:     { color: 0x8B7355, h: 1.90, style: 'box'    },
  side_table:   { color: 0xAA9570, h: 0.55, style: 'box'    },
  sofa:         { color: 0x8A9FB0, style: 'sofa'   },
  armchair:     { color: 0x8A9FB0, style: 'sofa'   },
  coffee_table: { color: 0xA09070, h: 0.42, style: 'box'    },
  tv_unit:      { color: 0x353535, h: 0.40, style: 'box'    },
  dining_table: { color: 0xB08860, h: 0.76, style: 'box'    },
  chair:        { color: 0x9A8070, h: 0.45, style: 'chair'  },
  sink:         { color: 0xCCCCCC, h: 0.90, style: 'box'    },
  stove:        { color: 0x181818, h: 0.90, style: 'box'    },
  fridge:       { color: 0xDCDCE8, h: 1.75, style: 'box'    },
  cabinet:      { color: 0x9B8060, h: 0.90, style: 'box'    },
  toilet:       { color: 0xF0EDE8, style: 'toilet' },
  basin:        { color: 0xDDDDDD, h: 0.88, style: 'box'    },
  shower:       { color: 0xB8D8F0, style: 'flat'   },
  bathtub:      { color: 0xC8E0F8, h: 0.40, style: 'box'    },
};

function mk(geo, color) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function buildFurniture3D(scene, furniture) {
  for (const f of furniture) {
    const meta = FURN_META[f.type] ?? FURN_META.side_table;
    const rot  = ((f.rotation || 0) * Math.PI) / 180;
    // Effective world dimensions after rotation
    const effW = Math.abs(Math.cos(rot)) > 0.5 ? f.w : f.d;
    const effD = Math.abs(Math.cos(rot)) > 0.5 ? f.d : f.w;
    const cx   = f.x + effW / 2;
    const cz   = f.z + effD / 2;
    const w = f.w, d = f.d;

    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rot;

    if (meta.style === 'bed') {
      const frame = mk(new THREE.BoxGeometry(w, 0.15, d), 0x8A6A40);
      frame.position.set(0, 0.075, 0); g.add(frame);
      const matt = mk(new THREE.BoxGeometry(w * 0.95, 0.22, d * 0.78), 0xECE4D8);
      matt.position.set(0, 0.26, d * 0.04); g.add(matt);
      const head = mk(new THREE.BoxGeometry(w * 0.97, 0.58, d * 0.10), 0x7A6040);
      head.position.set(0, 0.50, -d * 0.44); g.add(head);
      const pGeo = new THREE.BoxGeometry(w * 0.32, 0.07, d * 0.17);
      [-w * 0.2, w * 0.2].forEach(ox => {
        const pil = mk(pGeo, 0xF8F4EE);
        pil.position.set(ox, 0.415, -d * 0.20); g.add(pil);
      });
      const duvet = mk(new THREE.BoxGeometry(w * 0.94, 0.08, d * 0.52), 0xDDD8D0);
      duvet.position.set(0, 0.40, d * 0.10); g.add(duvet);

    } else if (meta.style === 'sofa') {
      const armW = Math.min(d * 0.14, 0.18);
      mk(new THREE.BoxGeometry(w, 0.12, d), 0x607080).position.set(0, 0.06, 0);
      const base = mk(new THREE.BoxGeometry(w, 0.12, d), 0x607080);
      base.position.set(0, 0.06, 0); g.add(base);
      const seat = mk(new THREE.BoxGeometry(w, 0.28, d * 0.60), meta.color);
      seat.position.set(0, 0.26, d * 0.06); g.add(seat);
      const back = mk(new THREE.BoxGeometry(w, 0.42, d * 0.17), meta.color);
      back.position.set(0, 0.55, -d * 0.27); g.add(back);
      [-(w / 2 - armW / 2), (w / 2 - armW / 2)].forEach(ox => {
        const arm = mk(new THREE.BoxGeometry(armW, 0.36, d * 0.60), meta.color);
        arm.position.set(ox, 0.24, d * 0.05); g.add(arm);
      });

    } else if (meta.style === 'chair') {
      const seat = mk(new THREE.BoxGeometry(w * 0.88, 0.06, d * 0.88), 0xB0A090);
      seat.position.set(0, 0.44, 0); g.add(seat);
      const back = mk(new THREE.BoxGeometry(w * 0.88, 0.34, 0.05), 0xB0A090);
      back.position.set(0, 0.62, -d * 0.42); g.add(back);
      [[-w * 0.38, -d * 0.38], [w * 0.38, -d * 0.38], [-w * 0.38, d * 0.38], [w * 0.38, d * 0.38]].forEach(([lx, lz]) => {
        const leg = mk(new THREE.BoxGeometry(0.04, 0.44, 0.04), 0x806050);
        leg.position.set(lx, 0.22, lz); g.add(leg);
      });

    } else if (meta.style === 'toilet') {
      const bowl = mk(new THREE.BoxGeometry(w * 0.86, 0.30, d * 0.62), meta.color);
      bowl.position.set(0, 0.15, d * 0.10); g.add(bowl);
      const tank = mk(new THREE.BoxGeometry(w * 0.78, 0.36, d * 0.22), meta.color);
      tank.position.set(0, 0.33, -d * 0.36); g.add(tank);
      const seatTop = mk(new THREE.BoxGeometry(w * 0.80, 0.03, d * 0.56), 0xE8E5E0);
      seatTop.position.set(0, 0.315, d * 0.10); g.add(seatTop);

    } else if (meta.style === 'flat') {
      const flat = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshLambertMaterial({ color: meta.color, transparent: true, opacity: 0.55 })
      );
      flat.rotation.x = -Math.PI / 2;
      flat.position.set(0, 0.02, 0);
      g.add(flat);
      // Simple glass walls for shower
      const gMat = new THREE.MeshStandardMaterial({ color: 0xB8D8F0, transparent: true, opacity: 0.22, roughness: 0.05 });
      [[w, 0.65, 0.03, 0, 0.34, d / 2], [w, 0.65, 0.03, 0, 0.34, -d / 2], [0.03, 0.65, d, w / 2, 0.34, 0]].forEach(([gw, gh, gd, gx, gy, gz]) => {
        const gw2 = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), gMat);
        gw2.position.set(gx, gy, gz); g.add(gw2);
      });

    } else {
      // Generic box
      const h2 = meta.h ?? 0.80;
      const box = mk(new THREE.BoxGeometry(w, h2, d), meta.color);
      box.position.set(0, h2 / 2, 0); g.add(box);
    }

    scene.add(g);
  }
}

// ─── Scene builder ────────────────────────────────────────────────────────────
function buildScene(container, layout) {
  const W = container.clientWidth;
  const H = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace  = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1f2e);
  scene.fog = new THREE.FogExp2(0x1a1f2e, 0.007);

  const bW = layout.floor?.w || layout.boundingBox?.width  || 10;
  const bH = layout.floor?.h || layout.boundingBox?.height || 8;
  const cx = bW / 2, cz = bH / 2;

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 300);

  // ── Lighting ──────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xFFF5E0, 0xC8B898, 0.55));
  scene.add(new THREE.AmbientLight(0xFFFAF0, 0.52));

  const sun = new THREE.DirectionalLight(0xFFFEF8, 1.30);
  sun.position.set(cx + 10, 22, cz - 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0015;
  const sc2 = Math.max(bW, bH) + 8;
  Object.assign(sun.shadow.camera, { left: -sc2, right: sc2, top: sc2, bottom: -sc2, near: 0.5, far: 100 });
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xC8D8FF, 0.38);
  fill.position.set(cx - 10, 9, cz + 12);
  scene.add(fill);

  // ── Materials ─────────────────────────────────────────────────────────────
  const wallMat = new THREE.MeshLambertMaterial({ color: WALL_COLOR });

  // ── Base floor — covers ENTIRE floor area (Fix Issue #2: missing floor) ───
  // Placed at Y = 0 with renderOrder so room floors render on top.
  const baseGeo = new THREE.PlaneGeometry(bW, bH);
  const baseMat = new THREE.MeshLambertMaterial({ color: BASE_COLOR });
  const base    = new THREE.Mesh(baseGeo, baseMat);
  base.rotation.x    = -Math.PI / 2;
  base.position.set(bW / 2, 0, bH / 2);
  base.receiveShadow = true;
  base.renderOrder   = 0;
  scene.add(base);

  // ── Room floors (sit on top of base floor) ────────────────────────────────
  for (const room of (layout.rooms || [])) {
    const color  = FLOOR_COLORS[room.floor] ?? FLOOR_COLORS.other;
    const floorM = new THREE.MeshLambertMaterial({ color });
    const floorG = new THREE.PlaneGeometry(room.w - 0.02, room.d - 0.02);
    const floorP = new THREE.Mesh(floorG, floorM);
    floorP.rotation.x    = -Math.PI / 2;
    floorP.position.set(room.x + room.w / 2, 0.001, room.z + room.d / 2);
    floorP.receiveShadow = true;
    floorP.renderOrder   = 1;
    scene.add(floorP);
  }

  // ── Openings map ──────────────────────────────────────────────────────────
  const byWall = {};
  for (const op of (layout.openings || [])) {
    if (!byWall[op.wall_id]) byWall[op.wall_id] = [];
    byWall[op.wall_id].push(op);
  }

  // ── Walls ─────────────────────────────────────────────────────────────────
  for (const wall of (layout.walls || [])) {
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    if (Math.sqrt(dx * dx + dz * dz) < 0.25) continue;
    buildWall(scene, wallMat,
      wall.start[0], wall.start[1],
      wall.end[0],   wall.end[1],
      byWall[wall.id] || []);
  }

  // ── Furniture ─────────────────────────────────────────────────────────────
  buildFurniture3D(scene, layout.furniture || []);

  // ── Shadow catcher ────────────────────────────────────────────────────────
  const sG = new THREE.Mesh(
    new THREE.PlaneGeometry(bW + 24, bH + 24),
    new THREE.ShadowMaterial({ opacity: 0.10 })
  );
  sG.rotation.x = -Math.PI / 2;
  sG.position.set(cx, -0.02, cz);
  sG.receiveShadow = true;
  scene.add(sG);

  // ── Grid ─────────────────────────────────────────────────────────────────
  const gs = Math.max(bW, bH) + 10;
  const grid = new THREE.GridHelper(gs, Math.round(gs * 2), 0x263040, 0x263040);
  grid.position.set(cx, -0.01, cz);
  scene.add(grid);

  // ── Orbit camera ─────────────────────────────────────────────────────────
  const target = new THREE.Vector3(cx, WALL_H * 0.25, cz);
  const diag   = Math.sqrt(bW ** 2 + bH ** 2);
  let radius = diag * 1.35, theta = Math.PI * 0.85, phi = Math.PI * 0.28;

  const syncCam = () => {
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(target);
  };
  syncCam();

  let drag = false, lx = 0, ly = 0;
  const onD = e => { drag = true; lx = e.clientX; ly = e.clientY; };
  const onU = ()  => { drag = false; };
  const onM = e  => {
    if (!drag) return;
    theta -= (e.clientX - lx) * 0.006;
    phi    = Math.max(0.05, Math.min(Math.PI / 2 - 0.04, phi + (e.clientY - ly) * 0.006));
    lx = e.clientX; ly = e.clientY; syncCam();
  };
  const onW = e  => { radius = Math.max(diag * 0.28, Math.min(diag * 3.0, radius + e.deltaY * 0.03)); syncCam(); };
  const onR = () => { camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); };

  container.addEventListener('mousedown', onD);
  window.addEventListener   ('mouseup',   onU);
  window.addEventListener   ('mousemove', onM);
  container.addEventListener('wheel',     onW, { passive: true });
  window.addEventListener   ('resize',    onR);

  let rafId;
  const animate = () => { rafId = requestAnimationFrame(animate); renderer.render(scene, camera); };
  animate();

  return () => {
    cancelAnimationFrame(rafId);
    container.removeEventListener('mousedown', onD);
    window.removeEventListener   ('mouseup',   onU);
    window.removeEventListener   ('mousemove', onM);
    container.removeEventListener('wheel',     onW);
    window.removeEventListener   ('resize',    onR);
    renderer.dispose();
    if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function FloorPlan3DViewer({ sourceImage, renderedImage, layout, mode = 'fullscreen', onClose }) {
  const mountRef   = useRef(null);
  const runningRef = useRef(false);
  const [phase,  setPhase]  = useState('idle');
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    // Direct layout from editor — no API call
    if (layout) {
      if (!layout.rooms?.length || !layout.walls?.length) return;
      let cancelled = false, cleanup = null;
      (async () => {
        setPhase('building');
        await new Promise(r => setTimeout(r, 40));
        if (cancelled || !mountRef.current) return;
        try { cleanup = buildScene(mountRef.current, layout); if (!cancelled) setPhase('ready'); }
        catch (e) { if (!cancelled) { setPhase('error'); setErrMsg(e.message); } }
      })();
      return () => { cancelled = true; cleanup?.(); };
    }

    // Image analysis path (uploaded floor plans)
    const img = sourceImage || renderedImage;
    if (!img) return;
    let cancelled = false, cleanup = null;
    (async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      setPhase('analyzing');
      let dataUrl = img;
      if (!img.startsWith('data:')) {
        try {
          const res  = await fetch(img, { credentials: 'include' });
          const blob = await res.blob();
          dataUrl    = await new Promise((ok, rej) => { const r = new FileReader(); r.onloadend = () => ok(r.result); r.onerror = rej; r.readAsDataURL(blob); });
        } catch { if (!cancelled) { setPhase('error'); setErrMsg('Failed to load image.'); } return; }
      }
      let ly2;
      try {
        const res = await fetch('/api/analyze', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceImage: dataUrl }) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Analyze failed (${res.status})`); }
        ly2 = (await res.json()).layout;
      } catch (e) { if (!cancelled) { setPhase('error'); setErrMsg(e.message); } return; }
      if (cancelled) return;
      if (!ly2?.rooms?.length || !ly2?.walls?.length) { if (!cancelled) { setPhase('error'); setErrMsg('Could not extract layout.'); } return; }
      setPhase('building');
      await new Promise(r => setTimeout(r, 40));
      if (cancelled || !mountRef.current) return;
      try { cleanup = buildScene(mountRef.current, ly2); if (!cancelled) setPhase('ready'); }
      catch (e) { if (!cancelled) { setPhase('error'); setErrMsg(e.message); } }
    })();
    return () => { cancelled = true; cleanup?.(); runningRef.current = false; };
  }, [sourceImage, renderedImage, layout]);

  const isFS = mode === 'fullscreen';
  return (
    <div style={{ position: isFS ? 'fixed' : 'relative', inset: isFS ? 0 : undefined, width: isFS ? undefined : '100%', height: isFS ? undefined : '420px', background: '#1a1f2e', zIndex: isFS ? 1000 : undefined, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'rgba(0,0,0,0.5)', flexShrink: 0 }}>
        <div>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 14, fontFamily: 'Inter, sans-serif' }}>3D View</span>
          {phase === 'ready' && <span style={{ color: '#64748b', fontSize: 12, marginLeft: 10, fontFamily: 'Inter, sans-serif' }}>Drag to rotate · Scroll to zoom</span>}
        </div>
        {onClose && (
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
            <X size={13} /> Close
          </button>
        )}
      </div>
      {phase !== 'ready' && (
        <div style={{ position: 'absolute', inset: 0, top: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, background: '#1a1f2e', zIndex: 10 }}>
          {phase === 'error' ? (
            <>
              <span style={{ color: '#f87171', fontSize: 14, fontFamily: 'Inter, sans-serif' }}>Failed to build 3D model</span>
              <span style={{ color: '#64748b', fontSize: 12, textAlign: 'center', maxWidth: 300, fontFamily: 'Inter, sans-serif' }}>{errMsg}</span>
            </>
          ) : (
            <>
              <div style={{ width: 28, height: 28, border: `2px solid ${phase === 'building' ? '#22c55e33' : '#ffffff22'}`, borderTopColor: phase === 'building' ? '#22c55e' : '#ffffff', borderRadius: '50%', animation: 'spin3d 0.85s linear infinite' }} />
              <span style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>{phase === 'analyzing' ? 'Extracting layout…' : 'Building 3D model…'}</span>
            </>
          )}
        </div>
      )}
      <div ref={mountRef} style={{ flex: 1, overflow: 'hidden' }} />
      <style>{`@keyframes spin3d { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
