// Stick Duel — rooms, realtime sync, chatbox, and calling Claude.
(function () {
  const CFG = window.STICK_DUEL_CONFIG;
  const R = window.StickRenderer;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
    set(k, v, s = localStorage) { try { s.setItem(k, v); } catch {} },
  };

  // Per-tab identity, so two tabs on one device can be two players.
  let me = store.get("sd_id", sessionStorage);
  if (!me) { me = Math.random().toString(36).slice(2, 10); store.set("sd_id", me, sessionStorage); }

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const scene = R.createScene($("arena"));

  let room = null, channel = null, myName = "";
  let snap = null;                 // authoritative snapshot (held by host, mirrored by everyone)
  let pending = {};                // host only: { p1: text, p2: text }
  let display = R.initialState();  // what the canvas shows when idle
  let playing = false;
  let rounds = [];                 // every round this client has seen, for the final replay
  let replaying = false, skipReplay = false;
  let joinedAt = 0;

  // ---------- UI helpers ----------
  function log(kind, text) {
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.textContent = text;
    $("log").appendChild(div);
    $("log").scrollTop = $("log").scrollHeight;
  }
  const names = () => ({ p1: snap?.players?.p1?.name || "Player 1", p2: snap?.players?.p2?.name || "Player 2" });
  function mySlot() {
    if (!snap) return null;
    if (snap.players.p1.id === me) return "p1";
    if (snap.players.p2.id === me) return "p2";
    return null;
  }
  const isHost = () => (snap ? snap.players.p1.id === me : earliest() === me);
  function roster() {
    const ps = channel ? channel.presenceState() : {};
    return Object.entries(ps).map(([id, metas]) => ({ id, ...(metas[0] || {}) }))
      .sort((a, b) => (a.joinedAt - b.joinedAt) || a.id.localeCompare(b.id));
  }
  const earliest = () => roster()[0]?.id;

  function refreshUI() {
    if (!playing && !replaying) scene.drawStatic(display, names());
    const slot = mySlot();
    const input = $("input"), send = $("send"), status = $("status"), rematch = $("rematch");
    rematch.hidden = true; $("watch").hidden = true; $("skip").hidden = !replaying;
    let canType = false, text = "";
    if (!snap) text = "Waiting for an opponent. Share the link to invite someone.";
    else if (replaying) text = "Final replay";
    else if (playing) text = "Fight!";
    else if (snap.phase === "input") {
      const s = snap.submitted;
      if (!slot) text = "Spectating. Waiting for both players.";
      else if (s[slot]) text = `Locked in. Waiting for ${names()[slot === "p1" ? "p2" : "p1"]}…`;
      else { canType = true; text = `Round ${snap.round}: describe what your stick figure does.` + (s[slot === "p1" ? "p2" : "p1"] ? " (Opponent is locked in.)" : ""); }
    } else if (snap.phase === "resolving") text = "Claude is choreographing the round…";
    else if (snap.phase === "over") {
      text = snap.winner === "draw" ? "Draw!" : `${names()[snap.winner]} wins!`;
      rematch.hidden = !slot;
      $("watch").hidden = !rounds.length;
    }
    status.textContent = text;
    status.classList.toggle("busy", !!snap && snap.phase === "resolving");
    input.disabled = send.disabled = !canType;
    if (slot) input.placeholder = `You are ${slot === "p1" ? "Blue" : "Red"}. e.g. "jump 10ft and breathe fire down at them"`;
  }

  // ---------- Networking ----------
  function bcast(payload) { channel?.send({ type: "broadcast", event: "msg", payload }); }
  function pushSnap() { bcast({ type: "snap", snap }); refreshUI(); }

  function adoptSnap(s) {
    const first = !snap;
    if (snap && snap.phase === "over" && s.round === 1) { rounds = []; $("log").innerHTML = ""; log("sys", "Rematch!"); }
    snap = s;
    if (first || (!playing && s.round !== display._round)) { display = s.state; display._round = s.round; }
    refreshUI();
  }

  function onMessage({ payload: m }) {
    if (!m) return;
    if (m.type === "snap") {
      if (!snap || m.snap.round >= snap.round || m.snap.phase !== snap.phase) adoptSnap(m.snap);
    } else if (m.type === "submit" && isHost() && snap?.phase === "input") {
      if (snap.players[m.slot]?.id !== m.id) return;
      pending[m.slot] = String(m.text || "").slice(0, 300);
      snap.submitted[m.slot] = true;
      pushSnap(); maybeResolve();
    } else if (m.type === "result") {
      playResult(m);
    } else if (m.type === "error") {
      log("err", m.text);
    } else if (m.type === "rematch" && isHost() && snap?.phase === "over") {
      startGame(snap.players);
    }
  }

  function onPresence() {
    const list = roster();
    $("players").textContent = list.map((p) => p.name).join(" vs ") || "";
    if (!snap && isHost() && list.length >= 2) {
      // Give an existing snapshot a moment to arrive before starting fresh.
      setTimeout(() => {
        const l = roster();
        if (!snap && earliest() === me && l.length >= 2)
          startGame({ p1: { id: l[0].id, name: l[0].name }, p2: { id: l[1].id, name: l[1].name } });
      }, 1200);
    }
    refreshUI();
    if (snap) {
      const ids = new Set(list.map((p) => p.id));
      for (const s of ["p1", "p2"]) if (!ids.has(snap.players[s].id)) $("status").textContent = `${snap.players[s].name} disconnected — waiting for them to reopen the link.`;
    }
  }

  function startGame(players) {
    pending = {}; rounds = [];
    snap = { phase: "input", round: 1, players, state: R.initialState(), submitted: { p1: false, p2: false }, history: [], winner: null };
    display = snap.state; display._round = 1;
    $("log").innerHTML = "";
    log("sys", `${players.p1.name} (Blue) vs ${players.p2.name} (Red). Type what your figure does.`);
    log("sys", "Focus wins: an all-out attack hits harder, pure defense blocks most damage and charges your next attack (it strikes first), and mixing actions splits your power.");
    pushSnap();
  }

  async function maybeResolve() {
    if (!isHost() || snap.phase !== "input" || !snap.submitted.p1 || !snap.submitted.p2) return;
    snap.phase = "resolving"; pushSnap();
    const actions = { p1: pending.p1 || "", p2: pending.p2 || "" };
    const base = snap.state;
    try {
      const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/${CFG.FUNCTION_NAME}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`, apikey: CFG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ round: snap.round, state: base, actions, names: names(), history: snap.history.slice(-4) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.result) throw new Error(data.error || `Server error ${res.status}`);
      const result = data.result;
      const newState = R.finalize(base, result);
      const msg = { type: "result", round: snap.round, base, result, actions, newState, names: names() };
      bcast(msg);
      // update snapshot
      snap.state = newState;
      snap.history.push(`R${snap.round}: ${result.narration}`);
      snap.round += 1; snap.submitted = { p1: false, p2: false }; pending = {};
      const dead1 = newState.p1.hp <= 0, dead2 = newState.p2.hp <= 0;
      snap.phase = dead1 || dead2 ? "over" : "input";
      snap.winner = dead1 && dead2 ? "draw" : dead1 ? "p2" : dead2 ? "p1" : null;
      bcast({ type: "snap", snap });
      playResult(msg);
    } catch (e) {
      const text = `Round failed: ${e.message}. Both players, send your actions again.`;
      bcast({ type: "error", text }); log("err", text);
      snap.phase = "input"; snap.submitted = { p1: false, p2: false }; pending = {};
      pushSnap();
    }
  }

  async function playResult(m) {
    const n = m.names || names();
    log("act p1", `${n.p1}: ${m.actions.p1 || "(nothing)"}`);
    log("act p2", `${n.p2}: ${m.actions.p2 || "(nothing)"}`);
    rounds.push({ base: m.base, result: m.result, names: n });
    playing = true; refreshUI();
    try { await scene.play(m.base, m.result, n); } catch (e) { console.error(e); }
    playing = false;
    log("narr", m.result.narration || "");
    display = m.newState; display._round = m.round + 1;
    if (snap?.phase === "over") {
      log("sys", snap.winner === "draw" ? "It's a draw!" : `${names()[snap.winner]} wins!`);
      await runReplay();
    }
    refreshUI();
  }

  // Plays every round of the fight back to back after a KO.
  async function runReplay() {
    if (replaying || !rounds.length) return;
    replaying = true; skipReplay = false; refreshUI();
    const n = rounds[rounds.length - 1].names;
    try {
      await scene.card("FINAL REPLAY", `${n.p1} vs ${n.p2}`, 1800);
      for (let i = 0; i < rounds.length && !skipReplay; i++) {
        const r = rounds[i];
        await scene.play(r.base, r.result, r.names, { label: `REPLAY  ·  ROUND ${i + 1} / ${rounds.length}` });
      }
      if (!skipReplay && snap?.winner) await scene.card(snap.winner === "draw" ? "DRAW" : `${names()[snap.winner].toUpperCase()} WINS`, "", 2200);
    } catch (e) { console.error(e); }
    replaying = false;
    refreshUI();
  }

  // ---------- Actions ----------
  function submit() {
    const text = $("input").value.trim();
    const slot = mySlot();
    if (!text || !slot || snap?.phase !== "input" || snap.submitted[slot]) return;
    $("input").value = "";
    log("you", `You: ${text}`);
    if (isHost()) {
      pending[slot] = text.slice(0, 300); snap.submitted[slot] = true; pushSnap(); maybeResolve();
    } else {
      bcast({ type: "submit", slot, text, id: me });
      snap.submitted[slot] = true; refreshUI(); // optimistic
    }
  }

  async function joinRoom(code) {
    room = code.toUpperCase();
    myName = ($("name").value.trim() || "Player").slice(0, 20);
    store.set("sd_name", myName);
    history.replaceState(null, "", `?room=${room}`);
    $("lobby").hidden = true; $("game").hidden = false;
    $("roomcode").textContent = room;
    channel = sb.channel(`stickduel:${room}`, { config: { presence: { key: me }, broadcast: { self: false } } });
    channel.on("broadcast", { event: "msg" }, onMessage);
    channel.on("presence", { event: "sync" }, onPresence);
    channel.on("presence", { event: "join" }, () => { if (snap) bcast({ type: "snap", snap }); });
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") { joinedAt = Date.now(); await channel.track({ name: myName, joinedAt }); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") log("err", "Connection problem — try reloading.");
    });
    refreshUI();
  }

  // ---------- Wiring ----------
  $("name").value = store.get("sd_name") || "";
  $("create").onclick = () => {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    joinRoom(Array.from({ length: 4 }, () => abc[(Math.random() * abc.length) | 0]).join(""));
  };
  $("join").onclick = () => { const c = $("code").value.trim(); if (c.length >= 3) joinRoom(c); };
  $("send").onclick = submit;
  $("input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  $("skip").onclick = () => { skipReplay = true; scene.stop(); };
  $("watch").onclick = () => runReplay();
  $("rematch").onclick = () => (isHost() ? startGame(snap.players) : bcast({ type: "rematch" }));
  $("share").onclick = async () => {
    const url = location.href;
    try { if (navigator.share) await navigator.share({ title: "Stick Duel", url }); else { await navigator.clipboard.writeText(url); $("share").textContent = "Copied!"; setTimeout(() => ($("share").textContent = "Invite"), 1500); } } catch {}
  };

  const preset = new URLSearchParams(location.search).get("room");
  if (preset) { $("code").value = preset; $("joinhint").hidden = false; }
  scene.drawStatic(display, names());
})();
