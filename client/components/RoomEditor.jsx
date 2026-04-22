import { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { LayoutGrid, Armchair, DoorOpen, AppWindow, PenTool, MousePointer2, RotateCw, Trash2, Undo2, Redo2, ChevronDown, ChevronUp } from 'lucide-react';

// ─── Room types (no "other") ──────────────────────────────────────────────────
const ROOM_TYPES = [
  { value: 'bedroom',  label: 'Bedroom',     floor: 'wood', fill: '#C8A882', dark: '#5A3A1A' },
  { value: 'bathroom', label: 'Bathroom',    floor: 'tile', fill: '#9BBDD4', dark: '#2A5A7A' },
  { value: 'living',   label: 'Living Room', floor: 'wood', fill: '#D4B896', dark: '#6A4A1A' },
  { value: 'kitchen',  label: 'Kitchen',     floor: 'tile', fill: '#B8D4B8', dark: '#2A5A2A' },
  { value: 'dining',   label: 'Dining',      floor: 'wood', fill: '#D0B8A0', dark: '#5A3A1A' },
  { value: 'hallway',  label: 'Hallway',     floor: 'tile', fill: '#C8C0B8', dark: '#4A4038' },
  { value: 'storage',  label: 'Storage',     floor: 'tile', fill: '#B8B8C0', dark: '#383848' },
  { value: 'utility',  label: 'Utility',     floor: 'tile', fill: '#C0C8B8', dark: '#3A4828' },
  { value: 'study',    label: 'Study',       floor: 'wood', fill: '#C8C0A8', dark: '#484020' },
];

// ─── Furniture catalogue ──────────────────────────────────────────────────────
const FURNITURE_TYPES = [
  { value: 'bed',          label: 'Bed',          w: 1.60, d: 2.00, color: '#D4C4B0', group: 'Bedroom'  },
  { value: 'wardrobe',     label: 'Wardrobe',     w: 1.20, d: 0.60, color: '#8B7355', group: 'Bedroom'  },
  { value: 'side_table',   label: 'Side Table',   w: 0.50, d: 0.50, color: '#AA9570', group: 'Bedroom'  },
  { value: 'sofa',         label: 'Sofa',         w: 2.20, d: 0.90, color: '#7A8FA0', group: 'Living'   },
  { value: 'armchair',     label: 'Armchair',     w: 0.85, d: 0.85, color: '#8090A8', group: 'Living'   },
  { value: 'coffee_table', label: 'Coffee Table', w: 1.10, d: 0.60, color: '#A09070', group: 'Living'   },
  { value: 'tv_unit',      label: 'TV Unit',      w: 1.50, d: 0.40, color: '#404040', group: 'Living'   },
  { value: 'dining_table', label: 'Dining Table', w: 1.60, d: 0.90, color: '#9A7850', group: 'Dining'   },
  { value: 'chair',        label: 'Chair',        w: 0.48, d: 0.48, color: '#8A7060', group: 'Dining'   },
  { value: 'sink',         label: 'Kitchen Sink', w: 0.60, d: 0.50, color: '#D0D0D0', group: 'Kitchen'  },
  { value: 'stove',        label: 'Stove',        w: 0.60, d: 0.60, color: '#282828', group: 'Kitchen'  },
  { value: 'fridge',       label: 'Fridge',       w: 0.65, d: 0.65, color: '#DCDCE8', group: 'Kitchen'  },
  { value: 'cabinet',      label: 'Cabinet',      w: 0.90, d: 0.50, color: '#8B7A5A', group: 'Kitchen'  },
  { value: 'toilet',       label: 'Toilet',       w: 0.50, d: 0.70, color: '#F0EDE8', group: 'Bathroom' },
  { value: 'basin',        label: 'Basin',        w: 0.55, d: 0.42, color: '#E0E0E0', group: 'Bathroom' },
  { value: 'shower',       label: 'Shower',       w: 0.90, d: 0.90, color: '#B8D8F0', group: 'Bathroom' },
  { value: 'bathtub',      label: 'Bathtub',      w: 0.75, d: 1.50, color: '#C8E0F8', group: 'Bathroom' },
];

const furnInfo = t => FURNITURE_TYPES.find(f => f.value === t) ?? FURNITURE_TYPES[0];
const typeInfo = t => ROOM_TYPES.find(r => r.value === t) ?? ROOM_TYPES[0];

// ─── Canvas / grid constants ──────────────────────────────────────────────────
const CANVAS_W   = 720;
const CANVAS_H   = 540;
const SNAP       = 0.5;   // grid snap for rooms (0.5 m)
const FURN_SNAP  = 0.1;   // fine snap for furniture (0.1 m = 10 cm)
const MIN_ROOM   = 0.5;
const HANDLE_R   = 6;
const FURN_INSET = 0.08;  // reduced from 0.14 so items sit closer to walls
// Wall-segment hover/click detection: pick threshold in world metres
const WALL_HIT   = 0.22;

// Fine snap helper used for all furniture operations
const snapFurn = v => Math.round(v / FURN_SNAP) * FURN_SNAP;

// Axis-aligned bounding-box overlap check (GAP = 0 → edge-touching is allowed,
// only actual intersection is blocked). This lets chairs sit flush against a
// dining table and side tables press against a bed.
const furnOverlap = (a, b) => {
  const EPS = 0.005; // 5 mm tolerance so snapped edges don't falsely collide
  const aw = (a.rotation || 0) % 180 === 0 ? a.w : a.d;
  const ad = (a.rotation || 0) % 180 === 0 ? a.d : a.w;
  const bw = (b.rotation || 0) % 180 === 0 ? b.w : b.d;
  const bd = (b.rotation || 0) % 180 === 0 ? b.d : b.w;
  return !(a.x + aw - EPS <= b.x || b.x + bw - EPS <= a.x ||
           a.z + ad - EPS <= b.z || b.z + bd - EPS <= a.z);
};

// ─── Unit system ──────────────────────────────────────────────────────────────
const FT = 3.281;
const toDisplay  = (m, u) => u === 'sqft' ? (m * FT).toFixed(1) : m.toFixed(1);
const unitLabel  = u => u === 'sqft' ? 'ft' : 'm';
const areaLabel  = u => u === 'sqft' ? 'ft²' : 'm²';
const toArea     = (w, h, u) => u === 'sqft' ? w * FT * h * FT : w * h;

// ─── Scale helpers ────────────────────────────────────────────────────────────
const computeScale = (fw, fh) => {
  const s = Math.min((CANVAS_W - 40) / fw, (CANVAS_H - 40) / fh);
  return { s, ox: (CANVAS_W - fw * s) / 2, oz: (CANVAS_H - fh * s) / 2 };
};
const toPx  = (u, sc) => u * sc.s + sc.ox;
const toPz  = (z, sc) => z * sc.s + sc.oz;
const toU   = (px, sc) => (px - sc.ox) / sc.s;
const toZ   = (pz, sc) => (pz - sc.oz) / sc.s;
const snapU = v => Math.round(v / SNAP) * SNAP;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Segment key (canonical) ─────────────────────────────────────────────────
const PREC = 4;
const segKey = (x1, z1, x2, z2) => {
  if (x1 > x2 + 1e-5 || (Math.abs(x1 - x2) < 1e-5 && z1 > z2 + 1e-5)) {
    [x1, x2] = [x2, x1]; [z1, z2] = [z2, z1];
  }
  return `${x1.toFixed(PREC)},${z1.toFixed(PREC)},${x2.toFixed(PREC)},${z2.toFixed(PREC)}`;
};

// ─── Shared segment detection (Fix Issue #1: increased tolerance) ─────────────
// Tolerance raised from 0.03 to 0.08 so slightly non-perfect room edges still
// detect adjacency and allow wall removal.
const ADJ = 0.08;
function getSharedSeg(r1, r2) {
  if (Math.abs((r1.x + r1.w) - r2.x) < ADJ) {
    const z1 = Math.max(r1.z, r2.z), z2 = Math.min(r1.z + r1.d, r2.z + r2.d);
    if (z2 - z1 > ADJ) return { x1: r1.x + r1.w, z1, x2: r1.x + r1.w, z2 };
  }
  if (Math.abs(r1.x - (r2.x + r2.w)) < ADJ) {
    const z1 = Math.max(r1.z, r2.z), z2 = Math.min(r1.z + r1.d, r2.z + r2.d);
    if (z2 - z1 > ADJ) return { x1: r1.x, z1, x2: r1.x, z2 };
  }
  if (Math.abs((r1.z + r1.d) - r2.z) < ADJ) {
    const x1 = Math.max(r1.x, r2.x), x2 = Math.min(r1.x + r1.w, r2.x + r2.w);
    if (x2 - x1 > ADJ) return { x1, z1: r1.z + r1.d, x2, z2: r1.z + r1.d };
  }
  if (Math.abs(r1.z - (r2.z + r2.d)) < ADJ) {
    const x1 = Math.max(r1.x, r2.x), x2 = Math.min(r1.x + r1.w, r2.x + r2.w);
    if (x2 - x1 > ADJ) return { x1, z1: r1.z, x2, z2: r1.z };
  }
  return null;
}

// ─── Interval-splitting wall collection ──────────────────────────────────────
// Root fix for Issues #1 and #2: instead of storing one entry per full room
// edge (which causes duplicate/overlapping walls when adjacent rooms have
// different sizes), we project every edge onto its axis-aligned line, collect
// all intervals on that line, then split at every breakpoint.  Each resulting
// sub-segment is unique and stored exactly once, so:
//   • open-wall toggles work for ANY pair of adjacent rooms (not just same-size)
//   • doors only need to open the one sub-segment they sit on (no phantom wall)
function collectWallSegments(rooms) {
  // hLines: z-coord → [{a: x_start, b: x_end}]
  // vLines: x-coord → [{a: z_start, b: z_end}]
  const hLines = new Map(), vLines = new Map();
  for (const r of rooms) {
    const nz = r.z.toFixed(PREC),          sz = (r.z + r.d).toFixed(PREC);
    const wx = r.x.toFixed(PREC),          ex = (r.x + r.w).toFixed(PREC);
    if (!hLines.has(nz)) hLines.set(nz, []); if (!hLines.has(sz)) hLines.set(sz, []);
    if (!vLines.has(wx)) vLines.set(wx, []); if (!vLines.has(ex)) vLines.set(ex, []);
    hLines.get(nz).push({ a: r.x,     b: r.x + r.w });
    hLines.get(sz).push({ a: r.x,     b: r.x + r.w });
    vLines.get(wx).push({ a: r.z,     b: r.z + r.d });
    vLines.get(ex).push({ a: r.z,     b: r.z + r.d });
  }
  const segments = [];
  const splitLine = (intervals, makeCoords) => {
    const pts = new Set();
    for (const { a, b } of intervals) { pts.add(a); pts.add(b); }
    const sorted = [...pts].sort((p, q) => p - q);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (b - a < 0.01) continue;
      const mid = (a + b) / 2;
      if (intervals.some(iv => iv.a <= mid + 1e-5 && iv.b >= mid - 1e-5))
        segments.push(makeCoords(a, b));
    }
  };
  for (const [zk, ivs] of hLines) {
    const z = parseFloat(zk);
    splitLine(ivs, (a, b) => ({ x1: a, z1: z, x2: b, z2: z }));
  }
  for (const [xk, ivs] of vLines) {
    const x = parseFloat(xk);
    splitLine(ivs, (a, b) => ({ x1: x, z1: a, x2: x, z2: b }));
  }
  return segments;
}

// Enriches segments with isOpen flag for 2D canvas and 3D layout.
// No gap-suppression: every wall segment that comes from a room edge is a
// legitimate boundary wall and must be kept.  The interval-splitting in
// collectWallSegments already guarantees each sub-segment is unique, so there
// are no "phantom" duplicate walls even when adjacent rooms differ in size.
function getDrawSegments(rooms, openSegs) {
  return collectWallSegments(rooms).map(s => ({
    ...s, isOpen: openSegs.has(segKey(s.x1, s.z1, s.x2, s.z2))
  }));
}

// True if split segment s lies on any border edge of room r
function onRoomBorder(s, r) {
  const isH = Math.abs(s.z1 - s.z2) < 1e-5;
  if (isH) {
    const onN = Math.abs(s.z1 - r.z) < ADJ, onS = Math.abs(s.z1 - (r.z + r.d)) < ADJ;
    return (onN || onS) && s.x1 >= r.x - ADJ && s.x2 <= r.x + r.w + ADJ;
  }
  const onW = Math.abs(s.x1 - r.x) < ADJ, onE = Math.abs(s.x1 - (r.x + r.w)) < ADJ;
  return (onW || onE) && s.z1 >= r.z - ADJ && s.z2 <= r.z + r.d + ADJ;
}

// ─── Layout builder ───────────────────────────────────────────────────────────
function buildLayout(rooms, doors, windows, openSegs, furniture, floor) {
  if (!rooms.length) return null;
  // Interval-splitting guarantees each sub-segment appears exactly once even when
  // adjacent rooms are different sizes.  No gap-suppression needed — every wall
  // segment coming from a room edge is a legitimate boundary wall.
  const allSegs = collectWallSegments(rooms);
  let wid = 0;
  const walls = [], wallMap = new Map();
  for (const s of allSegs) {
    if (Math.hypot(s.x2 - s.x1, s.z2 - s.z1) < 0.25) continue;
    const k = segKey(s.x1, s.z1, s.x2, s.z2);
    if (openSegs.has(k)) continue; // user-opened → skip
    wallMap.set(k, wid);
    walls.push({ id: wid++, start: [s.x1, s.z1], end: [s.x2, s.z2] });
  }

  // Fix Issue #3 (doors not working in 3D):
  // Instead of looking up the exact full-edge segKey, project the door's world
  // position onto walls and find the matching segment. This handles cases where
  // rooms have different widths and the full-edge key doesn't match any wall.
  const openings = [];
  const placeOpening = (arr, type) => {
    for (const op of arr) {
      const r = rooms.find(rm => rm.id === op.roomId);
      if (!r) continue;
      let wx, wz;
      if      (op.wall === 'north') { wx = r.x + op.position * r.w; wz = r.z; }
      else if (op.wall === 'south') { wx = r.x + op.position * r.w; wz = r.z + r.d; }
      else if (op.wall === 'west')  { wx = r.x; wz = r.z + op.position * r.d; }
      else                          { wx = r.x + r.w; wz = r.z + op.position * r.d; }

      // Find the wall segment closest to (wx, wz)
      let bestId = -1, bestT = 0, bestDist = Infinity;
      for (const wall of walls) {
        const [ax, az] = wall.start, [bx, bz] = wall.end;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) continue;
        const t = ((wx - ax) * (bx - ax) + (wz - az) * (bz - az)) / (len * len);
        if (t < 0 || t > 1) continue;
        const projX = ax + t * (bx - ax), projZ = az + t * (bz - az);
        const dist  = Math.hypot(wx - projX, wz - projZ);
        if (dist < bestDist) { bestDist = dist; bestId = wall.id; bestT = t; }
      }
      if (bestId !== -1 && bestDist < 0.3) {
        openings.push({ type, wall_id: bestId, position: Math.max(0.06, Math.min(0.94, bestT)) });
      }
    }
  };
  placeOpening(doors,   'door');
  placeOpening(windows, 'window');

  const furnLayout = furniture.map(f => ({
    type: f.type, x: f.x, z: f.z, w: f.w, d: f.d, rotation: f.rotation || 0,
  }));

  let maxX = 0, maxZ = 0;
  for (const r of rooms) { maxX = Math.max(maxX, r.x + r.w); maxZ = Math.max(maxZ, r.z + r.d); }

  return {
    floor:       { w: floor.w, h: floor.h },
    boundingBox: { width: maxX, height: maxZ },
    rooms:       rooms.map(r => ({ name: r.name, x: r.x, z: r.z, w: r.w, d: r.d, floor: typeInfo(r.type).floor })),
    walls, openings, furniture: furnLayout,
  };
}

// ─── PNG export ───────────────────────────────────────────────────────────────
function exportPNG(rooms, doors, windows, openSegs, floor, furniture = []) {
  const EW = 900, EH = 700;
  const sc = computeScale(floor.w, floor.h);
  const sx = EW / CANVAS_W, sz = EH / CANVAS_H;
  const c = document.createElement('canvas'); c.width = EW; c.height = EH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, EW, EH);
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 0.5;
  for (let u = 0; u <= floor.w; u += SNAP) { ctx.beginPath(); ctx.moveTo(toPx(u, sc) * sx, 0); ctx.lineTo(toPx(u, sc) * sx, EH); ctx.stroke(); }
  for (let u = 0; u <= floor.h; u += SNAP) { ctx.beginPath(); ctx.moveTo(0, toPz(u, sc) * sz); ctx.lineTo(EW, toPz(u, sc) * sz); ctx.stroke(); }
  ctx.fillStyle = '#F0EDE8';
  ctx.fillRect(toPx(0, sc) * sx, toPz(0, sc) * sz, floor.w * sc.s * sx, floor.h * sc.s * sz);
  for (const r of rooms) { ctx.fillStyle = typeInfo(r.type).fill + 'cc'; ctx.fillRect(toPx(r.x, sc) * sx, toPz(r.z, sc) * sz, r.w * sc.s * sx, r.d * sc.s * sz); }
  for (const seg of getDrawSegments(rooms, openSegs)) {
    ctx.strokeStyle = seg.isOpen ? '#aaa' : '#1a1a1a';
    ctx.lineWidth = seg.isOpen ? 1 : 3;
    ctx.setLineDash(seg.isOpen ? [4, 4] : []);
    ctx.beginPath();
    ctx.moveTo(toPx(seg.x1, sc) * sx, toPz(seg.z1, sc) * sz);
    ctx.lineTo(toPx(seg.x2, sc) * sx, toPz(seg.z2, sc) * sz);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Furniture — render before labels so text sits on top
  for (const f of furniture) {
    const fi  = furnInfo(f.type);
    const ew  = (f.rotation || 0) % 180 === 0 ? f.w : f.d;
    const ed  = (f.rotation || 0) % 180 === 0 ? f.d : f.w;
    const fx  = toPx(f.x, sc) * sx;
    const fz  = toPz(f.z, sc) * sz;
    const fw2 = ew * sc.s * sx;
    const fd2 = ed * sc.s * sz;
    ctx.fillStyle   = fi.color + 'cc';
    ctx.strokeStyle = fi.color + '99';
    ctx.lineWidth   = 1;
    ctx.fillRect(fx, fz, fw2, fd2);
    ctx.strokeRect(fx, fz, fw2, fd2);
    if (fw2 > 20 && fd2 > 12) {
      const fs = Math.max(7, Math.min(10, Math.min(fw2, fd2) * 0.22));
      ctx.font = `${fs}px Inter, sans-serif`;
      ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(fi.label, fx + fw2 / 2, fz + fd2 / 2);
    }
  }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7;
  for (const op of [...doors, ...windows]) {
    const r = rooms.find(rm => rm.id === op.roomId); if (!r) continue;
    const dw = 0.9 * sc.s;
    if (op.wall === 'north' || op.wall === 'south') {
      const wz = (op.wall === 'north' ? toPz(r.z, sc) : toPz(r.z + r.d, sc)) * sz;
      const px = (toPx(r.x, sc) + r.w * sc.s * op.position) * sx;
      ctx.beginPath(); ctx.moveTo(px - dw * sx / 2, wz); ctx.lineTo(px + dw * sx / 2, wz); ctx.stroke();
    } else {
      const wx = (op.wall === 'west' ? toPx(r.x, sc) : toPx(r.x + r.w, sc)) * sx;
      const pz = (toPz(r.z, sc) + r.d * sc.s * op.position) * sz;
      ctx.beginPath(); ctx.moveTo(wx, pz - dw * sz / 2); ctx.lineTo(wx, pz + dw * sz / 2); ctx.stroke();
    }
  }
  for (const r of rooms) {
    const pw = r.w * sc.s * sx, pd = r.d * sc.s * sz;
    const fs = Math.max(9, Math.min(14, Math.min(pw, pd) * 0.22));
    ctx.font = `600 ${fs}px Inter, sans-serif`; ctx.fillStyle = typeInfo(r.type).dark;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(r.name, (toPx(r.x, sc) + r.w * sc.s / 2) * sx, (toPz(r.z, sc) + r.d * sc.s / 2) * sz);
  }
  return c.toDataURL('image/png');
}

// ─── Resize handles ────────────────────────────────────────────────────────────
const HANDLES = ['nw','n','ne','e','se','s','sw','w'];
const H_CURSOR = { nw:'nw-resize',n:'n-resize',ne:'ne-resize',e:'e-resize',se:'se-resize',s:'s-resize',sw:'sw-resize',w:'w-resize' };
function getHP(r, sc) {
  const rx = toPx(r.x, sc), rz = toPz(r.z, sc), rw = r.w * sc.s, rd = r.d * sc.s;
  return { nw:[rx,rz],n:[rx+rw/2,rz],ne:[rx+rw,rz],e:[rx+rw,rz+rd/2],se:[rx+rw,rz+rd],s:[rx+rw/2,rz+rd],sw:[rx,rz+rd],w:[rx,rz+rd/2] };
}
function hitHandle(room, mx, mz, sc) {
  const hp = getHP(room, sc);
  for (const h of HANDLES) { const [hx, hz] = hp[h]; if (Math.hypot(mx - hx, mz - hz) <= HANDLE_R + 3) return h; }
  return null;
}
function applyResize(handle, orig, dx, dz, floor) {
  let { x, z, w, d } = orig;
  if (handle==='nw'){x+=dx;z+=dz;w-=dx;d-=dz;} if (handle==='n'){z+=dz;d-=dz;}
  if (handle==='ne'){z+=dz;w+=dx;d-=dz;} if (handle==='e'){w+=dx;}
  if (handle==='se'){w+=dx;d+=dz;} if (handle==='s'){d+=dz;}
  if (handle==='sw'){x+=dx;w-=dx;d+=dz;} if (handle==='w'){x+=dx;w-=dx;}
  x=snapU(x);z=snapU(z);w=Math.max(MIN_ROOM,snapU(w));d=Math.max(MIN_ROOM,snapU(d));
  x=clamp(x,0,floor.w-MIN_ROOM);z=clamp(z,0,floor.h-MIN_ROOM);
  if(x+w>floor.w)w=floor.w-x;if(z+d>floor.h)d=floor.h-z;
  return{x,z,w,d};
}
function hitWall(room, u, v) {
  if (!room) return null;
  const relX = u - room.x, relZ = v - room.z;
  if (relX < 0 || relX > room.w || relZ < 0 || relZ > room.d) return null;
  const dN=relZ, dS=room.d-relZ, dW=relX, dE=room.w-relX;
  const mn = Math.min(dN, dS, dW, dE);
  const zone = Math.min(room.w, room.d) * 0.36;
  if (mn > zone) return null;
  if (mn===dN) return { wall:'north', position:Math.max(0.1,Math.min(0.9,relX/room.w)) };
  if (mn===dS) return { wall:'south', position:Math.max(0.1,Math.min(0.9,relX/room.w)) };
  if (mn===dW) return { wall:'west',  position:Math.max(0.1,Math.min(0.9,relZ/room.d)) };
  return               { wall:'east',  position:Math.max(0.1,Math.min(0.9,relZ/room.d)) };
}

// ─── Setup screen ─────────────────────────────────────────────────────────────
function SetupScreen({ onConfirm, onCancel }) {
  // Only square feet supported
  const unit = 'sqft';
  const [mode, setMode]     = useState('area');
  const [area, setArea]     = useState('800');
  const [width, setWidth]   = useState('30');
  const [height, setHeight] = useState('25');

  const confirm = () => {
    let fw, fh;
    if (mode === 'area') {
      const aSqM = (parseFloat(area) || 800) / 10.764;
      fw = Math.sqrt(aSqM * 4 / 3); fh = Math.sqrt(aSqM * 3 / 4);
    } else {
      fw = (parseFloat(width)  || 30) / FT;
      fh = (parseFloat(height) || 25) / FT;
    }
    fw = Math.round(clamp(fw, 3, 40) / 0.5) * 0.5;
    fh = Math.round(clamp(fh, 3, 40) / 0.5) * 0.5;
    onConfirm({ w: fw, h: fh }, unit);
  };

  const inp = { width:'100%', padding:'10px 12px', border:'1px solid #e4e4e7', borderRadius:6, fontSize:14, fontFamily:'"Instrument Serif", serif', outline:'none', boxSizing:'border-box', background:'#fff', color:'#000' };
  const tabBtn = active => ({ flex:1, padding:'9px 0', border:'1px solid #e4e4e7', borderRadius:6, cursor:'pointer', background:active?'#000':'#fff', color:active?'#fff':'#000', fontSize:13, fontFamily:'"Instrument Serif", serif', fontWeight:active?600:400 });

  return (
    <div
      style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100 }}
      onClick={onCancel}
    >
      <div
        style={{ background:'#fff',borderRadius:12,padding:40,width:460,boxShadow:'0 20px 60px rgba(0,0,0,0.15)',fontFamily:'"Instrument Serif", serif' }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin:'0 0 6px',fontSize:22,fontWeight:700,color:'#000' }}>Define Floor Area</h2>
        <p style={{ margin:'0 0 24px',fontSize:14,color:'#71717a' }}>Set the total floor dimensions before drawing rooms.</p>

        <div style={{ marginBottom:16 }}>
          <label style={{ display:'block',fontSize:11,fontWeight:600,color:'#71717a',textTransform:'uppercase',letterSpacing:0.8,marginBottom:8 }}>Input Method</label>
          <div style={{ display:'flex',gap:8 }}>
            <button onClick={() => setMode('area')}       style={tabBtn(mode === 'area')}>Total Area</button>
            <button onClick={() => setMode('dimensions')} style={tabBtn(mode === 'dimensions')}>Width × Height</button>
          </div>
        </div>

        {mode === 'area' ? (
          <div style={{ marginBottom:24 }}>
            <label style={{ display:'block',fontSize:11,fontWeight:600,color:'#71717a',textTransform:'uppercase',letterSpacing:0.8,marginBottom:8 }}>Area (ft²)</label>
            <input type="number" value={area} min="100" max="50000" onChange={e => setArea(e.target.value)} style={inp} placeholder="e.g. 800" />
          </div>
        ) : (
          <div style={{ marginBottom:24 }}>
            <label style={{ display:'block',fontSize:11,fontWeight:600,color:'#71717a',textTransform:'uppercase',letterSpacing:0.8,marginBottom:8 }}>Dimensions (ft)</label>
            <div style={{ display:'flex',gap:10,alignItems:'center' }}>
              <input type="number" value={width}  min="10" onChange={e => setWidth(e.target.value)}  style={inp} placeholder="Width (ft)" />
              <span style={{ color:'#a1a1aa',fontWeight:300,fontSize:18 }}>×</span>
              <input type="number" value={height} min="10" onChange={e => setHeight(e.target.value)} style={inp} placeholder="Height (ft)" />
            </div>
          </div>
        )}

        <button onClick={confirm} style={{ width:'100%',padding:'12px',background:'#000',color:'#fff',border:'none',borderRadius:8,fontWeight:600,fontSize:15,cursor:'pointer',fontFamily:'"Instrument Serif", serif' }}>
          Create Floor Plan
        </button>
        <p style={{ textAlign:'center',fontSize:12,color:'#a1a1aa',marginTop:14 }}>Grid snaps to 0.5 ft increments</p>
      </div>
    </div>
  );
}

// ─── Main Editor ─────────────────────────────────────────────────────────────
// initialState: optional serialized editor state from localStorage (for resume).
// draftKey:     user-scoped localStorage key for persisting drafts.
// When provided, all restorable state is seeded from it instead of the defaults.
const RoomEditor = forwardRef(function RoomEditor({ onLayoutChange, onAutoSave, initialState, draftKey, onSetupCancel }, ref) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  // ── Restorable state — seeded from initialState when resuming a draft ────────
  const [floor,        setFloor]        = useState(initialState?.floor ?? null);
  const [unit,         setUnit]         = useState(initialState?.unit ?? 'm2');
  const [rooms,        setRooms]        = useState(initialState?.rooms ?? []);
  const [doors,        setDoors]        = useState(initialState?.doors ?? []);
  const [windows,      setWindows]      = useState(initialState?.windows ?? []);
  // openSegs is stored as an array in JSON; reconstruct the Set on restore
  const [openSegs,     setOpenSegs]     = useState(() =>
    initialState?.openSegs ? new Set(initialState.openSegs) : new Set()
  );
  const [furniture,    setFurniture]    = useState(initialState?.furniture ?? []);
  // Preserve the ID counter so restored rooms/furniture keep their original IDs
  // and new items receive IDs that don't collide with existing ones.
  const [nextId,       setNextId]       = useState(initialState?.nextId ?? 1);
  const [tool,         setTool]         = useState('room');
  const [roomType,     setRoomType]     = useState('bedroom');
  const [furnType,     setFurnType]     = useState('bed');
  const [drawing,      setDrawing]      = useState(null);
  const [selRoomId,    setSelRoomId]    = useState(null);
  const [selFurnId,    setSelFurnId]    = useState(null);
  const [selOpeningId, setSelOpeningId] = useState(null); // selected door or window id
  const [dragOpening,  setDragOpening]  = useState(null); // { op, kind, origPos }
  const [resizing,     setResizing]     = useState(null);
  const [dragRoom,     setDragRoom]     = useState(null);
  const [dragFurn,     setDragFurn]     = useState(null);
  const [hoverH,       setHoverH]       = useState(null);
  const [hoverWallSeg, setHoverWallSeg] = useState(null); // {x1,z1,x2,z2} segment under cursor
  const [history,      setHistory]      = useState([]);
  const [redoStack,    setRedoStack]    = useState([]);
  const [canvasPan,    setCanvasPan]    = useState({ x: 0, y: 0 });
  const [canvasZoom,   setCanvasZoom]   = useState(1);
  const [isPanning,    setIsPanning]    = useState(false);
  const [expandedPanel, setExpandedPanel] = useState('room'); // 'room' | 'furniture'

  const selRoom = rooms.find(r => r.id === selRoomId) ?? null;
  const selFurn = furniture.find(f => f.id === selFurnId) ?? null;
  const sc      = floor ? computeScale(floor.w, floor.h) : null;
  const adjRooms  = selRoom ? rooms.filter(r => r.id !== selRoom.id && getSharedSeg(selRoom, r) !== null) : [];
  // Resolve the selected opening (door or window) from its id
  const selOpening = selOpeningId
    ? (doors.find(d => d.id === selOpeningId) ?? windows.find(w => w.id === selOpeningId) ?? null)
    : null;
  const selOpeningKind = selOpeningId
    ? (doors.some(d => d.id === selOpeningId) ? 'door' : 'window')
    : null;

  useImperativeHandle(ref, () => ({
    exportPNG:  () => floor ? exportPNG(rooms, doors, windows, openSegs, floor, furniture) : null,
    hasRooms:   () => rooms.length > 0,
    getLayout:  () => floor ? buildLayout(rooms, doors, windows, openSegs, furniture, floor) : null,
    // Returns a fully serializable snapshot of the editor state for draft persistence.
    // openSegs (a Set) is spread into a plain array so JSON.stringify works correctly.
    getEditorState: () => floor ? {
      floor,
      unit,
      rooms,
      doors,
      windows,
      openSegs: [...openSegs],
      furniture,
      nextId,
      savedAt: Date.now(),
    } : null,
    // Full reset: clears all content, selection, and undo/redo history without page reload.
    fullClear: () => {
      setRooms([]); setDoors([]); setWindows([]); setOpenSegs(new Set()); setFurniture([]);
      setSelRoomId(null); setSelFurnId(null); setSelOpeningId(null);
      setHistory([]); setRedoStack([]);
    },
  }));

  useEffect(() => {
    if (!floor) return;
    onLayoutChange?.(buildLayout(rooms, doors, windows, openSegs, furniture, floor));
  }, [rooms, doors, windows, openSegs, furniture, floor]);

  const saveH = useCallback(() => {
    setHistory(h => [...h.slice(-30), { rooms, doors, windows, openSegs: new Set(openSegs), furniture }]);
    setRedoStack([]);
  }, [rooms, doors, windows, openSegs, furniture]);

  const undo = useCallback(() => {
    if (!history.length) return;
    setRedoStack(r => [...r, { rooms, doors, windows, openSegs: new Set(openSegs), furniture }]);
    const p = history[history.length - 1];
    setRooms(p.rooms); setDoors(p.doors); setWindows(p.windows);
    setOpenSegs(p.openSegs); setFurniture(p.furniture);
    setHistory(h => h.slice(0, -1)); setSelRoomId(null); setSelFurnId(null);
  }, [history, rooms, doors, windows, openSegs, furniture]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    setHistory(h => [...h, { rooms, doors, windows, openSegs: new Set(openSegs), furniture }]);
    const p = redoStack[redoStack.length - 1];
    setRooms(p.rooms); setDoors(p.doors); setWindows(p.windows);
    setOpenSegs(p.openSegs); setFurniture(p.furniture);
    setRedoStack(r => r.slice(0, -1)); setSelRoomId(null); setSelFurnId(null);
  }, [redoStack, rooms, doors, windows, openSegs, furniture]);

  // ── Arrow-key nudge for selected furniture ───────────────────────────────────
  // Normal arrow key → 0.1 m step (= FURN_SNAP)
  // Shift + arrow key → 0.01 m step (1 cm, pixel-precise fine control)
  useEffect(() => {
    const onKey = e => {
      if (!selFurnId || !floor) return;
      const step = e.shiftKey ? 0.01 : FURN_SNAP;
      const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = deltas[e.key];
      if (!d) return;
      e.preventDefault();
      setFurniture(furn => furn.map(f => {
        if (f.id !== selFurnId) return f;
        const ew = (f.rotation || 0) % 180 === 0 ? f.w : f.d;
        const ed = (f.rotation || 0) % 180 === 0 ? f.d : f.w;
        const room = rooms.find(r => r.id === f.roomId);
        const nx = room
          ? clamp(f.x + d[0], room.x + FURN_INSET, room.x + room.w - ew - FURN_INSET)
          : clamp(f.x + d[0], FURN_INSET, floor.w - ew - FURN_INSET);
        const nz = room
          ? clamp(f.z + d[1], room.z + FURN_INSET, room.z + room.d - ed - FURN_INSET)
          : clamp(f.z + d[1], FURN_INSET, floor.h - ed - FURN_INSET);
        const testF = { ...f, x: nx, z: nz };
        if (furn.some(fi => fi.id !== selFurnId && furnOverlap(testF, fi))) return f;
        return { ...f, x: nx, z: nz };
      }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selFurnId, rooms, floor, furniture]);

  // ── Auto-save editor draft to localStorage ───────────────────────────────────
  // Runs whenever any piece of restorable editor state changes so that the
  // "Continue Planning" button on the home page is always up-to-date.
  // Only persists when the floor is defined and at least one room exists —
  // an empty canvas is not worth saving as a draft.
  useEffect(() => {
    if (!floor) return;
    try {
      const draft = {
        floor,
        unit,
        rooms,
        doors,
        windows,
        openSegs: [...openSegs],
        furniture,
        nextId,
        savedAt: Date.now(),
      };
      if (draftKey) {
        localStorage.setItem(draftKey, JSON.stringify(draft));
      }
      // Pass the draft snapshot to the parent so it can persist a per-project copy
      onAutoSave?.(draft);
    } catch {
      // localStorage may be unavailable (e.g. private browsing quota exceeded)
      // — fail silently so the editor continues to work normally.
    }
  }, [floor, unit, rooms, doors, windows, openSegs, furniture, nextId]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = e => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      setCanvasZoom(z => Math.max(0.25, Math.min(4, z * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const up = () => { isPanningRef.current = false; setIsPanning(false); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // ── Canvas draw ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !floor || !sc) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Dark canvas background
    ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Fine grid
    ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 0.5;
    for (let u = 0; u <= floor.w; u += SNAP) { ctx.beginPath(); ctx.moveTo(toPx(u, sc), 0); ctx.lineTo(toPx(u, sc), CANVAS_H); ctx.stroke(); }
    for (let u = 0; u <= floor.h; u += SNAP) { ctx.beginPath(); ctx.moveTo(0, toPz(u, sc)); ctx.lineTo(CANVAS_W, toPz(u, sc)); ctx.stroke(); }
    // Coarse grid (1 unit)
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    for (let u = 0; u <= floor.w; u++) { ctx.beginPath(); ctx.moveTo(toPx(u, sc), 0); ctx.lineTo(toPx(u, sc), CANVAS_H); ctx.stroke(); }
    for (let u = 0; u <= floor.h; u++) { ctx.beginPath(); ctx.moveTo(0, toPz(u, sc)); ctx.lineTo(CANVAS_W, toPz(u, sc)); ctx.stroke(); }

    // Fix Issue #2 (black area in 2D): fill entire floor area with base color
    ctx.fillStyle = '#F0EDE8';
    ctx.fillRect(toPx(0, sc), toPz(0, sc), floor.w * sc.s, floor.h * sc.s);

    // Floor boundary outline
    ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(toPx(0, sc), toPz(0, sc), floor.w * sc.s, floor.h * sc.s);
    ctx.setLineDash([]);

    // Dimension labels
    ctx.fillStyle = '#9ca3af'; ctx.font = '11px Inter, monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${toDisplay(floor.w, unit)} ${unitLabel(unit)}`, toPx(floor.w / 2, sc), toPz(0, sc) - 8);
    ctx.textAlign = 'right';
    ctx.fillText(`${toDisplay(floor.h, unit)} ${unitLabel(unit)}`, toPx(floor.w, sc) - 4, toPz(floor.h / 2, sc));

    // Room fills
    for (const r of rooms) {
      const isSel = r.id === selRoomId;
      const px = toPx(r.x, sc), pz = toPz(r.z, sc), pw = r.w * sc.s, pd = r.d * sc.s;
      ctx.fillStyle = typeInfo(r.type).fill + (isSel ? 'ff' : 'dd');
      ctx.fillRect(px, pz, pw, pd);
    }

    // Room walls — use split segments so open-wall renders correctly even when
    // adjacent rooms have different edge lengths (partial overlap case).
    // In 'wall' tool mode: solid walls highlight red on hover (click removes),
    // already-open segs highlight green (click restores).  In select mode: amber.
    for (const seg of getDrawSegments(rooms, openSegs)) {
      const isSel = selRoom && onRoomBorder(seg, selRoom);
      const isHov = hoverWallSeg &&
        Math.abs(seg.x1 - hoverWallSeg.x1) < 1e-4 && Math.abs(seg.z1 - hoverWallSeg.z1) < 1e-4 &&
        Math.abs(seg.x2 - hoverWallSeg.x2) < 1e-4 && Math.abs(seg.z2 - hoverWallSeg.z2) < 1e-4;

      let color, lw;
      if (tool === 'wall' && isHov) {
        // Wall tool hover: red = will remove, green = will restore
        color = seg.isOpen ? '#22c55e' : '#ef4444';
        lw    = 4;
      } else if (seg.isOpen) {
        color = isSel ? '#60a5fa55' : (isHov ? '#f59e0b99' : '#6b728055');
        lw    = isHov ? 2.5 : (isSel ? 2 : 1.5);
      } else {
        color = isSel ? '#3b82f6' : (isHov ? '#f59e0b' : '#e5e7eb');
        lw    = isHov ? 3 : (isSel ? 2 : 1.5);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth   = lw;
      ctx.setLineDash(seg.isOpen ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(toPx(seg.x1, sc), toPz(seg.z1, sc));
      ctx.lineTo(toPx(seg.x2, sc), toPz(seg.z2, sc));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Room labels
    for (const r of rooms) {
      const isSel = r.id === selRoomId;
      const px = toPx(r.x, sc), pz = toPz(r.z, sc), pw = r.w * sc.s, pd = r.d * sc.s;
      const fs = Math.max(9, Math.min(13, Math.min(pw, pd) * 0.22));
      ctx.font = `600 ${fs}px Inter, sans-serif`;
      ctx.fillStyle = isSel ? '#1e3a5f' : '#111827';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(r.name, px + pw / 2, pz + pd / 2 - fs * 0.3);
      ctx.font = `${fs * 0.78}px Inter, monospace`;
      ctx.fillStyle = (isSel ? '#1e3a5f' : '#374151') + 'cc';
      ctx.fillText(`${toDisplay(r.w, unit)} × ${toDisplay(r.d, unit)} ${unitLabel(unit)}`, px + pw / 2, pz + pd / 2 + fs * 0.65);
    }

    // Furniture
    for (const f of furniture) {
      const fi   = furnInfo(f.type);
      const isSel = f.id === selFurnId;
      const ew   = (f.rotation || 0) % 180 === 0 ? f.w : f.d;
      const ed   = (f.rotation || 0) % 180 === 0 ? f.d : f.w;
      const fx = toPx(f.x, sc), fz = toPz(f.z, sc), fw2 = ew * sc.s, fd2 = ed * sc.s;
      ctx.fillStyle   = fi.color + (isSel ? 'ff' : 'cc');
      ctx.strokeStyle = isSel ? '#000' : fi.color + 'aa';
      ctx.lineWidth   = isSel ? 1.5 : 1;
      ctx.fillRect(fx, fz, fw2, fd2); ctx.strokeRect(fx, fz, fw2, fd2);
      if (fw2 > 28 && fd2 > 14) {
        const fs = Math.max(8, Math.min(10, Math.min(fw2, fd2) * 0.26));
        ctx.font = `${fs}px Inter, sans-serif`;
        ctx.fillStyle = '#111827'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fi.label, fx + fw2 / 2, fz + fd2 / 2);
      }
    }

    // Doors (black markers)
    for (const d of doors) {
      const r = rooms.find(rm => rm.id === d.roomId); if (!r) continue;
      const dw = 0.90 * sc.s;
      ctx.fillStyle = '#000';
      if (d.wall === 'north' || d.wall === 'south') {
        const wz = d.wall === 'north' ? toPz(r.z, sc) : toPz(r.z + r.d, sc);
        ctx.fillRect(toPx(r.x, sc) + r.w * sc.s * d.position - dw / 2, wz - 5, dw, 10);
      } else {
        const wx = d.wall === 'west' ? toPx(r.x, sc) : toPx(r.x + r.w, sc);
        ctx.fillRect(wx - 5, toPz(r.z, sc) + r.d * sc.s * d.position - dw / 2, 10, dw);
      }
    }

    // Windows (grey markers)
    for (const w of windows) {
      const r = rooms.find(rm => rm.id === w.roomId); if (!r) continue;
      const ww = 1.0 * sc.s;
      ctx.fillStyle = '#9ca3af';
      if (w.wall === 'north' || w.wall === 'south') {
        const wz = w.wall === 'north' ? toPz(r.z, sc) : toPz(r.z + r.d, sc);
        ctx.fillRect(toPx(r.x, sc) + r.w * sc.s * w.position - ww / 2, wz - 5, ww, 10);
      } else {
        const wx = w.wall === 'west' ? toPx(r.x, sc) : toPx(r.x + r.w, sc);
        ctx.fillRect(wx - 5, toPz(r.z, sc) + r.d * sc.s * w.position - ww / 2, 10, ww);
      }
    }

    // Selected opening highlight — blue ring drawn over the marker
    if (selOpening && sc) {
      const r = rooms.find(rm => rm.id === selOpening.roomId);
      if (r) {
        const { wx, wz } = openingWorldPos(selOpening, r);
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(toPx(wx, sc), toPz(wz, sc), 10, 0, Math.PI * 2);
        ctx.stroke();
        // Small centre dot
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(toPx(wx, sc), toPz(wz, sc), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Resize handles (selected room)
    if (selRoom && sc) {
      const hp = getHP(selRoom, sc);
      for (const h of HANDLES) {
        const [hx, hz] = hp[h];
        ctx.fillStyle   = hoverH === h ? '#3b82f6' : '#fff';
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hx, hz, HANDLE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // Drawing preview
    if (drawing) {
      const x = Math.min(drawing.sx, drawing.ex), z = Math.min(drawing.sz, drawing.ez);
      const w2 = Math.abs(drawing.ex - drawing.sx), d2 = Math.abs(drawing.ez - drawing.sz);
      ctx.fillStyle   = typeInfo(roomType).fill + '55';
      ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.fillRect(toPx(x, sc), toPz(z, sc), w2 * sc.s, d2 * sc.s);
      ctx.strokeRect(toPx(x, sc), toPz(z, sc), w2 * sc.s, d2 * sc.s);
      ctx.setLineDash([]);
      if (w2 >= 0.5 && d2 >= 0.5) {
        ctx.font = '11px Inter, monospace'; ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${toDisplay(w2, unit)} × ${toDisplay(d2, unit)}`, toPx(x + w2 / 2, sc), toPz(z + d2 / 2, sc));
      }
    }
  }, [rooms, doors, windows, openSegs, furniture, drawing, selRoomId, selFurnId, selOpeningId, roomType, hoverH, hoverWallSeg, floor, unit, sc]);

  // ── Pointer helpers ──────────────────────────────────────────────────────────
  const canvasUV = e => {
    if (!sc) return { u: 0, v: 0, ur: 0, vr: 0, px: 0, pz: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const px   = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const pz   = (e.clientY - rect.top)  * (CANVAS_H / rect.height);
    const ur   = clamp(toU(px, sc), 0, floor.w);
    const vr   = clamp(toZ(pz, sc), 0, floor.h);
    return {
      u:  clamp(snapU(ur), 0, floor.w),   // coarse 0.5m snap (for rooms)
      v:  clamp(snapU(vr), 0, floor.h),
      ur, vr,                              // raw world coords (for furniture)
      px, pz,
    };
  };

  // Find the wall sub-segment closest to world point (wu, wv); returns it or
  // null if nothing is within WALL_HIT metres.
  const hitWallSeg = (wu, wv) => {
    const segs = getDrawSegments(rooms, openSegs);
    let best = null, bestDist = WALL_HIT;
    for (const s of segs) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const len2 = dx * dx + dz * dz;
      if (len2 < 0.0001) continue;
      const t = clamp(((wu - s.x1) * dx + (wv - s.z1) * dz) / len2, 0, 1);
      const d = Math.hypot(wu - (s.x1 + t * dx), wv - (s.z1 + t * dz));
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return best;
  };
  const hitRoom  = (u, v) => { for (let i=rooms.length-1;i>=0;i--) { const r=rooms[i]; if(u>=r.x&&u<=r.x+r.w&&v>=r.z&&v<=r.z+r.d) return r; } return null; };
  const hitFurn  = (u, v) => { for (let i=furniture.length-1;i>=0;i--) { const f=furniture[i]; const ew=(f.rotation||0)%180===0?f.w:f.d, ed=(f.rotation||0)%180===0?f.d:f.w; if(u>=f.x&&u<=f.x+ew&&v>=f.z&&v<=f.z+ed) return f; } return null; };

  // Returns the wall-centre world position of a door or window opening.
  const openingWorldPos = (op, r) => {
    if (op.wall === 'north') return { wx: r.x + op.position * r.w, wz: r.z };
    if (op.wall === 'south') return { wx: r.x + op.position * r.w, wz: r.z + r.d };
    if (op.wall === 'west')  return { wx: r.x,                     wz: r.z + op.position * r.d };
    /* east */               return { wx: r.x + r.w,               wz: r.z + op.position * r.d };
  };

  // Hit-tests all doors and windows. Returns { op, kind } for the closest one
  // within HIT_R world-metres of the click, or null if none.
  const HIT_R = 0.55; // world metres — generous enough for the thin 10px bar
  const hitOpening = (wu, wv) => {
    let best = null, bestD = HIT_R;
    const check = (list, kind) => {
      for (const op of list) {
        const r = rooms.find(rm => rm.id === op.roomId);
        if (!r) continue;
        const { wx, wz } = openingWorldPos(op, r);
        const d = Math.hypot(wu - wx, wv - wz);
        if (d < bestD) { bestD = d; best = { op, kind }; }
      }
    };
    check(doors, 'door');
    check(windows, 'window');
    return best;
  };

  const onMouseDown = e => {
    if (e.button !== 0) return;
    if (!floor || !sc) return;
    const { u, v, ur, vr, px, pz } = canvasUV(e);

    if (selRoom && tool === 'select') {
      const h = hitHandle(selRoom, px, pz, sc);
      if (h) { saveH(); setResizing({ handle: h, orig: { ...selRoom }, startPx: px, startPz: pz }); return; }
    }

    if (tool === 'room') {
      setDrawing({ sx: u, sz: v, ex: u, ez: v });
      setSelRoomId(null); setSelFurnId(null);
    } else if (tool === 'wall') {
      // Wall tool: click any wall segment to toggle it open/closed
      const ws = hitWallSeg(ur, vr);
      if (ws) {
        saveH();
        const k = segKey(ws.x1, ws.z1, ws.x2, ws.z2);
        setOpenSegs(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
      }
    } else if (tool === 'select') {
      // Priority order: opening (door/window) → furniture → room
      const ho = hitOpening(ur, vr);
      if (ho) {
        setSelOpeningId(ho.op.id); setSelRoomId(null); setSelFurnId(null);
        const r = rooms.find(rm => rm.id === ho.op.roomId);
        if (r) setDragOpening({ op: { ...ho.op }, kind: ho.kind, room: r });
        return;
      }
      const hf = hitFurn(ur, vr);
      if (hf) {
        setSelFurnId(hf.id); setSelRoomId(null); setSelOpeningId(null); saveH();
        setDragFurn({ orig: { ...hf }, su: ur, sv: vr }); return;
      }
      const hr = hitRoom(ur, vr);
      if (hr) {
        if (selRoomId === hr.id) { saveH(); setDragRoom({ orig: { ...hr }, su: u, sv: v }); }
        else { setSelRoomId(hr.id); setSelFurnId(null); setSelOpeningId(null); }
      } else {
        setSelRoomId(null); setSelFurnId(null); setSelOpeningId(null);
      }
    } else if (tool === 'door') {
      const hr = hitRoom(u, v);
      if (hr) { const w = hitWall(hr, u, v); if (w) { saveH(); setDoors(d => [...d, { id: nextId, roomId: hr.id, ...w }]); setNextId(n => n + 1); } }
    } else if (tool === 'window') {
      const hr = hitRoom(u, v);
      if (hr) { const w = hitWall(hr, u, v); if (w) { saveH(); setWindows(ws => [...ws, { id: nextId, roomId: hr.id, ...w }]); setNextId(n => n + 1); } }
    } else if (tool === 'furniture') {
      const hr   = hitRoom(ur, vr);
      const fi   = furnInfo(furnType);
      // Allow placement inside a named room OR anywhere on the floor (gap / unassigned
      // areas).  Gap pieces use floor-boundary constraints; room pieces use room-boundary
      // constraints so they stay inside their room.
      const onFloor = ur >= 0 && ur <= floor.w && vr >= 0 && vr <= floor.h;
      if (hr || onFloor) {
        const bx0 = hr ? hr.x + FURN_INSET             : FURN_INSET;
        const bx1 = hr ? hr.x + hr.w - fi.w - FURN_INSET : floor.w - fi.w - FURN_INSET;
        const bz0 = hr ? hr.z + FURN_INSET             : FURN_INSET;
        const bz1 = hr ? hr.z + hr.d - fi.d - FURN_INSET : floor.h - fi.d - FURN_INSET;
        const fx = clamp(snapFurn(ur - fi.w / 2), bx0, bx1);
        const fz = clamp(snapFurn(vr - fi.d / 2), bz0, bz1);
        const candidate = { id: -1, type: furnType, x: fx, z: fz, w: fi.w, d: fi.d, rotation: 0 };
        if (furniture.some(f => furnOverlap(candidate, f))) return;
        saveH();
        const nid = nextId;
        // roomId undefined for gap-area pieces; drag falls back to floor constraints
        setFurniture(prev => [...prev, { id: nid, type: furnType, x: fx, z: fz, w: fi.w, d: fi.d, rotation: 0, roomId: hr?.id }]);
        setSelFurnId(nid); setSelRoomId(null); setNextId(n => n + 1);
      }
    }
  };

  const onMouseMove = e => {
    if (!floor || !sc) return;
    const { u, v, ur, vr, px, pz } = canvasUV(e);

    if (selRoom && !resizing && !dragRoom && !drawing && tool === 'select') setHoverH(hitHandle(selRoom, px, pz, sc));

    // Highlight wall segments when in wall-edit or select tool
    if ((tool === 'wall' || tool === 'select') && !dragRoom && !dragFurn && !resizing) {
      setHoverWallSeg(hitWallSeg(ur, vr) ?? null);
    } else {
      setHoverWallSeg(null);
    }

    if (resizing) {
      const dx = toU(px, sc) - toU(resizing.startPx, sc);
      const dz = toZ(pz, sc) - toZ(resizing.startPz, sc);
      const upd = applyResize(resizing.handle, resizing.orig, dx, dz, floor);
      setRooms(r => r.map(rm => rm.id === selRoomId ? { ...rm, ...upd } : rm));
      return;
    }
    if (dragRoom) {
      const dx = snapU(u - dragRoom.su), dz = snapU(v - dragRoom.sv);
      const nx = clamp(dragRoom.orig.x + dx, 0, floor.w - dragRoom.orig.w);
      const nz = clamp(dragRoom.orig.z + dz, 0, floor.h - dragRoom.orig.d);
      setRooms(r => r.map(rm => rm.id === selRoomId ? { ...rm, x: nx, z: nz } : rm));
      return;
    }
    if (dragFurn) {
      const f  = dragFurn.orig;
      const ew = (f.rotation || 0) % 180 === 0 ? f.w : f.d;
      const ed = (f.rotation || 0) % 180 === 0 ? f.d : f.w;
      // Fine snap for furniture drag using raw (unsnapped) world coords
      const dx = snapFurn(ur - dragFurn.su), dz = snapFurn(vr - dragFurn.sv);
      const room = rooms.find(r => r.id === f.roomId);
      const nx = room
        ? clamp(f.x + dx, room.x + FURN_INSET, room.x + room.w - ew - FURN_INSET)
        : clamp(f.x + dx, FURN_INSET, floor.w - ew - FURN_INSET);
      const nz = room
        ? clamp(f.z + dz, room.z + FURN_INSET, room.z + room.d - ed - FURN_INSET)
        : clamp(f.z + dz, FURN_INSET, floor.h - ed - FURN_INSET);
      const testF = { ...f, x: nx, z: nz };
      if (!furniture.some(fi => fi.id !== selFurnId && furnOverlap(testF, fi)))
        setFurniture(furn => furn.map(fi => fi.id === selFurnId ? { ...fi, x: nx, z: nz } : fi));
      return;
    }
    if (dragOpening) {
      // Slide the opening along its wall by recomputing the position fraction
      // from the cursor. Snap to 1 cm, clamp to keep it off the corners.
      const { op, kind, room: r } = dragOpening;
      let newPos;
      if (op.wall === 'north' || op.wall === 'south') {
        newPos = (ur - r.x) / r.w;
      } else {
        newPos = (vr - r.z) / r.d;
      }
      newPos = clamp(Math.round(newPos * 100) / 100, 0.1, 0.9);
      const setter = kind === 'door' ? setDoors : setWindows;
      setter(list => list.map(item => item.id === op.id ? { ...item, position: newPos } : item));
      return;
    }
    if (drawing) setDrawing(d => ({ ...d, ex: u, ez: v }));
  };

  const onMouseUp = () => {
    if (resizing)    { setResizing(null);    return; }
    if (dragRoom)    { setDragRoom(null);    return; }
    if (dragFurn)    { setDragFurn(null);    return; }
    if (dragOpening) {
      // Commit the final position to history on mouse-up
      saveH();
      setDragOpening(null);
      return;
    }
    if (!drawing) return;
    const x = snapU(Math.min(drawing.sx, drawing.ex)), z = snapU(Math.min(drawing.sz, drawing.ez));
    const w2 = snapU(Math.abs(drawing.ex - drawing.sx)), d2 = snapU(Math.abs(drawing.ez - drawing.sz));
    if (w2 >= MIN_ROOM && d2 >= MIN_ROOM) {
      saveH();
      const info = typeInfo(roomType), nid = nextId;
      setRooms(r => [...r, { id: nid, name: info.label, type: roomType, x, z, w: w2, d: d2 }]);
      setSelRoomId(nid); setNextId(n => n + 1);
    }
    setDrawing(null);
  };

  const deleteRoom = () => {
    if (!selRoomId) return; saveH();
    setRooms(r => r.filter(rm => rm.id !== selRoomId));
    setDoors(d => d.filter(dr => dr.roomId !== selRoomId));
    setWindows(w => w.filter(wr => wr.roomId !== selRoomId));
    setSelRoomId(null); setSelOpeningId(null);
  };
  const deleteFurn    = () => { if (!selFurnId) return; saveH(); setFurniture(f => f.filter(fi => fi.id !== selFurnId)); setSelFurnId(null); };
  const deleteOpening = () => {
    if (!selOpeningId) return; saveH();
    if (selOpeningKind === 'door')   setDoors(d => d.filter(dr => dr.id !== selOpeningId));
    else                             setWindows(w => w.filter(wr => wr.id !== selOpeningId));
    setSelOpeningId(null);
  };
  const rotateFurn = () => { if (!selFurnId) return; setFurniture(furn => furn.map(f => f.id !== selFurnId ? f : { ...f, rotation: ((f.rotation || 0) + 90) % 360 })); };
  const clearAll   = () => { if (!rooms.length) return; saveH(); setRooms([]); setDoors([]); setWindows([]); setOpenSegs(new Set()); setFurniture([]); setSelRoomId(null); setSelFurnId(null); setSelOpeningId(null); };

  const toggleOpen = adj => {
    const seg = getSharedSeg(selRoom, adj); if (!seg) return;
    const k = segKey(seg.x1, seg.z1, seg.x2, seg.z2); saveH();
    setOpenSegs(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  };
  const isOpen = adj => { if (!selRoom) return false; const seg = getSharedSeg(selRoom, adj); if (!seg) return false; return openSegs.has(segKey(seg.x1, seg.z1, seg.x2, seg.z2)); };
  const updateRoom = ch => setRooms(r => r.map(rm => rm.id === selRoomId ? { ...rm, ...ch } : rm));

  const getCursor = () => {
    if (tool === 'wall') return hoverWallSeg ? 'pointer' : 'crosshair';
    if (hoverH && selRoom && tool === 'select') return H_CURSOR[hoverH] ?? 'default';
    if (hoverWallSeg && tool === 'select') return 'pointer';
    if (tool === 'room')      return 'crosshair';
    if (tool === 'door' || tool === 'window') return 'cell';
    if (tool === 'furniture') return 'copy';
    if (dragRoom || dragFurn) return 'grabbing';
    if ((selRoom || selFurn) && tool === 'select') return 'grab';
    return 'default';
  };

  // ── Pan / zoom handlers ─────────────────────────────────────────────────────
  const handleContainerMouseDown = e => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      isPanningRef.current = true;
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: canvasPan.x, panY: canvasPan.y };
    }
  };
  const handleContainerMouseMove = e => {
    if (!isPanningRef.current) return;
    setCanvasPan({ x: panStartRef.current.panX + (e.clientX - panStartRef.current.x), y: panStartRef.current.panY + (e.clientY - panStartRef.current.y) });
  };
  const handleContainerMouseUp = () => { isPanningRef.current = false; setIsPanning(false); };

  // ── UI styles — black/white minimal, matches main app ──────────────────────
  const SB = { width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1, fontFamily: '"Instrument Serif", serif', background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8, overflow: 'hidden' };
  const section = { borderBottom: '1px solid #f4f4f5', padding: '12px 14px' };
  const secLabel = { fontSize: 10, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 };
  const toolBtn = active => ({ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 10px', marginBottom: 2, borderRadius: 5, border: active ? '1px solid #000' : '1px solid transparent', cursor: 'pointer', background: active ? '#000' : 'transparent', color: active ? '#fff' : '#374151', fontSize: 12, fontWeight: active ? 600 : 400 });
  const typeBtn = active => ({ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '5px 8px', marginBottom: 2, borderRadius: 4, border: '1px solid transparent', cursor: 'pointer', background: active ? '#f4f4f5' : 'transparent', color: active ? '#000' : '#374151', fontSize: 11, fontWeight: active ? 600 : 400 });
  const adjBtn  = open  => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '5px 8px', marginBottom: 2, borderRadius: 4, border: open ? '1px solid #000' : '1px solid #e4e4e7', cursor: 'pointer', background: open ? '#000' : '#fff', color: open ? '#fff' : '#374151', fontSize: 11 });
  const actBtn  = danger => ({ width: '100%', padding: '7px', borderRadius: 5, border: danger ? '1px solid #fca5a5' : '1px solid #e4e4e7', cursor: 'pointer', fontSize: 11, background: danger ? '#fff' : '#fff', color: danger ? '#dc2626' : '#374151', fontFamily: '"Instrument Serif", serif', marginBottom: 3 });
  const inp     = { width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid #e4e4e7', background: '#fff', color: '#000', fontSize: 11, fontFamily: '"Instrument Serif", serif', boxSizing: 'border-box', outline: 'none' };

  if (!floor) return <SetupScreen onConfirm={(fl, u) => { setFloor(fl); setUnit(u); }} onCancel={onSetupCancel} />;
  const furnGroups = [...new Set(FURNITURE_TYPES.map(f => f.group))];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: '"Instrument Serif", serif' }}>
      {/* ── Left Sidebar ── */}
      <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid #e4e4e7', height: '100%', overflow: 'hidden' }}>
        {/* Tools Container */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderBottom: '1px solid #e4e4e7', flex: 1 }}>
          <div style={{ padding: '10px 14px 6px', flexShrink: 0 }}>
            <span style={secLabel}>Tools</span>
          </div>

          {/* ── Scrollable area: expanded panel header + its options ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px' }}>
            {expandedPanel === 'room' ? (
              <>
                {/* Room header — expanded */}
                <button onClick={() => { setExpandedPanel('room'); setTool('room'); setSelFurnId(null); setSelRoomId(null); }} style={{ ...toolBtn(tool === 'room'), justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LayoutGrid size={14} />Room</span>
                  <ChevronDown size={12} />
                </button>
                {/* Room types */}
                <div style={{ padding: '4px 0 4px 8px' }}>
                  {ROOM_TYPES.map(t => (
                    <button key={t.value} onClick={() => { setTool('room'); setRoomType(t.value); }} style={typeBtn(roomType === t.value)}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, background: t.fill, flexShrink: 0, border: '1px solid rgba(0,0,0,0.1)' }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/* Room header — collapsed */}
                <button onClick={() => { setExpandedPanel('room'); setTool('room'); setSelFurnId(null); setSelRoomId(null); }} style={{ ...toolBtn(false), justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LayoutGrid size={14} />Room</span>
                  <ChevronUp size={12} />
                </button>
                {/* Furniture header — expanded */}
                <button onClick={() => { setExpandedPanel('furniture'); setTool('furniture'); setSelFurnId(null); setSelRoomId(null); }} style={{ ...toolBtn(tool === 'furniture'), justifyContent: 'space-between', marginTop: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Armchair size={14} />Furniture</span>
                  <ChevronDown size={12} />
                </button>
                {/* Furniture options */}
                <div style={{ padding: '4px 0 4px 8px' }}>
                  {furnGroups.map(group => (
                    <div key={group}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.8, margin: '6px 0 3px' }}>{group}</div>
                      {FURNITURE_TYPES.filter(f => f.group === group).map(f => (
                        <button key={f.value} onClick={() => { setTool('furniture'); setFurnType(f.value); }} style={typeBtn(furnType === f.value)}>
                          <span style={{ width: 9, height: 9, borderRadius: 2, background: f.color, flexShrink: 0, border: '1px solid rgba(0,0,0,0.1)' }} />
                          {f.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Bottom-pinned: collapsed panel + Door + Window ── */}
          <div style={{ flexShrink: 0, padding: '6px 14px 10px', borderTop: '1px solid #f4f4f5' }}>
            {expandedPanel === 'room' && (
              <button onClick={() => { setExpandedPanel('furniture'); setTool('furniture'); setSelFurnId(null); setSelRoomId(null); }} style={{ ...toolBtn(tool === 'furniture'), justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Armchair size={14} />Furniture</span>
                <ChevronUp size={12} />
              </button>
            )}
            <button onClick={() => { setTool('door'); setSelFurnId(null); setSelRoomId(null); }} style={toolBtn(tool === 'door')}><DoorOpen size={14} />Door</button>
            <button onClick={() => { setTool('window'); setSelFurnId(null); setSelRoomId(null); }} style={toolBtn(tool === 'window')}><AppWindow size={14} />Window</button>
          </div>
        </div>
        {/* Edit Container (bottom - fixed) */}
        <div style={{ flexShrink: 0, padding: '12px 14px' }}>
          <span style={secLabel}>Edit</span>
          <button onClick={() => { setTool('wall'); setSelFurnId(null); setSelRoomId(null); }} style={toolBtn(tool === 'wall')}><PenTool size={14} />Edit Walls</button>
          <button onClick={() => { setTool('select'); setSelFurnId(null); setSelRoomId(null); }} style={toolBtn(tool === 'select')}><MousePointer2 size={14} />Select / Move</button>
        </div>
      </div>

      {/* ── Center Canvas Area ── */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative', background: '#0f1117', cursor: isPanning ? 'grabbing' : 'default' }}
        onMouseDown={handleContainerMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseUp={handleContainerMouseUp}
        onContextMenu={e => e.preventDefault()}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, #1f2937 1px, transparent 1px)', backgroundSize: '24px 24px', pointerEvents: 'none', opacity: 0.4 }} />
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})`,
            cursor: isPanning ? 'grabbing' : getCursor(),
            display: 'block',
            borderRadius: 4,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { setDrawing(null); setHoverH(null); setHoverWallSeg(null); }}
        />
        <div style={{ position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,0.6)', color: '#9ca3af', padding: '4px 10px', borderRadius: 4, fontSize: 11, fontFamily: 'Inter, monospace', pointerEvents: 'none' }}>
          {Math.round(canvasZoom * 100)}%
        </div>
      </div>

      {/* ── Right Sidebar ── */}
      <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid #e4e4e7', height: '100%', overflow: 'hidden' }}>
        {/* Floor Info */}
        <div style={{ ...section, background: '#fafafa' }}>
          <span style={secLabel}>Floor</span>
          <div style={{ fontSize: 12, color: '#000', fontWeight: 600 }}>{toDisplay(floor.w, unit)} × {toDisplay(floor.h, unit)} {unitLabel(unit)}</div>
          <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>{toArea(floor.w, floor.h, unit).toFixed(0)} {areaLabel(unit)}</div>
          <button onClick={() => { setFloor(null); clearAll(); }} style={{ ...actBtn(false), marginTop: 8 }}>Redefine Floor</button>
        </div>

        {/* Actions */}
        <div style={section}>
          <span style={secLabel}>Actions</span>
          <button onClick={rotateFurn} disabled={!selFurn} style={{ ...actBtn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: selFurn ? 1 : 0.35 }}><RotateCw size={13} /> Rotate 90°</button>
          <button
            onClick={() => { if (selFurn) deleteFurn(); else if (selRoom) deleteRoom(); else if (selOpening) deleteOpening(); }}
            disabled={!selFurn && !selRoom && !selOpening}
            style={{ ...actBtn(true), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: (selFurn || selRoom || selOpening) ? 1 : 0.35 }}
          >
            <Trash2 size={13} /> Remove
          </button>
          <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
            <button onClick={undo} disabled={!history.length} style={{ ...actBtn(false), flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: history.length ? 1 : 0.35 }}><Undo2 size={12} /> Undo</button>
            <button onClick={redo} disabled={!redoStack.length} style={{ ...actBtn(false), flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: redoStack.length ? 1 : 0.35 }}><Redo2 size={12} /> Redo</button>
          </div>
        </div>

        {/* Selected room info */}
        {selRoom && tool === 'select' && (
          <div style={section}>
            <span style={secLabel}>Room</span>
            <input value={selRoom.name} onChange={e => updateRoom({ name: e.target.value })} style={{ ...inp, marginBottom: 6 }} placeholder="Room name" />
            <select value={selRoom.type} onChange={e => updateRoom({ type: e.target.value })} style={{ ...inp, marginBottom: 4 }}>
              {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div style={{ fontSize: 10, color: '#a1a1aa', marginBottom: 4 }}>{toDisplay(selRoom.w, unit)} × {toDisplay(selRoom.d, unit)} {unitLabel(unit)}</div>
          </div>
        )}

        {/* Selected furniture info */}
        {selFurn && tool === 'select' && (
          <div style={section}>
            <span style={secLabel}>Furniture</span>
            <div style={{ fontSize: 12, color: '#000', fontWeight: 600, marginBottom: 2 }}>{furnInfo(selFurn.type).label}</div>
            <div style={{ fontSize: 10, color: '#a1a1aa', marginBottom: 4 }}>Rotation: {selFurn.rotation || 0}°</div>
            <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.5 }}>
              ↑↓←→ move 10 cm<br/>Shift+↑↓←→ move 1 cm
            </div>
          </div>
        )}

        {/* Selected door/window info */}
        {selOpening && tool === 'select' && (
          <div style={section}>
            <span style={secLabel}>{selOpeningKind === 'door' ? 'Door' : 'Window'}</span>
            <div style={{ fontSize: 12, color: '#000', fontWeight: 600, marginBottom: 4 }}>
              {selOpeningKind === 'door' ? 'Door' : 'Window'} — {selOpening.wall} wall
            </div>
            <div style={{ fontSize: 10, color: '#a1a1aa', marginBottom: 6 }}>
              Position: {Math.round(selOpening.position * 100)}% along wall
            </div>
            <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.5 }}>
              Drag to slide along wall
            </div>
          </div>
        )}

        {/* Edit Walls instructions (dynamic, below Actions) */}
        {tool === 'wall' && (
          <div style={{ padding: '12px 14px', overflow: 'hidden' }}>
            <span style={secLabel}>Edit Walls</span>
            <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.6, marginBottom: 8 }}>
              Hover a wall, then click to remove or restore it.
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <span style={{ width: 24, height: 4, background: '#ef4444', borderRadius: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: '#374151' }}>Solid → click to open</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ width: 24, height: 4, borderTop: '2px dashed #22c55e', flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: '#374151' }}>Open → click to restore</span>
            </div>
          </div>
        )}

        {/* Stats at bottom */}
        <div style={{ marginTop: 'auto', padding: '12px 14px', borderTop: '1px solid #f4f4f5'}}>
          <div style={{ fontSize: 10, color: '#a1a1aa', lineHeight: 1.7, textAlign:'center' }}>
            {rooms.length} rooms · {furniture.length} items
          </div>
          <div style={{ fontSize: 10, color: '#a1a1aa', lineHeight: 1.7, textAlign:'center' }}>
            {doors.length} doors · {windows.length} windows
          </div>
        </div>
      </div>
    </div>
  );
});

export default RoomEditor;