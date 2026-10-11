// Stick Duel renderer: plays Claude's animation scripts on a canvas.
// World: x 0..1000, y up, ground at y = 0.
(function () {
  const W = 1000, H = 560, GROUND = 500; // screen y of world y=0
  const DEG = Math.PI / 180;
  const L = { thigh: 32, shin: 32, torso: 42, arm: 26, forearm: 26, headR: 12, neck: 3 };
  const POSE_KEYS = ["torso", "head", "frontArm", "frontForearm", "backArm", "backForearm",
    "frontThigh", "frontShin", "backThigh", "backShin"];
  const DEFAULT_POSE = { torso: 0, head: 0, frontArm: 15, frontForearm: 15, backArm: -15, backForearm: 15,
    frontThigh: 8, frontShin: 0, backThigh: -8, backShin: 0 };

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
  // Local joints relative to hip (y up), before body rotation.
  function skeleton(pose, facing, scale) {
    const f = facing >= 0 ? 1 : -1, s = scale;
    const down = (a) => ({ x: Math.sin(a * DEG) * f, y: -Math.cos(a * DEG) }); // 0 = down
    const up = (a) => ({ x: Math.sin(a * DEG) * f, y: Math.cos(a * DEG) });     // 0 = up
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
    const r = rotDeg * DEG * (facing >= 0 ? 1 : -1); // forward flip = clockwise when facing right
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
      default: return { ...j.hip, angle: 0 };
    }
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
  function drawShapes(ctx, shapes, pf) {
    ctx.save();
    ctx.globalAlpha *= pf.opacity;
    ctx.translate(pf.x, GROUND - pf.y);
    ctx.rotate(-pf.rot * DEG);
    ctx.scale(pf.scale, -pf.scale);
    for (const s of (Array.isArray(shapes) ? shapes.slice(0, 60) : [])) {
      if (!s || typeof s !== "object") continue;
      ctx.lineWidth = n(s.width, 3); ctx.lineJoin = "round"; ctx.lineCap = "round";
      const fill = isHex(s.fill) ? s.fill : null;
      const stroke = isHex(s.stroke) ? s.stroke : (fill ? null : "#222");
      ctx.beginPath();
      if (s.type === "circle") ctx.arc(n(s.x, 0), n(s.y, 0), Math.abs(n(s.r, 10)), 0, Math.PI * 2);
      else if (s.type === "rect") ctx.rect(n(s.x, 0), n(s.y, 0), n(s.w, 10), n(s.h, 10));
      else if (s.type === "line") { ctx.moveTo(n(s.x1, 0), n(s.y1, 0)); ctx.lineTo(n(s.x2, 0), n(s.y2, 0)); }
      else if (s.type === "polygon" && Array.isArray(s.points)) {
        s.points.slice(0, 80).forEach((p, i) => Array.isArray(p) && (i ? ctx.lineTo(n(p[0], 0), n(p[1], 0)) : ctx.moveTo(n(p[0], 0), n(p[1], 0))));
        ctx.closePath();
      } else if (s.type === "text") {
        ctx.save(); ctx.scale(1, -1);
        ctx.font = `bold ${clamp(n(s.size, 18), 6, 80)}px system-ui, sans-serif`;
        ctx.fillStyle = fill || stroke || "#222";
        ctx.fillText(String(s.text || "").slice(0, 40), n(s.x, 0), -n(s.y, 0));
        ctx.restore(); continue;
      } else continue;
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    ctx.restore();
  }

  // ---------- Figure ----------
  function drawJoints(ctx, j, f, color, width, alpha) {
    const P = (p) => [p.x, GROUND - p.y];
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = width * f.scale; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const seg = (...pts) => { ctx.beginPath(); ctx.moveTo(...P(pts[0])); for (const p of pts.slice(1)) ctx.lineTo(...P(p)); ctx.stroke(); };
    seg(j.hip, j.bk, j.bf); seg(j.neck, j.be, j.bh);
    seg(j.hip, j.neck);
    seg(j.hip, j.fk, j.ff); seg(j.neck, j.fe, j.fh);
    ctx.beginPath(); ctx.arc(...P(j.head), (L.headR + 1) * f.scale, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawFigure(ctx, f, flash) {
    if (!f.visible) return;
    const j = worldJoints(f);
    if (flash) {
      ctx.save(); ctx.shadowColor = "#fff"; ctx.shadowBlur = 24;
      drawJoints(ctx, j, f, "#ffffff", 9, 1); ctx.restore();
    }
    drawJoints(ctx, j, f, flash ? "#111" : f.color, 6, 1);
  }

  // ---------- Scene pieces (drawn in base screen coords: x, GROUND - y) ----------
  function drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, -900, 0, GROUND);
    g.addColorStop(0, "#9fc3df"); g.addColorStop(0.75, "#e6eef2"); g.addColorStop(1, "#f6f1e6");
    ctx.fillStyle = g; ctx.fillRect(-400, -1200, W + 800, GROUND + 1200);
    // distant hills and pillars give the camera something to move against
    ctx.fillStyle = "#d3dde3";
    ctx.beginPath(); ctx.moveTo(-400, GROUND);
    for (let x = -400; x <= W + 400; x += 80) ctx.lineTo(x, GROUND - 70 - 40 * Math.sin(x * 0.011) - 25 * Math.sin(x * 0.027));
    ctx.lineTo(W + 400, GROUND); ctx.fill();
    ctx.fillStyle = "#c2ced6";
    for (const x of [90, 330, 670, 910]) { ctx.fillRect(x - 14, GROUND - 190, 28, 190); ctx.fillRect(x - 22, GROUND - 200, 44, 14); }
    ctx.fillStyle = "#dacdb2"; ctx.fillRect(-400, GROUND, W + 800, 400);
    ctx.strokeStyle = "#4a4033"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-400, GROUND); ctx.lineTo(W + 400, GROUND); ctx.stroke();
    ctx.strokeStyle = "rgba(74,64,51,.25)"; ctx.lineWidth = 2;
    for (let x = -400; x < W + 400; x += 60) { ctx.beginPath(); ctx.moveTo(x, GROUND + 14); ctx.lineTo(x + 26, GROUND + 14); ctx.stroke(); }
    // arena walls
    ctx.fillStyle = "rgba(60,50,40,.18)"; ctx.fillRect(-400, -1200, 400, GROUND + 1200); ctx.fillRect(W, -1200, 400, GROUND + 1200);
  }
  function drawHud(ctx, names, hp, label) {
    for (const [slot, side] of [["p1", 0], ["p2", 1]]) {
      const x = side ? W - 24 - 300 : 24, val = clamp(n(hp[slot], 100), 0, 100);
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(x, 18, 300, 22);
      ctx.fillStyle = slot === "p1" ? "#2f7fd6" : "#d64545";
      const w = 300 * val / 100; ctx.fillRect(side ? x + 300 - w : x, 18, w, 22);
      ctx.strokeStyle = "#111"; ctx.lineWidth = 2; ctx.strokeRect(x, 18, 300, 22);
      ctx.font = "800 26px system-ui, sans-serif"; ctx.textAlign = side ? "right" : "left";
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(255,255,255,.85)";
      const txt = `${names[slot] || slot.toUpperCase()}  ${Math.ceil(val)}`;
      ctx.strokeText(txt, side ? x + 300 : x, 70); ctx.fillStyle = "#111"; ctx.fillText(txt, side ? x + 300 : x, 70);
    }
    if (label) {
      ctx.textAlign = "center"; ctx.font = "800 22px system-ui, sans-serif"; ctx.fillStyle = "#fff";
      ctx.fillText(label, W / 2, H - 12);
    }
    ctx.textAlign = "left";
  }
  function drawBubble(ctx, f, text) {
    const j = worldJoints(f);
    const x = j.head.x, y = GROUND - j.head.y - 30;
    ctx.font = "600 22px system-ui, sans-serif";
    const w = Math.min(360, ctx.measureText(text).width + 22);
    const bx = x - w / 2;
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#111"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y - 34, w, 34, 10) : ctx.rect(bx, y - 34, w, 34);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#111"; ctx.fillText(text, bx + 11, y - 10, w - 22);
  }
  function drawLetterbox(ctx, amt) {
    if (amt <= 0) return;
    const h = 46 * amt;
    ctx.fillStyle = "#0c0c0c"; ctx.fillRect(0, 0, W, h); ctx.fillRect(0, H - h, W, h);
  }
  function drawVignette(ctx) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.28)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function drawCard(ctx, title, sub) {
    ctx.fillStyle = "rgba(10,10,10,.82)"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.fillStyle = "#fff";
    ctx.font = "900 italic 84px system-ui, sans-serif"; ctx.fillText(title, W / 2, H / 2 + 10);
    if (sub) { ctx.font = "700 26px system-ui, sans-serif"; ctx.fillStyle = "#cfcfcf"; ctx.fillText(sub, W / 2, H / 2 + 56); }
    ctx.textAlign = "left";
  }

  // ---------- Camera ----------
  function setCamera(ctx, cam) {
    const z = cam.zoom;
    let cx = clamp(cam.x, W / (2 * z), W - W / (2 * z));
    let cy = Math.min(cam.y, H - H / (2 * z)); // cy in base screen coords; keep ground in view
    ctx.setTransform(z, 0, 0, z, W / 2 - z * cx + cam.sx, H / 2 - z * cy + cam.sy);
  }

  // ---------- Player ----------
  function createScene(canvas) {
    const ctx = canvas.getContext("2d");
    canvas.width = W; canvas.height = H;
    let anim = null, abort = false;

    function drawStatic(state, names, opts = {}) {
      if (anim) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      setCamera(ctx, { zoom: 1, x: W / 2, y: H / 2, sx: 0, sy: 0 });
      drawBackground(ctx);
      for (const p of state.props || []) drawShapes(ctx, p.shapes, { x: n(p.x, 0), y: n(p.y, 0), rot: n(p.rotation, 0), scale: n(p.scale, 1), opacity: 1 });
      for (const s of ["p1", "p2"]) drawFigure(ctx, sampleTrack(buildTrack(state[s], []), 0));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawVignette(ctx);
      drawHud(ctx, names, { p1: state.p1.hp, p2: state.p2.hp });
      if (opts.card) drawCard(ctx, opts.card, opts.cardSub);
    }

    function card(title, sub, ms) {
      abort = false;
      return new Promise((res) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawCard(ctx, title, sub);
        const end = performance.now() + ms;
        const tick = () => (abort || performance.now() >= end ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
    }

    // opts: { label, intro } — label shows in the bottom letterbox (used by the replay)
    function play(state, result, names, opts = {}) {
      abort = false;
      return new Promise((resolve) => {
        const dur = clamp(n(result.duration, 4), 1, 10);
        const tracks = { p1: buildTrack(state.p1, result.fighters?.p1), p2: buildTrack(state.p2, result.fighters?.p2) };
        const fighterAt = (who, t) => sampleTrack(tracks[who], t);
        const scriptIds = new Set((result.props || []).map((p) => p && p.id));
        const keptProps = (state.props || []).filter((p) => !scriptIds.has(p.id));
        const emitters = (result.emitters || []).filter((e) => e && typeof e === "object").map((e) => ({ ...e, acc: 0, burstDone: false }));
        const hits = (result.hits || []).slice().sort((a, b) => a.t - b.t);
        const cams = (Array.isArray(result.camera) ? result.camera : []).filter(Boolean).map((c) => ({ ...c, t: n(c.t, 0) })).sort((a, b) => a.t - b.t);
        const slows = (Array.isArray(result.slowmo) ? result.slowmo : []).filter(Boolean)
          .map((s) => ({ start: n(s.start, 0), end: n(s.end, 0), speed: clamp(n(s.speed, 0.3), 0.1, 1) }));
        const particles = [], pops = [], rings = [];
        const hp = { p1: state.p1.hp, p2: state.p2.hp };
        const flashUntil = { p1: -1, p2: -1 };
        const trails = { p1: [], p2: [] };
        const prev = { p1: null, p2: null };
        const wasAir = { p1: !!state.p1.air, p2: !!state.p2.air };
        const cam = { zoom: 1, x: W / 2, y: H / 2, sx: 0, sy: 0, kick: 0 };
        let shakeAmt = 0, hitstop = 0, ko = null, koAge = 0, whiteFlash = 0;
        let hitIdx = 0, last = null, t = 0, real = 0;
        const tail = 1.0;

        const pointOf = (spec, tt) => {
          if (!spec || typeof spec !== "object") return null;
          if (spec.who === "p1" || spec.who === "p2") return partInfo(fighterAt(spec.who, tt), spec.part);
          return { x: n(spec.x, 500), y: n(spec.y, 100) };
        };
        function spawn(o, dirDeg, count, spec) {
          for (let i = 0; i < count && particles.length < 3000; i++) {
            const a = (dirDeg + (Math.random() - 0.5) * spec.spread) * DEG;
            const sp = spec.speed * (0.6 + Math.random() * 0.8);
            particles.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
              life: spec.life * (0.7 + Math.random() * 0.6), size: spec.size, sizeEnd: spec.sizeEnd,
              color: spec.colors[(Math.random() * spec.colors.length) | 0], g: spec.gravity, shape: spec.shape, glow: spec.glow });
          }
        }
        function emit(e, count, tt) {
          const o = pointOf(e.from, tt); if (!o || count <= 0) return;
          const tgt = pointOf(e.to, tt);
          const dir = tgt ? Math.atan2(tgt.y - o.y, tgt.x - o.x) / DEG : n(e.direction, 0);
          const colors = Array.isArray(e.colors) && e.colors.filter(isHex).length ? e.colors.filter(isHex) : ["#ff9a2e"];
          spawn(o, dir, count, { spread: n(e.spread, 20), speed: n(e.speed, 300), life: clamp(n(e.life, 0.6), 0.05, 4),
            size: clamp(n(e.size, 6), 1, 80), sizeEnd: clamp(n(e.sizeEnd, n(e.size, 6)), 0, 120), colors,
            gravity: n(e.gravity, 0), shape: e.shape || "circle", glow: !!e.glow });
        }
        function speedAt(tt) {
          let s = 1;
          for (const sl of slows) if (tt >= sl.start && tt <= sl.end) s = Math.min(s, sl.speed);
          return s;
        }
        function autoFrame(tt) {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
          for (const s of ["p1", "p2"]) {
            const f = fighterAt(s, tt); if (!f.visible) continue;
            const j = worldJoints(f); for (const k in j) add(j[k].x, j[k].y);
          }
          for (const pr of result.props || []) { const pf = pr && propFrame(pr, tt, fighterAt); if (pf) add(pf.x, pf.y); }
          if (!isFinite(x0)) return { zoom: 1, x: W / 2, y: H / 2 };
          add(x0, 0); // keep the ground in frame
          const bw = x1 - x0 + 260, bh = y1 - y0 + 200;
          const zoom = clamp(Math.min(W / bw, H / bh), 1, 2.1);
          return { zoom, x: (x0 + x1) / 2, y: GROUND - (y0 + y1) / 2 };
        }
        function camTarget(tt) {
          const auto = autoFrame(tt);
          let cue = null;
          for (const c of cams) if (c.t <= tt) cue = c;
          if (!cue) return auto;
          let fx = auto.x, fy = auto.y;
          const fo = cue.focus;
          if (fo === "p1" || fo === "p2") { const pi = partInfo(fighterAt(fo, tt), "chest"); fx = pi.x; fy = GROUND - pi.y; }
          else if (fo && typeof fo === "object") { fx = n(fo.x, fx); fy = GROUND - n(fo.y, GROUND - fy); }
          return { zoom: clamp(n(cue.zoom, auto.zoom), 1, 2.6), x: fx, y: fy };
        }

        function frame(now) {
          if (abort) { anim = null; resolve(); return; }
          const rdt = last == null ? 0 : Math.min(0.05, (now - last) / 1000);
          last = now; real += rdt;
          let dt = 0;
          if (hitstop > 0) hitstop -= rdt;
          else dt = rdt * speedAt(t) * (ko && koAge < 1.6 ? 0.22 : 1);
          if (ko) koAge += rdt;
          t += dt;
          const tt = Math.min(t, dur);

          // emitters
          for (const e of emitters) {
            const st = n(e.start, 0), en = n(e.end, st + 0.5);
            if (t >= st && !e.burstDone) { e.burstDone = true; emit(e, clamp(n(e.burst, 0), 0, 400), tt); }
            if (t >= st && t <= en) { e.acc += clamp(n(e.rate, 0), 0, 400) * dt; const k = Math.floor(e.acc); e.acc -= k; emit(e, k, tt); }
          }

          // fighters: trails + landing dust
          const frames = {};
          for (const s of ["p1", "p2"]) {
            const f = fighterAt(s, tt); frames[s] = f;
            const j = worldJoints(f);
            if (prev[s] && dt > 0) {
              const sp = (Math.hypot(j.hip.x - prev[s].hip.x, j.hip.y - prev[s].hip.y) +
                Math.hypot(j.fh.x - prev[s].fh.x, j.fh.y - prev[s].fh.y) + Math.hypot(j.ff.x - prev[s].ff.x, j.ff.y - prev[s].ff.y)) / dt;
              trails[s].push({ j, f, fast: sp > 1100 && f.visible });
            }
            if (trails[s].length > 6) trails[s].shift();
            if (dt > 0) prev[s] = j;
            if (wasAir[s] && !f.air && f.visible) {
              const feet = { x: f.x, y: 2 };
              spawn(feet, 0, 10, { spread: 30, speed: 160, life: 0.5, size: 8, sizeEnd: 22, colors: ["#bba98a", "#cbbd9f"], gravity: -20, shape: "circle", glow: false });
              spawn(feet, 180, 10, { spread: 30, speed: 160, life: 0.5, size: 8, sizeEnd: 22, colors: ["#bba98a", "#cbbd9f"], gravity: -20, shape: "circle", glow: false });
              shakeAmt = Math.max(shakeAmt, 4);
            }
            wasAir[s] = f.air;
          }

          for (const p of particles) { p.age += dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
          for (let i = particles.length - 1; i >= 0; i--) if (particles[i].age > particles[i].life) particles.splice(i, 1);

          // hits: hit-stop, sparks, shockwave, camera punch, KO
          while (hitIdx < hits.length && hits[hitIdx].t <= t) {
            const h = hits[hitIdx++];
            hp[h.target] = clamp(hp[h.target] - h.damage, 0, 100);
            const pi = partInfo(fighterAt(h.target, tt), "chest");
            pops.push({ x: pi.x, y: pi.y + 60, text: h.damage > 0 ? `-${h.damage}` : `+${-h.damage}`, heal: h.damage < 0, age: 0, big: h.damage >= 18 });
            if (h.damage > 0) {
              flashUntil[h.target] = real + 0.12;
              hitstop = Math.max(hitstop, 0.05 + h.damage * 0.006);
              shakeAmt = Math.max(shakeAmt, 5 + h.damage * 0.7);
              cam.kick = Math.max(cam.kick, 0.08 + h.damage * 0.006);
              rings.push({ x: pi.x, y: pi.y, age: 0, max: 40 + h.damage * 3 });
              spawn(pi, 90, 18 + h.damage, { spread: 360, speed: 380 + h.damage * 14, life: 0.35, size: 4, sizeEnd: 1, colors: ["#ffffff", "#ffe27a", "#ffb02e"], gravity: 300, shape: "spark", glow: true });
              if (h.damage >= 18) { slows.push({ start: t, end: t + 0.45, speed: 0.3 }); whiteFlash = 0.12; }
              if (hp[h.target] <= 0 && !ko) { ko = { target: h.target }; koAge = 0; whiteFlash = 0.2; hitstop = 0.25; }
            }
          }
          for (const p of pops) p.age += rdt;
          for (const r of rings) r.age += rdt;

          // camera
          const tgt = camTarget(tt);
          if (ko && koAge < 1.6) { const pi = partInfo(frames[ko.target], "chest"); tgt.x = pi.x; tgt.y = GROUND - pi.y; tgt.zoom = 2.2; }
          const k = 1 - Math.exp(-rdt * 5);
          cam.zoom = lerp(cam.zoom, tgt.zoom, k); cam.x = lerp(cam.x, tgt.x, k); cam.y = lerp(cam.y, tgt.y, k);
          cam.kick *= Math.exp(-rdt * 9);
          for (const s of result.screen || []) {
            if (s && s.type === "shake" && t >= n(s.start, 0) && t <= n(s.start, 0) + n(s.duration, 0.3)) shakeAmt = Math.max(shakeAmt, clamp(n(s.intensity, 8), 0, 30));
            if (s && s.type === "flash" && t >= n(s.start, 0) && t <= n(s.start, 0) + 0.03) whiteFlash = Math.max(whiteFlash, n(s.duration, 0.2));
          }
          cam.sx = (Math.random() - 0.5) * shakeAmt * 2; cam.sy = (Math.random() - 0.5) * shakeAmt * 2;
          shakeAmt *= Math.exp(-rdt * 10);

          // ----- draw world -----
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          setCamera(ctx, { ...cam, zoom: cam.zoom + cam.kick });
          drawBackground(ctx);
          for (const p of keptProps) drawShapes(ctx, p.shapes, { x: n(p.x, 0), y: n(p.y, 0), rot: n(p.rotation, 0), scale: n(p.scale, 1), opacity: 1 });
          for (const pr of result.props || []) {
            if (!pr) continue;
            const pf = propFrame(pr, tt, fighterAt);
            if (pf) drawShapes(ctx, pr.shapes, pf);
          }
          for (const s of ["p1", "p2"]) {
            const tr = trails[s];
            tr.forEach((e, i) => { if (e.fast) drawJoints(ctx, e.j, e.f, e.f.color, 5, 0.07 + 0.05 * i); });
          }
          for (const s of ["p1", "p2"]) drawFigure(ctx, frames[s], real < flashUntil[s]);
          for (const r of rings) {
            if (r.age > 0.3) continue;
            const u = r.age / 0.3;
            ctx.beginPath(); ctx.arc(r.x, GROUND - r.y, 10 + r.max * u, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${1 - u})`; ctx.lineWidth = 8 * (1 - u) + 1; ctx.stroke();
          }
          for (const p of particles) {
            const u = p.age / p.life, sz = lerp(p.size, p.sizeEnd, u), alpha = clamp(1 - u, 0, 1);
            ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
            const sx = p.x, sy = GROUND - p.y;
            if (p.glow) { ctx.globalAlpha = alpha * 0.22; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, sz * 1.6), 0, Math.PI * 2); ctx.fill(); }
            ctx.globalAlpha = alpha;
            if (p.shape === "square") ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
            else if (p.shape === "spark") { ctx.lineWidth = Math.max(1.5, sz / 2); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - p.vx * 0.035, sy + p.vy * 0.035); ctx.stroke(); }
            else { ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.5, sz / 2), 0, Math.PI * 2); ctx.fill(); }
          }
          ctx.globalAlpha = 1;
          for (const sp of result.speech || []) {
            if (sp && (sp.who === "p1" || sp.who === "p2") && t >= n(sp.start, 0) && t <= n(sp.end, n(sp.start, 0) + 1.5))
              drawBubble(ctx, frames[sp.who], String(sp.text || "").slice(0, 60));
          }
          for (const p of pops) {
            if (p.age > 1.1) continue;
            const pop = p.age < 0.08 ? 1 + (0.08 - p.age) * 8 : 1;
            ctx.save(); ctx.translate(p.x, GROUND - p.y - p.age * 50); ctx.scale(pop, pop);
            ctx.globalAlpha = clamp(1.1 - p.age, 0, 1);
            ctx.font = `900 ${p.big ? 40 : 30}px system-ui, sans-serif`; ctx.textAlign = "center";
            ctx.lineWidth = 6; ctx.strokeStyle = "#111"; ctx.fillStyle = p.heal ? "#4be27e" : (p.big ? "#ffd23f" : "#fff");
            ctx.strokeText(p.text, 0, 0); ctx.fillText(p.text, 0, 0);
            ctx.restore();
          }

          // ----- overlays -----
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          drawVignette(ctx);
          if (whiteFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(whiteFlash * 4, 0, 0.85)})`; ctx.fillRect(0, 0, W, H); whiteFlash -= rdt; }
          const lb = Math.min(1, real / 0.35) * (t > dur + tail - 0.35 ? clamp((dur + tail - t) / 0.35, 0, 1) : 1);
          drawLetterbox(ctx, lb);
          drawHud(ctx, names, hp, opts.label);
          if (ko && koAge > 0.25) {
            const u = clamp((koAge - 0.25) / 0.2, 0, 1);
            ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(2 - u, 2 - u); ctx.globalAlpha = u;
            ctx.font = "900 italic 110px system-ui, sans-serif"; ctx.textAlign = "center";
            ctx.lineWidth = 10; ctx.strokeStyle = "#111"; ctx.strokeText("K.O.", 0, 38);
            ctx.fillStyle = "#ffd23f"; ctx.fillText("K.O.", 0, 38);
            ctx.restore();
          }

          if (t < dur + tail) requestAnimationFrame(frame);
          else { anim = null; resolve(); }
        }
        anim = true;
        requestAnimationFrame(frame);
      });
    }
    return { drawStatic, play, card, stop: () => { abort = true; }, isPlaying: () => !!anim };
  }

  // Next round's state from the old state + a resolved round.
  function finalize(state, result) {
    const dur = clamp(n(result.duration, 4), 1, 10);
    const out = { props: [] };
    for (const s of ["p1", "p2"]) {
      const f = sampleTrack(buildTrack(state[s], result.fighters?.[s]), dur);
      const rot = ((f.rotation % 360) + 540) % 360 - 180;
      out[s] = {
        x: Math.round(f.x), y: Math.round(f.hipY), air: !!f.air, facing: f.facing,
        rotation: Math.round(rot), scale: +f.scale.toFixed(2), color: f.color, visible: f.visible,
        pose: Object.fromEntries(POSE_KEYS.map((k) => [k, Math.round(f.pose[k])])),
        hp: n(result.hp?.[s], state[s].hp),
        statuses: (result.endState?.[s]?.statuses || []).slice(0, 5),
      };
      if (out[s].hp <= 0) Object.assign(out[s], { air: false, rotation: out[s].rotation >= 0 ? 90 : -90 });
    }
    out.props = (result.endState?.props || []).filter((p) => p && Array.isArray(p.shapes)).slice(0, 12);
    return out;
  }

  function initialState() {
    return {
      p1: { x: 250, y: 64, air: false, facing: 1, rotation: 0, scale: 1, color: "#2f7fd6", visible: true, pose: { ...DEFAULT_POSE }, hp: 100, statuses: [] },
      p2: { x: 750, y: 64, air: false, facing: -1, rotation: 0, scale: 1, color: "#d64545", visible: true, pose: { ...DEFAULT_POSE }, hp: 100, statuses: [] },
      props: [],
    };
  }

  window.StickRenderer = { createScene, finalize, initialState, buildTrack, sampleTrack };
})();
