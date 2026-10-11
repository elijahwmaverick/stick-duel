// Stick Duel shared geometry — used by the game page (renderer.js) AND the Supabase function
// (hit validation), so what the server checks is exactly what players see.
// Plain script: sets globalThis.StickGeometry. No DOM access.
(function () {
  const W = 1000, H = 560, GROUND = 500;
  const DEG = Math.PI / 180;
  const L = { thigh: 32, shin: 32, torso: 42, arm: 26, forearm: 26, headR: 12, neck: 3 };
  const POSE_KEYS = ["torso", "head", "frontArm", "frontForearm", "backArm", "backForearm",
    "frontThigh", "frontShin", "backThigh", "backShin"];
  const DEFAULT_POSE = { torso: 0, head: 0, frontArm: 15, frontForearm: 15, backArm: -15, backForearm: 15,
    frontThigh: 8, frontShin: 0, backThigh: -8, backShin: 0 };
  const PARTS = ["head", "mouth", "chest", "hip", "frontHand", "backHand", "frontFoot", "backFoot"];

  const n = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const isHex = (c) => typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c);
  function ease(kind, u) {
    switch (kind) {
      case "linear": return u;
      case "in": return u * u;
      case "out": return 1 - (1 - u) * (1 - u);
      default: return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    }
  }

  // ---------- Skeleton ----------
  function skeleton(pose, facing, scale) {
    const f = facing >= 0 ? 1 : -1, s = scale;
    const down = (a) => ({ x: Math.sin(a * DEG) * f, y: -Math.cos(a * DEG) });
    const up = (a) => ({ x: Math.sin(a * DEG) * f, y: Math.cos(a * DEG) });
    const add = (p, d, len) => ({ x: p.x + d.x * len * s, y: p.y + d.y * len * s });
    const hip = { x: 0, y: 0 };
    const neck = add(hip, up(pose.torso), L.torso);
    const head = add(neck, up(pose.torso + pose.head), L.neck + L.headR);
    const fe = add(neck, down(pose.frontArm + pose.torso), L.arm);
    const fh = add(fe, down(pose.frontArm + pose.torso + pose.frontForearm), L.forearm);
    const be = add(neck, down(pose.backArm + pose.torso), L.arm);
    const bh = add(be, down(pose.backArm + pose.torso + pose.backForearm), L.forearm);
    const fk = add(hip, down(pose.frontThigh), L.thigh);
    const ff = add(fk, down(pose.frontThigh - pose.frontShin), L.shin);
    const bk = add(hip, down(pose.backThigh), L.thigh);
    const bf = add(bk, down(pose.backThigh - pose.backShin), L.shin);
    return { hip, neck, head, fe, fh, be, bh, fk, ff, bk, bf };
  }
  function rotateAll(j, rotDeg, facing) {
    if (!rotDeg) return j;
    const r = rotDeg * DEG * (facing >= 0 ? 1 : -1);
    const c = Math.cos(r), sn = Math.sin(r), o = {};
    for (const k in j) o[k] = { x: j[k].x * c + j[k].y * sn, y: -j[k].x * sn + j[k].y * c };
    return o;
  }
  function groundHip(frame) {
    const j = rotateAll(skeleton(frame.pose, frame.facing, frame.scale), frame.rotation, frame.facing);
    let min = Infinity;
    for (const k in j) min = Math.min(min, j[k].y - (k === "head" ? L.headR * frame.scale : 0));
    return -min + 2;
  }

  // ---------- Tracks ----------
  function baseFrame(st) {
    return {
      t: 0, x: n(st.x, 500), y: n(st.y, 64), air: !!st.air, facing: st.facing === -1 ? -1 : 1,
      rotation: n(st.rotation, 0), scale: clamp(n(st.scale, 1), 0.3, 3),
      color: isHex(st.color) ? st.color : "#222", visible: st.visible !== false,
      pose: { ...DEFAULT_POSE, ...(st.pose || {}) }, ease: "inOut",
    };
  }
  function buildTrack(st, kfs) {
    let cur = baseFrame(st);
    const out = [cur];
    const list = (Array.isArray(kfs) ? kfs : []).filter((k) => k && typeof k === "object")
      .map((k) => ({ ...k, t: Math.max(0, n(k.t, 0)) })).sort((a, b) => a.t - b.t);
    for (const k of list) {
      const pose = { ...cur.pose };
      if (k.pose && typeof k.pose === "object") for (const p of POSE_KEYS) pose[p] = n(k.pose[p], pose[p]);
      cur = {
        t: k.t, x: clamp(n(k.x, cur.x), 20, 980), y: clamp(n(k.y, cur.y), 0, 900),
        air: typeof k.air === "boolean" ? k.air : cur.air,
        facing: k.facing === 1 || k.facing === -1 ? k.facing : cur.facing,
        rotation: n(k.rotation, cur.rotation), scale: clamp(n(k.scale, cur.scale), 0.3, 3),
        color: isHex(k.color) ? k.color : cur.color,
        visible: typeof k.visible === "boolean" ? k.visible : cur.visible,
        pose, ease: typeof k.ease === "string" ? k.ease : "inOut",
      };
      out.push(cur);
    }
    for (const f of out) f.hipY = f.air ? f.y : groundHip(f);
    return out;
  }
  function sampleTrack(track, t) {
    let i = 0;
    while (i < track.length - 1 && track[i + 1].t <= t) i++;
    const a = track[i], b = track[i + 1];
    if (!b) return { ...a };
    const span = b.t - a.t;
    const u = span <= 0 ? 1 : ease(b.ease, clamp((t - a.t) / span, 0, 1));
    const pose = {};
    for (const p of POSE_KEYS) pose[p] = lerp(a.pose[p], b.pose[p], u);
    const f = {
      t, x: lerp(a.x, b.x, u), rotation: lerp(a.rotation, b.rotation, u), scale: lerp(a.scale, b.scale, u),
      facing: u < 0.5 ? a.facing : b.facing, color: u < 0.5 ? a.color : b.color,
      visible: a.visible, air: a.air || b.air, pose,
    };
    if (!a.air && !b.air) { f.hipY = groundHip(f); f.air = false; }
    else f.hipY = lerp(a.hipY, b.hipY, u);
    f.y = f.hipY;
    return f;
  }
  function worldJoints(f) {
    const j = rotateAll(skeleton(f.pose, f.facing, f.scale), f.rotation, f.facing);
    const o = {};
    for (const k in j) o[k] = { x: f.x + j[k].x, y: f.hipY + j[k].y };
    return o;
  }
  function partInfo(f, part) {
    const j = worldJoints(f);
    const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / DEG;
    switch (part) {
      case "head": return { ...j.head, angle: ang(j.neck, j.head) };
      case "mouth": {
        const d = ang(j.neck, j.head) - 90 * f.facing;
        return { x: j.head.x + Math.cos(d * DEG) * L.headR * f.scale, y: j.head.y + Math.sin(d * DEG) * L.headR * f.scale - 2, angle: d };
      }
      case "chest": return { x: lerp(j.hip.x, j.neck.x, 0.7), y: lerp(j.hip.y, j.neck.y, 0.7), angle: ang(j.hip, j.neck) };
      case "frontHand": return { ...j.fh, angle: ang(j.fe, j.fh) };
      case "backHand": return { ...j.bh, angle: ang(j.be, j.bh) };
      case "frontFoot": return { ...j.ff, angle: ang(j.fk, j.ff) };
      case "backFoot": return { ...j.bf, angle: ang(j.bk, j.bf) };
      default: return { ...j.hip, angle: ang(j.hip, j.neck) };
    }
  }
  // Local frame of a body part for drawing attachments: +y runs along the part's axis
  // (out of the head, up the torso, down the forearm toward the hand), +x points the way the figure faces.
  function partFrame(f, part) {
    const j = worldJoints(f);
    const seg = {
      head: [j.neck, j.head], mouth: [j.neck, j.head], chest: [j.hip, j.neck], hip: [j.hip, j.neck],
      frontHand: [j.fe, j.fh], backHand: [j.be, j.bh], frontFoot: [j.fk, j.ff], backFoot: [j.bk, j.bf],
    }[part] || [j.hip, j.neck];
    const pi = partInfo(f, part);
    let ax = seg[1].x - seg[0].x, ay = seg[1].y - seg[0].y;
    const len = Math.hypot(ax, ay) || 1; ax /= len; ay /= len;
    const fsgn = f.facing >= 0 ? 1 : -1;
    // forward = axis rotated -90° (facing right) or +90° (facing left)
    const fx = ay * fsgn, fy = -ax * fsgn;
    return { x: pi.x, y: pi.y, ax, ay, fx, fy };
  }

  // ---------- Props ----------
  function propFrame(prop, t, fighterAt) {
    const kfs = (Array.isArray(prop.keyframes) ? prop.keyframes : []).filter(Boolean)
      .map((k) => ({ ...k, t: n(k.t, 0) })).sort((a, b) => a.t - b.t);
    if (!kfs.length) return null;
    if (t < Math.max(n(prop.start, -1), kfs[0].t)) return null;
    if (typeof prop.end === "number" && t > prop.end) return null;
    const world = (k, tt) => {
      let x = n(k.x, 0), y = n(k.y, 0), rot = n(k.rotation, 0);
      if (k.attach && (k.attach.who === "p1" || k.attach.who === "p2")) {
        const pi = partInfo(fighterAt(k.attach.who, tt), k.attach.part);
        x += pi.x; y += pi.y; if (k.alignToLimb) rot += pi.angle;
      }
      return { x, y, rot, scale: n(k.scale, 1), opacity: clamp(n(k.opacity, 1), 0, 1) };
    };
    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].t <= t) i++;
    const a = kfs[i], b = kfs[i + 1];
    const wa = world(a, t);
    if (!b) return wa;
    const wb = world(b, t);
    const span = b.t - a.t, u = span <= 0 ? 1 : ease(b.ease, clamp((t - a.t) / span, 0, 1));
    return { x: lerp(wa.x, wb.x, u), y: lerp(wa.y, wb.y, u), rot: lerp(wa.rot, wb.rot, u),
      scale: lerp(wa.scale, wb.scale, u), opacity: lerp(wa.opacity, wb.opacity, u) };
  }
  // Points of a prop's shapes in world space (for reach checks).
  function propPoints(prop, pf) {
    const pts = [];
    const c = Math.cos(pf.rot * DEG), s = Math.sin(pf.rot * DEG);
    const add = (x, y) => pts.push({ x: pf.x + (x * c - y * s) * pf.scale, y: pf.y + (x * s + y * c) * pf.scale });
    for (const sh of (Array.isArray(prop.shapes) ? prop.shapes.slice(0, 60) : [])) {
      if (!sh || typeof sh !== "object") continue;
      if (sh.type === "circle") { const r = Math.abs(n(sh.r, 10)); add(n(sh.x, 0), n(sh.y, 0)); add(n(sh.x, 0) + r, n(sh.y, 0)); add(n(sh.x, 0) - r, n(sh.y, 0)); add(n(sh.x, 0), n(sh.y, 0) + r); add(n(sh.x, 0), n(sh.y, 0) - r); }
      else if (sh.type === "rect") { const x = n(sh.x, 0), y = n(sh.y, 0), w = n(sh.w, 10), h = n(sh.h, 10); add(x, y); add(x + w, y); add(x, y + h); add(x + w, y + h); add(x + w / 2, y + h / 2); }
      else if (sh.type === "line") { const x1 = n(sh.x1, 0), y1 = n(sh.y1, 0), x2 = n(sh.x2, 0), y2 = n(sh.y2, 0); for (let k = 0; k <= 4; k++) add(lerp(x1, x2, k / 4), lerp(y1, y2, k / 4)); }
      else if (sh.type === "polygon" && Array.isArray(sh.points)) for (const p of sh.points.slice(0, 80)) if (Array.isArray(p)) add(n(p[0], 0), n(p[1], 0));
    }
    if (!pts.length) pts.push({ x: pf.x, y: pf.y });
    return pts;
  }

  // ---------- Forms ----------
  // A form persists across rounds until changed: { name, color, glow, aura, attachments, body }.
  function formAt(baseForm, changes, who, t) {
    let f = baseForm || null;
    for (const c of changes || []) if (c && c.who === who && n(c.t, 0) <= t && c.form && typeof c.form === "object") f = c.form;
    return f;
  }

  // ---------- Hit validation ----------
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const u = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
    return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
  }
  // Distance from a point to a fighter's body (bones + head; a replaced body counts as a blob around the hip).
  function distToBody(p, f, form) {
    if (form && form.body) {
      const j = worldJoints(f);
      return Math.max(0, Math.hypot(p.x - lerp(j.hip.x, j.neck.x, 0.5), p.y - lerp(j.hip.y, j.neck.y, 0.5)) - 60 * f.scale);
    }
    const j = worldJoints(f);
    const segs = [[j.hip, j.neck], [j.neck, j.fe], [j.fe, j.fh], [j.neck, j.be], [j.be, j.bh],
      [j.hip, j.fk], [j.fk, j.ff], [j.hip, j.bk], [j.bk, j.bf]];
    let d = Math.hypot(p.x - j.head.x, p.y - j.head.y) - L.headR * f.scale;
    for (const [a, b] of segs) d = Math.min(d, distToSeg(p, a, b));
    return Math.max(0, d);
  }
  // Can `hit` be seen landing at time t? Returns true if the named source (or any source) reaches the target.
  function hitVisibleAt(ctx, hit, t) {
    const { fighterAt, result, forms } = ctx;
    const target = hit.target, by = hit.by === "p1" || hit.by === "p2" ? hit.by : (target === "p1" ? "p2" : "p1");
    const tf = fighterAt(target, t);
    const tForm = forms(target, t);
    const af = fighterAt(by, t);
    const REACH = 34;
    const w = hit.with;
    const checkPart = (part) => distToBody(partInfo(af, part), tf, tForm) <= REACH * af.scale;
    const checkProp = (id) => {
      const pr = (result.props || []).find((p) => p && p.id === id);
      if (!pr) return false;
      const pf = propFrame(pr, t, fighterAt);
      if (!pf || pf.opacity < 0.2) return false;
      return propPoints(pr, pf).some((p) => distToBody(p, tf, tForm) <= REACH);
    };
    const checkEmitter = (e) => {
      if (!e || typeof e !== "object") return false;
      const st = n(e.start, 0), en = n(e.end, st + 0.5), life = clamp(n(e.life, 0.6), 0.05, 4);
      if (t < st || t > en + life) return false;
      const origin = e.from && (e.from.who === "p1" || e.from.who === "p2")
        ? partInfo(fighterAt(e.from.who, Math.min(t, en)), e.from.part) : { x: n(e.from?.x, 500), y: n(e.from?.y, 100) };
      const tc = partInfo(tf, "chest");
      const dist = Math.hypot(tc.x - origin.x, tc.y - origin.y);
      const reach = n(e.speed, 300) * 1.3 * life + 40;
      if (dist > reach) return false;
      if (e.to && (e.to.who === target)) return true;
      let dir;
      if (e.to && typeof e.to === "object") {
        const tp = e.to.who ? partInfo(fighterAt(e.to.who, t), e.to.part) : { x: n(e.to.x, 0), y: n(e.to.y, 0) };
        dir = Math.atan2(tp.y - origin.y, tp.x - origin.x) / DEG;
      } else dir = n(e.direction, 0);
      const want = Math.atan2(tc.y - origin.y, tc.x - origin.x) / DEG;
      const diff = Math.abs(((want - dir) % 360 + 540) % 360 - 180);
      return diff <= n(e.spread, 20) / 2 + 25;
    };
    if (typeof w === "string" && PARTS.includes(w)) return checkPart(w);
    if (w === "body") return checkPart("chest") || checkPart("hip") || checkPart("head");
    if (w && typeof w === "object" && typeof w.prop === "string") return checkProp(w.prop);
    if (w && typeof w === "object" && typeof w.emitter === "number") return checkEmitter((result.emitters || [])[w.emitter]);
    // Unspecified: any visible source counts.
    if (PARTS.some(checkPart)) return true;
    if ((result.props || []).some((p) => p && checkProp(p.id))) return true;
    return (result.emitters || []).some(checkEmitter);
  }
  // Moves each hit to the nearest moment it visibly connects (within ±0.6 s) or drops it.
  function validateHits(state, result) {
    const dur = clamp(n(result.duration, 4), 1, 10);
    const tracks = { p1: buildTrack(state.p1, result.fighters?.p1), p2: buildTrack(state.p2, result.fighters?.p2) };
    const fighterAt = (who, t) => sampleTrack(tracks[who], t);
    const forms = (who, t) => formAt(state[who]?.form, result.formChanges, who, t);
    const ctx = { fighterAt, result, forms };
    const kept = [], notes = [];
    for (const h of result.hits || []) {
      if (!h || (h.target !== "p1" && h.target !== "p2")) continue;
      if (!(n(h.damage, 0) > 0)) { kept.push(h); continue; } // heals and zero hits need no contact
      const t0 = clamp(n(h.t, dur / 2), 0, dur);
      if (hitVisibleAt(ctx, h, t0)) { kept.push({ ...h, t: t0 }); continue; }
      let found = null;
      for (let d = 0.02; d <= 0.6 && found == null; d += 0.02) {
        if (t0 - d >= 0 && hitVisibleAt(ctx, h, t0 - d)) found = t0 - d;
        else if (t0 + d <= dur && hitVisibleAt(ctx, h, t0 + d)) found = t0 + d;
      }
      if (found != null) { kept.push({ ...h, t: +found.toFixed(2) }); notes.push(`hit on ${h.target} retimed ${t0.toFixed(2)}→${found.toFixed(2)}s`); }
      else notes.push(`dropped invisible hit on ${h.target} at ${t0.toFixed(2)}s (${n(h.damage, 0)} dmg)`);
    }
    return { hits: kept, notes };
  }

  globalThis.StickGeometry = {
    W, H, GROUND, DEG, L, POSE_KEYS, DEFAULT_POSE, PARTS,
    n, clamp, lerp, isHex, ease, skeleton, rotateAll, groundHip, buildTrack, sampleTrack,
    worldJoints, partInfo, partFrame, propFrame, propPoints, formAt, distToBody, validateHits,
  };
})();
