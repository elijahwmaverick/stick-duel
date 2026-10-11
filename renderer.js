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
  function drawFigure(ctx, f, flash) {
    if (!f.visible) return;
    const j = worldJoints(f);
    const P = (p) => [p.x, GROUND - p.y];
    ctx.save();
    ctx.strokeStyle = flash ? "#ff2d2d" : f.color;
    ctx.lineWidth = 5 * f.scale; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (flash) { ctx.shadowColor = "#ff3b3b"; ctx.shadowBlur = 18; }
    const seg = (...pts) => { ctx.beginPath(); ctx.moveTo(...P(pts[0])); for (const p of pts.slice(1)) ctx.lineTo(...P(p)); ctx.stroke(); };
    seg(j.hip, j.bk, j.bf); seg(j.neck, j.be, j.bh);
    seg(j.hip, j.neck);
    seg(j.hip, j.fk, j.ff); seg(j.neck, j.fe, j.fh);
    ctx.beginPath(); ctx.arc(...P(j.head), L.headR * f.scale, 0, Math.PI * 2);
    ctx.fillStyle = "#fffaf0"; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ---------- Scene ----------
  function drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, "#cfe3f2"); g.addColorStop(1, "#f4efe3");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND);
    ctx.fillStyle = "#d8cbb0"; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = "#5b4f3c"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.lineTo(W, GROUND); ctx.stroke();
  }
  function drawHud(ctx, names, hp) {
    for (const [slot, side] of [["p1", 0], ["p2", 1]]) {
      const x = side ? W - 24 - 300 : 24, val = clamp(n(hp[slot], 100), 0, 100);
      ctx.fillStyle = "rgba(0,0,0,.15)"; ctx.fillRect(x, 18, 300, 22);
      ctx.fillStyle = slot === "p1" ? "#2f7fd6" : "#d64545";
      const w = 300 * val / 100; ctx.fillRect(side ? x + 300 - w : x, 18, w, 22);
      ctx.fillStyle = "#1d1d1d"; ctx.font = "700 26px system-ui, sans-serif";
      ctx.textAlign = side ? "right" : "left";
      ctx.fillText(`${names[slot] || slot.toUpperCase()}  ${Math.ceil(val)}`, side ? x + 300 : x, 70);
    }
    ctx.textAlign = "left";
  }
  function drawBubble(ctx, f, text) {
    const j = worldJoints(f);
    const x = j.head.x, y = GROUND - j.head.y - 30;
    ctx.font = "600 22px system-ui, sans-serif";
    const w = Math.min(360, ctx.measureText(text).width + 22);
    const bx = clamp(x - w / 2, 4, W - w - 4);
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#222"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, y - 34, w, 34, 10) : ctx.rect(bx, y - 34, w, 34);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#222"; ctx.fillText(text, bx + 11, y - 10, w - 22);
  }

  // ---------- Player ----------
  // Plays a round. state = {p1, p2, props}; result from the server.
  function createScene(canvas) {
    const ctx = canvas.getContext("2d");
    canvas.width = W; canvas.height = H;
    let anim = null;

    function staticTrack(st) { return buildTrack(st, []); }
    function drawStatic(state, names) {
      if (anim) return;
      drawBackground(ctx);
      for (const p of state.props || []) drawShapes(ctx, p.shapes, { x: n(p.x, 0), y: n(p.y, 0), rot: n(p.rotation, 0), scale: n(p.scale, 1), opacity: 1 });
      for (const s of ["p1", "p2"]) drawFigure(ctx, sampleTrack(staticTrack(state[s]), 0));
      drawHud(ctx, names, { p1: state.p1.hp, p2: state.p2.hp });
    }

    function play(state, result, names) {
      return new Promise((resolve) => {
        const dur = clamp(n(result.duration, 4), 1, 10);
        const tracks = { p1: buildTrack(state.p1, result.fighters?.p1), p2: buildTrack(state.p2, result.fighters?.p2) };
        const fighterAt = (who, t) => sampleTrack(tracks[who], t);
        const scriptIds = new Set((result.props || []).map((p) => p && p.id));
        const keptProps = (state.props || []).filter((p) => !scriptIds.has(p.id));
        const emitters = (result.emitters || []).filter((e) => e && typeof e === "object").map((e) => ({ ...e, acc: 0, burstDone: false }));
        const hits = (result.hits || []).slice().sort((a, b) => a.t - b.t);
        const particles = [], pops = [];
        const hp = { p1: state.p1.hp, p2: state.p2.hp };
        const flashUntil = { p1: -1, p2: -1 };
        let hitIdx = 0, last = null, t = 0;
        const tail = 0.9;

        const pointOf = (spec, tt) => {
          if (!spec || typeof spec !== "object") return null;
          if (spec.who === "p1" || spec.who === "p2") return partInfo(fighterAt(spec.who, tt), spec.part);
          return { x: n(spec.x, 500), y: n(spec.y, 100) };
        };
        function emit(e, count, tt) {
          const o = pointOf(e.from, tt); if (!o) return;
          const tgt = pointOf(e.to, tt);
          const dir = tgt ? Math.atan2(tgt.y - o.y, tgt.x - o.x) / DEG : n(e.direction, 0);
          const colors = Array.isArray(e.colors) && e.colors.filter(isHex).length ? e.colors.filter(isHex) : ["#ff9a2e"];
          for (let i = 0; i < count && particles.length < 2500; i++) {
            const a = (dir + (Math.random() - 0.5) * n(e.spread, 20)) * DEG;
            const sp = n(e.speed, 300) * (0.7 + Math.random() * 0.6);
            particles.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
              life: clamp(n(e.life, 0.6), 0.05, 4) * (0.7 + Math.random() * 0.6),
              size: clamp(n(e.size, 6), 1, 80), sizeEnd: clamp(n(e.sizeEnd, n(e.size, 6)), 0, 120),
              color: colors[(Math.random() * colors.length) | 0], g: n(e.gravity, 0),
              shape: e.shape || "circle", glow: !!e.glow });
          }
        }

        function frame(now) {
          const dt = last == null ? 0 : Math.min(0.05, (now - last) / 1000);
          last = now; t += dt;
          const tt = Math.min(t, dur);

          // emitters
          for (const e of emitters) {
            const st = n(e.start, 0), en = n(e.end, st + 0.5);
            if (t >= st && !e.burstDone) { e.burstDone = true; emit(e, clamp(n(e.burst, 0), 0, 400), tt); }
            if (t >= st && t <= en) { e.acc += clamp(n(e.rate, 0), 0, 400) * dt; const k = Math.floor(e.acc); e.acc -= k; emit(e, k, tt); }
          }
          for (const p of particles) { p.age += dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
          for (let i = particles.length - 1; i >= 0; i--) if (particles[i].age > particles[i].life) particles.splice(i, 1);

          // hits
          while (hitIdx < hits.length && hits[hitIdx].t <= t) {
            const h = hits[hitIdx++];
            hp[h.target] = clamp(hp[h.target] - h.damage, 0, 100);
            if (h.damage > 0) flashUntil[h.target] = t + 0.18;
            const pi = partInfo(fighterAt(h.target, tt), "head");
            pops.push({ x: pi.x, y: pi.y + 30, text: h.damage > 0 ? `-${h.damage}` : `+${-h.damage}`, heal: h.damage < 0, age: 0 });
          }
          for (const p of pops) p.age += dt;

          // draw
          ctx.save();
          let shake = 0;
          for (const s of result.screen || []) {
            if (s && s.type === "shake" && t >= n(s.start, 0) && t <= n(s.start, 0) + n(s.duration, 0.3)) shake = Math.max(shake, clamp(n(s.intensity, 8), 0, 30));
          }
          if (shake) ctx.translate((Math.random() - 0.5) * shake * 2, (Math.random() - 0.5) * shake * 2);
          drawBackground(ctx);
          for (const p of keptProps) drawShapes(ctx, p.shapes, { x: n(p.x, 0), y: n(p.y, 0), rot: n(p.rotation, 0), scale: n(p.scale, 1), opacity: 1 });
          for (const pr of result.props || []) {
            if (!pr) continue;
            const pf = propFrame(pr, tt, fighterAt);
            if (pf) drawShapes(ctx, pr.shapes, pf);
          }
          for (const s of ["p1", "p2"]) drawFigure(ctx, fighterAt(s, tt), t < flashUntil[s]);
          for (const p of particles) {
            const u = p.age / p.life, sz = lerp(p.size, p.sizeEnd, u);
            const alpha = clamp(1 - u, 0, 1);
            ctx.fillStyle = p.color;
            const sx = p.x, sy = GROUND - p.y;
            if (p.glow) { ctx.globalAlpha = alpha * 0.22; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, sz), 0, Math.PI * 2); ctx.fill(); }
            ctx.globalAlpha = alpha;
            if (p.shape === "square") ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
            else if (p.shape === "spark") { ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, sz / 3); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - p.vx * 0.03, sy + p.vy * 0.03); ctx.stroke(); }
            else { ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.5, sz / 2), 0, Math.PI * 2); ctx.fill(); }
          }
          ctx.globalAlpha = 1;
          for (const sp of result.speech || []) {
            if (sp && (sp.who === "p1" || sp.who === "p2") && t >= n(sp.start, 0) && t <= n(sp.end, n(sp.start, 0) + 1.5))
              drawBubble(ctx, fighterAt(sp.who, tt), String(sp.text || "").slice(0, 60));
          }
          for (const p of pops) {
            if (p.age > 1.2) continue;
            ctx.globalAlpha = clamp(1.2 - p.age, 0, 1);
            ctx.font = "800 28px system-ui, sans-serif"; ctx.textAlign = "center";
            ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.fillStyle = p.heal ? "#1e9e4a" : "#d62828";
            ctx.strokeText(p.text, p.x, GROUND - p.y - p.age * 40); ctx.fillText(p.text, p.x, GROUND - p.y - p.age * 40);
            ctx.textAlign = "left"; ctx.globalAlpha = 1;
          }
          ctx.restore();
          for (const s of result.screen || []) {
            if (s && s.type === "flash" && t >= n(s.start, 0) && t <= n(s.start, 0) + n(s.duration, 0.2)) {
              ctx.globalAlpha = 0.6 * (1 - (t - n(s.start, 0)) / n(s.duration, 0.2));
              ctx.fillStyle = isHex(s.color) ? s.color : "#fff"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
            }
          }
          drawHud(ctx, names, hp);

          if (t < dur + tail) requestAnimationFrame(frame);
          else { anim = null; resolve(); }
        }
        anim = true;
        requestAnimationFrame(frame);
      });
    }
    return { drawStatic, play, isPlaying: () => !!anim };
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
