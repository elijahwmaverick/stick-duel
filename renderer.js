// Stick Duel renderer: plays Claude's animation scripts on a canvas.
// Geometry (skeleton, tracks, props, forms) comes from geometry.js so it matches the server's hit checks.
(function () {
  const G = globalThis.StickGeometry;
  const { W, H, GROUND, DEG, L, POSE_KEYS, DEFAULT_POSE, n, clamp, lerp, isHex,
    buildTrack, sampleTrack, worldJoints, partInfo, partFrame, propFrame, formAt } = G;

  // ---------- Shapes ----------
  // Paints shapes in the current transform, local coords with y up.
  function paintShapes(ctx, shapes) {
    for (const s of (Array.isArray(shapes) ? shapes.slice(0, 80) : [])) {
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
  }
  function drawShapes(ctx, shapes, pf) {
    ctx.save();
    ctx.globalAlpha *= pf.opacity;
    ctx.translate(pf.x, GROUND - pf.y);
    ctx.rotate(-pf.rot * DEG);
    ctx.scale(pf.scale, -pf.scale);
    paintShapes(ctx, shapes);
    ctx.restore();
  }
  // Shapes in a body part's local frame (+y along the part, +x the way the figure faces).
  function drawOnPart(ctx, shapes, fr, scale) {
    ctx.save();
    ctx.translate(fr.x, GROUND - fr.y);
    ctx.transform(fr.fx * scale, -fr.fy * scale, fr.ax * scale, -fr.ay * scale, 0, 0);
    paintShapes(ctx, shapes);
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
  function drawFigure(ctx, f, form, flash) {
    if (!f.visible) return;
    const color = isHex(form?.color) ? form.color : f.color;
    const atts = Array.isArray(form?.attachments) ? form.attachments.filter((a) => a && Array.isArray(a.shapes)) : [];
    const glow = isHex(form?.glow) ? form.glow : null;
    for (const a of atts) if (a.behind) drawOnPart(ctx, a.shapes, partFrame(f, a.part), f.scale);
    ctx.save();
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 22; }
    if (form?.body && Array.isArray(form.body.shapes)) {
      drawOnPart(ctx, form.body.shapes, partFrame(f, "hip"), f.scale);
    } else {
      const j = worldJoints(f);
      if (flash) { ctx.save(); ctx.shadowColor = "#fff"; ctx.shadowBlur = 24; drawJoints(ctx, j, f, "#ffffff", 9, 1); ctx.restore(); }
      drawJoints(ctx, j, f, flash ? "#111" : color, n(form?.lineWidth, 6), 1);
    }
    ctx.restore();
    for (const a of atts) if (!a.behind) drawOnPart(ctx, a.shapes, partFrame(f, a.part), f.scale);
  }

  // ---------- Stages ----------
  const ARENA = {
    name: "Arena",
    sky: ["#9fc3df", "#f6f1e6"], hills: "#d3dde3",
    ground: { color: "#dacdb2", line: "#4a4033", marks: "rgba(74,64,51,.25)" },
    features: [90, 330, 670, 910].map((x) => ({ x, y: 0, shapes: [
      { type: "rect", x: -14, y: 0, w: 28, h: 190, fill: "#c2ced6" },
      { type: "rect", x: -22, y: 186, w: 44, h: 14, fill: "#c2ced6" }] })),
  };
  function normStage(s) {
    if (!s || typeof s !== "object") return ARENA;
    const sky = Array.isArray(s.sky) && s.sky.filter(isHex).length ? s.sky.filter(isHex) : ARENA.sky;
    const g = s.ground && typeof s.ground === "object" ? s.ground : {};
    return {
      name: String(s.name || "Stage").slice(0, 40), sky: sky.length === 1 ? [sky[0], sky[0]] : sky,
      hills: s.hills === null || s.hills === false ? null : isHex(s.hills) ? s.hills : null,
      ground: { color: isHex(g.color) ? g.color : ARENA.ground.color, line: isHex(g.line) ? g.line : ARENA.ground.line,
        marks: isHex(g.marks) ? g.marks : "rgba(0,0,0,.18)" },
      features: Array.isArray(s.features) ? s.features.filter((f) => f && Array.isArray(f.shapes)).slice(0, 30) : [],
      ambient: s.ambient && typeof s.ambient === "object" ? s.ambient : null,
      tint: isHex(s.tint) ? s.tint : null,
    };
  }
  function drawStage(ctx, stage, groundDepth = 400) {
    const st = normStage(stage);
    const g = ctx.createLinearGradient(0, -900, 0, GROUND);
    st.sky.forEach((c, i) => g.addColorStop(st.sky.length === 1 ? 0 : i / (st.sky.length - 1), c));
    ctx.fillStyle = g; ctx.fillRect(-400, -1200, W + 800, GROUND + 1200);
    if (st.hills) {
      ctx.fillStyle = st.hills;
      ctx.beginPath(); ctx.moveTo(-400, GROUND);
      for (let x = -400; x <= W + 400; x += 80) ctx.lineTo(x, GROUND - 70 - 40 * Math.sin(x * 0.011) - 25 * Math.sin(x * 0.027));
      ctx.lineTo(W + 400, GROUND); ctx.fill();
    }
    for (const f of st.features) drawShapes(ctx, f.shapes, { x: n(f.x, 0), y: n(f.y, 0), rot: n(f.rotation, 0), scale: n(f.scale, 1), opacity: clamp(n(f.opacity, 1), 0, 1) });
    ctx.fillStyle = st.ground.color; ctx.fillRect(-400, GROUND, W + 800, groundDepth);
    ctx.strokeStyle = st.ground.line; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-400, GROUND); ctx.lineTo(W + 400, GROUND); ctx.stroke();
    ctx.strokeStyle = st.ground.marks; ctx.lineWidth = 2;
    for (let x = -400; x < W + 400; x += 60) { ctx.beginPath(); ctx.moveTo(x, GROUND + 14); ctx.lineTo(x + 26, GROUND + 14); ctx.stroke(); }
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(-400, -1200, 400, GROUND + 1200); ctx.fillRect(W, -1200, 400, GROUND + 1200);
    if (st.tint) { ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = st.tint; ctx.fillRect(-400, -1200, W + 800, GROUND + 1600); ctx.restore(); }
  }
  // Scrolling texture shown while travelling between stages.
  function drawBetween(ctx, type, colors, scroll) {
    if (type === "descend" || type === "ascend") {
      const cols = colors && colors.length ? colors : type === "descend"
        ? ["#7a5634", "#5e4127", "#4a3322", "#3a2a1e", "#2c201a", "#4a1c10", "#7a2a10"]
        : ["#cfe6f7", "#b6d6ef", "#9cc6ea", "#7fb4e3", "#6aa3db"];
      const band = 150, total = band * cols.length;
      const dir = type === "descend" ? -1 : 1;
      for (let y = -1400; y < H + 600; y += band) {
        const idx = Math.floor((((y - dir * scroll) % total) + total) % total / band);
        const yy = y + ((dir * scroll) % band);
        ctx.fillStyle = cols[idx % cols.length]; ctx.fillRect(-400, yy, W + 800, band + 2);
        ctx.fillStyle = "rgba(0,0,0,.12)";
        for (let x = -400; x < W + 400; x += 70) ctx.fillRect(x + ((idx * 37) % 50), yy + ((x * 7 + idx * 13) % 90), 16, 9);
      }
      if (type === "ascend") {
        ctx.fillStyle = "rgba(255,255,255,.75)";
        for (let i = 0; i < 9; i++) {
          const cy = ((i * 173 + scroll * 1.4) % (H + 600)) - 300, cx = (i * 251) % W;
          ctx.beginPath(); ctx.ellipse(cx, cy, 110, 34, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    } else {
      ctx.fillStyle = (colors && colors[0]) || "#1d2230"; ctx.fillRect(-400, -1200, W + 800, H + 1600);
      ctx.strokeStyle = (colors && colors[1]) || "rgba(255,255,255,.55)"; ctx.lineWidth = 3;
      const dir = type === "left" ? 1 : -1;
      for (let i = 0; i < 40; i++) {
        const y = -300 + ((i * 97) % (H + 600)), len = 80 + (i * 53) % 220;
        const x = ((((i * 211 + dir * scroll * 3) % (W + 800)) + W + 800) % (W + 800)) - 400;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
      }
    }
  }
  // Draws the world background at time t, including any stage transition in progress.
  function drawStageAt(ctx, baseStage, changes, t, cam) {
    let cur = baseStage;
    for (const c of changes) {
      const d = c.dur, t0 = c.t;
      if (t < t0) break;
      if (t >= t0 + d) { cur = c.stage; continue; }
      const u = (t - t0) / d, type = c.type, from = cur, to = c.stage;
      const off = (H + 200) / Math.max(1, cam.zoom) * 1.6;
      if (type === "descend" || type === "ascend") {
        const sgn = type === "descend" ? -1 : 1; // old stage moves up when descending
        drawBetween(ctx, type, c.colors, u * 2600);
        if (u < 0.3) { const v = G.ease("in", u / 0.3); ctx.save(); ctx.translate(0, sgn * v * off); drawStage(ctx, from, 60); ctx.restore(); }
        else if (u > 0.7) { const v = G.ease("out", (u - 0.7) / 0.3); ctx.save(); ctx.translate(0, -sgn * (1 - v) * off); drawStage(ctx, to, 400); ctx.restore(); }
      } else if (type === "left" || type === "right") {
        const sgn = type === "left" ? 1 : -1, offx = (W + 800) / Math.max(1, cam.zoom);
        drawBetween(ctx, type, c.colors, u * 2600);
        if (u < 0.3) { ctx.save(); ctx.translate(sgn * G.ease("in", u / 0.3) * offx, 0); drawStage(ctx, from); ctx.restore(); }
        else if (u > 0.7) { ctx.save(); ctx.translate(-sgn * (1 - G.ease("out", (u - 0.7) / 0.3)) * offx, 0); drawStage(ctx, to); ctx.restore(); }
      } else if (type === "portal") {
        drawStage(ctx, from);
        const px = n(c.at?.x, cam.x), py = c.at ? GROUND - n(c.at.y, 150) : cam.y;
        const r = G.ease("in", u) * 1600;
        ctx.save(); ctx.beginPath(); ctx.arc(px, py, Math.max(1, r), 0, Math.PI * 2); ctx.clip(); drawStage(ctx, to); ctx.restore();
        ctx.save(); ctx.strokeStyle = (c.colors && c.colors[0]) || "#b26bff"; ctx.lineWidth = 14; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 30;
        ctx.beginPath(); ctx.arc(px, py, Math.max(1, r), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      } else { // fade / flash
        drawStage(ctx, u < 0.5 || type === "fade" ? from : to);
        if (type === "fade") { ctx.save(); ctx.globalAlpha = u; drawStage(ctx, to); ctx.restore(); }
        else { ctx.save(); ctx.globalAlpha = 1 - Math.abs(u - 0.5) * 2; ctx.fillStyle = "#fff"; ctx.fillRect(-400, -1200, W + 800, H + 1600); ctx.restore(); }
      }
      return { stage: u < 0.5 ? from : to, transitioning: true };
    }
    drawStage(ctx, cur);
    return { stage: cur, transitioning: false };
  }
  function stageChangesOf(result) {
    return (Array.isArray(result.stageChanges) ? result.stageChanges : [])
      .filter((c) => c && c.stage && typeof c.stage === "object")
      .map((c) => {
        const tr = c.transition && typeof c.transition === "object" ? c.transition : {};
        const type = ["descend", "ascend", "left", "right", "portal", "fade", "flash"].includes(tr.type) ? tr.type : "fade";
        const colors = Array.isArray(tr.colors) ? tr.colors.filter(isHex) : null;
        return { t: n(c.t, 0), dur: clamp(n(tr.duration, type === "flash" ? 0.4 : 1.6), 0.2, 6), type, colors, at: tr.at, stage: c.stage };
      }).sort((a, b) => a.t - b.t);
  }

  // ---------- HUD and overlays ----------
  function drawHud(ctx, names, hp, label, charge, tags) {
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
      // charge pips
      const c = clamp(n(charge?.[slot], 0), 0, 3);
      for (let i = 0; i < 3; i++) {
        const cx = side ? x + 300 - 12 - i * 22 : x + 12 + i * 22, cy = 88;
        ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx, cy + 8); ctx.lineTo(cx - 8, cy); ctx.closePath();
        ctx.fillStyle = i < c ? "#ffcf2e" : "rgba(0,0,0,.25)"; ctx.fill(); ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5; ctx.stroke();
      }
      if (tags && tags[slot]) {
        ctx.font = "900 20px system-ui, sans-serif";
        const tx = side ? x + 300 - 80 : x + 80;
        ctx.lineWidth = 4; ctx.strokeStyle = "#111"; ctx.strokeText(tags[slot], tx, 96);
        ctx.fillStyle = tags[slot].startsWith("DEF") ? "#7fd0ff" : tags[slot].startsWith("ATT") ? "#ff8a5c" : tags[slot].startsWith("MIX") ? "#d0d0d0" : "#9dff9d";
        ctx.fillText(tags[slot], tx, 96);
      }
    }
    if (label) {
      ctx.textAlign = "center"; ctx.font = "800 22px system-ui, sans-serif"; ctx.fillStyle = "#fff";
      ctx.fillText(label, W / 2, H - 12);
    }
    ctx.textAlign = "left";
  }
  function focusTag(a) {
    if (!a || typeof a !== "object") return null;
    switch (a.focus) {
      case "offense": return "ATTACK";
      case "defense": return a.charging ? "DEFEND + CHARGE" : "DEFEND";
      case "utility": return "UTILITY";
      case "mixed": return `MIXED ×${clamp(n(a.parts, 2), 2, 5)}`;
      default: return null;
    }
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
    ctx.font = "900 italic 84px system-ui, sans-serif"; ctx.fillText(title, W / 2, H / 2 + 10, W - 60);
    if (sub) { ctx.font = "700 26px system-ui, sans-serif"; ctx.fillStyle = "#cfcfcf"; ctx.fillText(sub, W / 2, H / 2 + 56); }
    ctx.textAlign = "left";
  }
  function drawStageName(ctx, name, age) {
    if (age > 2.2) return;
    const a = age < 0.3 ? age / 0.3 : age > 1.7 ? (2.2 - age) / 0.5 : 1;
    ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = "900 italic 44px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.lineWidth = 7; ctx.strokeStyle = "#111"; ctx.strokeText(name.toUpperCase(), W / 2, 150);
    ctx.fillStyle = "#fff"; ctx.fillText(name.toUpperCase(), W / 2, 150);
    ctx.restore();
  }

  // ---------- Camera ----------
  function setCamera(ctx, cam) {
    const z = cam.zoom;
    const cx = clamp(cam.x, W / (2 * z), W - W / (2 * z));
    const cy = Math.min(cam.y, H - H / (2 * z));
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
      drawStage(ctx, state.stage);
      for (const p of state.props || []) drawShapes(ctx, p.shapes, { x: n(p.x, 0), y: n(p.y, 0), rot: n(p.rotation, 0), scale: n(p.scale, 1), opacity: 1 });
      for (const s of ["p1", "p2"]) {
        const form = state[s].form;
        const glow = isHex(form?.aura?.colors?.[0]) ? form.aura.colors[0] : (n(state[s].charge, 0) > 0 ? "#ffcf2e" : null);
        const f = sampleTrack(buildTrack(state[s], []), 0);
        if (glow && !form?.glow) drawFigure(ctx, f, { ...form, glow }); else drawFigure(ctx, f, form);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawVignette(ctx);
      drawHud(ctx, names, { p1: state.p1.hp, p2: state.p2.hp }, null, { p1: state.p1.charge, p2: state.p2.charge });
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

    // opts: { label } — label shows in the bottom letterbox (used by the replay)
    function play(state, result, names, opts = {}) {
      abort = false;
      return new Promise((resolve) => {
        const dur = clamp(n(result.duration, 4), 1, 10);
        const tracks = { p1: buildTrack(state.p1, result.fighters?.p1), p2: buildTrack(state.p2, result.fighters?.p2) };
        const fighterAt = (who, t) => sampleTrack(tracks[who], t);
        const formChanges = (Array.isArray(result.formChanges) ? result.formChanges : []).filter((c) => c && (c.who === "p1" || c.who === "p2") && c.form);
        const formOf = (who, t) => formAt(state[who].form, formChanges, who, t);
        const stageChanges = stageChangesOf(result);
        const scriptIds = new Set((result.props || []).map((p) => p && p.id));
        const keptProps = (state.props || []).filter((p) => !scriptIds.has(p.id));
        const emitters = (result.emitters || []).filter((e) => e && typeof e === "object").map((e) => ({ ...e, acc: 0, burstDone: false }));
        const hits = (result.hits || []).slice().sort((a, b) => a.t - b.t);
        const cams = (Array.isArray(result.camera) ? result.camera : []).filter(Boolean).map((c) => ({ ...c, t: n(c.t, 0) })).sort((a, b) => a.t - b.t);
        const slows = (Array.isArray(result.slowmo) ? result.slowmo : []).filter(Boolean)
          .map((s) => ({ start: n(s.start, 0), end: n(s.end, 0), speed: clamp(n(s.speed, 0.3), 0.1, 1) }));
        const charge0 = { p1: n(state.p1.charge, 0), p2: n(state.p2.charge, 0) };
        const tags = { p1: focusTag(result.analysis?.p1), p2: focusTag(result.analysis?.p2) };
        const particles = [], pops = [], rings = [];
        const hp = { p1: state.p1.hp, p2: state.p2.hp };
        const flashUntil = { p1: -1, p2: -1 };
        const trails = { p1: [], p2: [] };
        const prev = { p1: null, p2: null };
        const wasAir = { p1: !!state.p1.air, p2: !!state.p2.air };
        const formSeen = { p1: 0, p2: 0 };
        const cam = { zoom: 1, x: W / 2, y: H / 2, sx: 0, sy: 0, kick: 0 };
        const ambientAcc = { v: 0 }, auraAcc = { p1: 0, p2: 0 };
        let shakeAmt = 0, hitstop = 0, ko = null, koAge = 0, whiteFlash = 0, stageName = null, stageNameAge = 0, lastStage = state.stage;
        let hitIdx = 0, last = null, t = 0, real = 0;
        const tail = 1.0;

        const pointOf = (spec, tt) => {
          if (!spec || typeof spec !== "object") return null;
          if (spec.who === "p1" || spec.who === "p2") return partInfo(fighterAt(spec.who, tt), spec.part);
          return { x: n(spec.x, 500), y: n(spec.y, 100) };
        };
        function spawn(o, dirDeg, count, spec) {
          for (let i = 0; i < count && particles.length < 3200; i++) {
            const a = (dirDeg + (Math.random() - 0.5) * spec.spread) * DEG;
            const sp = spec.speed * (0.6 + Math.random() * 0.8);
            particles.push({ x: o.x + (spec.jitter ? (Math.random() - 0.5) * spec.jitter : 0), y: o.y + (spec.jitterY ? (Math.random() - 0.5) * spec.jitterY : 0),
              vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
              life: spec.life * (0.7 + Math.random() * 0.6), size: spec.size, sizeEnd: spec.sizeEnd,
              color: spec.colors[(Math.random() * spec.colors.length) | 0], g: spec.gravity, shape: spec.shape, glow: spec.glow, fadeIn: !!spec.fadeIn });
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
          add(x0, 0);
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

          for (const e of emitters) {
            const st = n(e.start, 0), en = n(e.end, st + 0.5);
            if (t >= st && !e.burstDone) { e.burstDone = true; emit(e, clamp(n(e.burst, 0), 0, 400), tt); }
            if (t >= st && t <= en) { e.acc += clamp(n(e.rate, 0), 0, 400) * dt; const k = Math.floor(e.acc); e.acc -= k; emit(e, k, tt); }
          }

          const frames = {}, forms = {};
          for (const s of ["p1", "p2"]) {
            const f = fighterAt(s, tt); frames[s] = f;
            forms[s] = formOf(s, tt);
            const j = worldJoints(f);
            if (prev[s] && dt > 0) {
              const sp = (Math.hypot(j.hip.x - prev[s].hip.x, j.hip.y - prev[s].hip.y) +
                Math.hypot(j.fh.x - prev[s].fh.x, j.fh.y - prev[s].fh.y) + Math.hypot(j.ff.x - prev[s].ff.x, j.ff.y - prev[s].ff.y)) / dt;
              trails[s].push({ j, f, fast: sp > 1100 && f.visible && !forms[s]?.body });
            }
            if (trails[s].length > 6) trails[s].shift();
            if (dt > 0) prev[s] = j;
            if (wasAir[s] && !f.air && f.visible) {
              const feet = { x: f.x, y: 2 };
              const dust = { spread: 30, speed: 160, life: 0.5, size: 8, sizeEnd: 22, colors: ["#bba98a", "#cbbd9f"], gravity: -20, shape: "circle", glow: false };
              spawn(feet, 0, 10, dust); spawn(feet, 180, 10, dust);
              shakeAmt = Math.max(shakeAmt, 4);
            }
            wasAir[s] = f.air;
            // transformation burst when a form change kicks in
            const fcCount = formChanges.filter((c) => c.who === s && n(c.t, 0) <= t).length;
            if (fcCount > formSeen[s]) {
              formSeen[s] = fcCount;
              const pi = partInfo(f, "chest");
              const fc = forms[s] || {};
              const cols = (fc.aura?.colors || []).filter(isHex);
              spawn(pi, 90, 70, { spread: 360, speed: 420, life: 0.6, size: 7, sizeEnd: 1, colors: cols.length ? cols : [isHex(fc.glow) ? fc.glow : "#ffffff", "#ffe27a"], gravity: 0, shape: "spark", glow: true });
              rings.push({ x: pi.x, y: pi.y, age: 0, max: 220 });
              whiteFlash = Math.max(whiteFlash, 0.1); shakeAmt = Math.max(shakeAmt, 10);
            }
            // aura: from the form, or a gold shimmer while holding charge
            const aura = forms[s]?.aura && typeof forms[s].aura === "object" ? forms[s].aura : (charge0[s] > 0 && !(hits.some((h) => h.by === s && h.t <= t)) ? { colors: ["#ffcf2e", "#fff3b0"], rate: 18 * charge0[s], size: 5 } : null);
            if (aura && f.visible && dt > 0) {
              auraAcc[s] += clamp(n(aura.rate, 40), 0, 200) * dt;
              const k = Math.floor(auraAcc[s]); auraAcc[s] -= k;
              const cols = (aura.colors || []).filter(isHex);
              const pi = partInfo(f, "chest");
              spawn(pi, 90, k, { spread: 50, speed: 110, life: 0.55, size: clamp(n(aura.size, 7), 2, 30), sizeEnd: 1, colors: cols.length ? cols : ["#ffffff"],
                gravity: -120, shape: "circle", glow: true, jitter: 70 * f.scale, jitterY: 100 * f.scale });
            }
          }

          for (const p of particles) { p.age += dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
          for (let i = particles.length - 1; i >= 0; i--) if (particles[i].age > particles[i].life) particles.splice(i, 1);

          while (hitIdx < hits.length && hits[hitIdx].t <= t) {
            const h = hits[hitIdx++];
            hp[h.target] = clamp(hp[h.target] - h.damage, 0, 100);
            const pi = partInfo(fighterAt(h.target, tt), "chest");
            const label = h.damage < 0 ? `+${-h.damage}` : h.blocked ? (h.damage > 0 ? `BLOCK -${h.damage}` : "BLOCKED") : `-${h.damage}${h.charged ? "!" : ""}`;
            pops.push({ x: pi.x, y: pi.y + 60, text: label, heal: h.damage < 0, blocked: !!h.blocked, age: 0, big: h.damage >= 18 || h.charged });
            if (h.blocked) {
              spawn(pi, 90, 14, { spread: 360, speed: 300, life: 0.3, size: 4, sizeEnd: 1, colors: ["#7fd0ff", "#ffffff"], gravity: 0, shape: "spark", glow: true });
              rings.push({ x: pi.x, y: pi.y, age: 0, max: 50, color: "127,208,255" });
              shakeAmt = Math.max(shakeAmt, 4); hitstop = Math.max(hitstop, 0.04);
            }
            if (h.damage > 0) {
              flashUntil[h.target] = real + 0.12;
              hitstop = Math.max(hitstop, 0.05 + h.damage * 0.006 + (h.charged ? 0.12 : 0));
              shakeAmt = Math.max(shakeAmt, 5 + h.damage * 0.7);
              cam.kick = Math.max(cam.kick, 0.08 + h.damage * 0.006);
              rings.push({ x: pi.x, y: pi.y, age: 0, max: 40 + h.damage * 3 + (h.charged ? 120 : 0) });
              spawn(pi, 90, 18 + h.damage + (h.charged ? 50 : 0), { spread: 360, speed: 380 + h.damage * 14, life: 0.35, size: 4, sizeEnd: 1, colors: h.charged ? ["#ffffff", "#ffcf2e", "#ff7a2e"] : ["#ffffff", "#ffe27a", "#ffb02e"], gravity: 300, shape: "spark", glow: true });
              if (h.damage >= 18 || h.charged) { slows.push({ start: t, end: t + 0.45, speed: 0.3 }); whiteFlash = 0.12; }
              if (hp[h.target] <= 0 && !ko) { ko = { target: h.target }; koAge = 0; whiteFlash = 0.2; hitstop = 0.25; }
            }
          }
          for (const p of pops) p.age += rdt;
          for (const r of rings) r.age += rdt;

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

          // ----- world -----
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          setCamera(ctx, { ...cam, zoom: cam.zoom + cam.kick });
          const sinfo = drawStageAt(ctx, state.stage, stageChanges, tt, cam);
          if (sinfo.stage !== lastStage && !sinfo.transitioning) { lastStage = sinfo.stage; stageName = normStage(lastStage).name; stageNameAge = 0; }
          if (sinfo.transitioning) shakeAmt = Math.max(shakeAmt, 3);
          stageNameAge += rdt;
          // ambient particles of the current stage
          const amb = normStage(sinfo.stage).ambient;
          if (amb && dt > 0) {
            ambientAcc.v += clamp(n(amb.rate, 30), 0, 150) * dt;
            const kk = Math.floor(ambientAcc.v); ambientAcc.v -= kk;
            const cols = (amb.colors || []).filter(isHex);
            for (let i = 0; i < kk; i++) spawn({ x: Math.random() * W, y: Math.random() * 480 }, n(amb.direction, 90), 1,
              { spread: 40, speed: n(amb.speed, 40), life: clamp(n(amb.life, 2.5), 0.3, 6), size: clamp(n(amb.size, 4), 1, 20), sizeEnd: clamp(n(amb.size, 4), 1, 20),
                colors: cols.length ? cols : ["#ffffff"], gravity: n(amb.gravity, 0), shape: "circle", glow: !!amb.glow, fadeIn: true });
          }
          if (!sinfo.transitioning) for (const p of keptProps) drawShapes(ctx, p.shapes, { x: n(p.x, 0), y: n(p.y, 0), rot: n(p.rotation, 0), scale: n(p.scale, 1), opacity: 1 });
          for (const pr of result.props || []) {
            if (!pr) continue;
            const pf = propFrame(pr, tt, fighterAt);
            if (pf) drawShapes(ctx, pr.shapes, pf);
          }
          for (const s of ["p1", "p2"]) {
            const col = isHex(forms[s]?.color) ? forms[s].color : null;
            trails[s].forEach((e, i) => { if (e.fast) drawJoints(ctx, e.j, e.f, col || e.f.color, 5, 0.07 + 0.05 * i); });
          }
          for (const s of ["p1", "p2"]) drawFigure(ctx, frames[s], forms[s], real < flashUntil[s]);
          for (const r of rings) {
            if (r.age > 0.3) continue;
            const u = r.age / 0.3;
            ctx.beginPath(); ctx.arc(r.x, GROUND - r.y, 10 + r.max * u, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${r.color || "255,255,255"},${1 - u})`; ctx.lineWidth = 8 * (1 - u) + 1; ctx.stroke();
          }
          for (const p of particles) {
            const u = p.age / p.life, sz = lerp(p.size, p.sizeEnd, u);
            const alpha = p.fadeIn ? Math.sin(Math.PI * clamp(u, 0, 1)) * 0.8 : clamp(1 - u, 0, 1);
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
            ctx.lineWidth = 6; ctx.strokeStyle = "#111";
            ctx.fillStyle = p.heal ? "#4be27e" : p.blocked ? "#7fd0ff" : (p.big ? "#ffd23f" : "#fff");
            ctx.strokeText(p.text, 0, 0); ctx.fillText(p.text, 0, 0);
            ctx.restore();
          }

          // ----- overlays -----
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          drawVignette(ctx);
          if (whiteFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(whiteFlash * 4, 0, 0.85)})`; ctx.fillRect(0, 0, W, H); whiteFlash -= rdt; }
          const lb = Math.min(1, real / 0.35) * (t > dur + tail - 0.35 ? clamp((dur + tail - t) / 0.35, 0, 1) : 1);
          drawLetterbox(ctx, lb);
          if (stageName) drawStageName(ctx, stageName, stageNameAge);
          drawHud(ctx, names, hp, opts.label, charge0, real < 2.5 ? tags : null);
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
    const fc = (Array.isArray(result.formChanges) ? result.formChanges : []).filter((c) => c && c.form);
    for (const s of ["p1", "p2"]) {
      const f = sampleTrack(buildTrack(state[s], result.fighters?.[s]), dur);
      const rot = ((f.rotation % 360) + 540) % 360 - 180;
      out[s] = {
        x: Math.round(f.x), y: Math.round(f.hipY), air: !!f.air, facing: f.facing,
        rotation: Math.round(rot), scale: +f.scale.toFixed(2), color: f.color, visible: f.visible,
        pose: Object.fromEntries(POSE_KEYS.map((k) => [k, Math.round(f.pose[k])])),
        hp: n(result.hp?.[s], state[s].hp),
        charge: clamp(n(result.charge?.[s], n(state[s].charge, 0)), 0, 3),
        form: formAt(state[s].form, fc, s, dur + 1) || null,
        statuses: (result.endState?.[s]?.statuses || []).slice(0, 5),
      };
      if (out[s].hp <= 0) Object.assign(out[s], { air: false, rotation: out[s].rotation >= 0 ? 90 : -90 });
    }
    const sc = stageChangesOf(result);
    out.stage = sc.length ? sc[sc.length - 1].stage : (state.stage || null);
    out.props = sc.length && !(result.endState?.props || []).length ? [] :
      (result.endState?.props || []).filter((p) => p && Array.isArray(p.shapes)).slice(0, 12);
    return out;
  }

  function initialState() {
    const base = (x, facing, color) => ({ x, y: 64, air: false, facing, rotation: 0, scale: 1, color, visible: true,
      pose: { ...DEFAULT_POSE }, hp: 100, charge: 0, form: null, statuses: [] });
    return { p1: base(250, 1, "#2f7fd6"), p2: base(750, -1, "#d64545"), props: [], stage: null };
  }

  window.StickRenderer = { createScene, finalize, initialState, buildTrack, sampleTrack };
})();
