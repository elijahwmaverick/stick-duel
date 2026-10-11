# Stick Duel

Two players, two stick figures, one chatbox each. Players type anything ("jump 10 ft and breathe fire down at them"), and Claude choreographs both moves into one animation and referees the outcome.

## How it works

- **index.html / game.js** — lobby with room codes, chatbox, and sync between players over Supabase Realtime (no database tables needed).
- **renderer.js** — plays Claude's animation scripts cinematically: jointed stick figures, props, particle effects, a camera that tracks and zooms, slow-motion, hit-stop, impact sparks and shockwaves, motion trails, landing dust, letterboxing and a K.O. finish. After a knockout it replays the whole fight round by round.
- **supabase/functions/resolve-round** — Edge Function that sends both actions and the game state to Claude and returns the script. Your Claude API key lives here as a secret, never in the page.
- **supabase/functions/resolve-round/geometry.js** — shared skeleton and hit-geometry code. The page loads it for drawing and the function uses it to check that every hit visibly connects, so the two always agree.

## Rules the engine enforces

- **Visible damage only.** Every hit names its source (a limb, a prop, or a particle emitter). If that source isn't touching the target at the hit time, the hit is moved to the moment it does connect, or dropped.
- **Turn focus.** Claude classifies each turn. An all-out attack deals ×1.25. A mixed turn deals ×0.65, or ×0.5 with three or more separate actions. A pure defender takes ×0.3 (shown as BLOCK).
- **Charge.** Pure defense builds 1 charge, or 2 if the player also charges up (max 3, shown as gold pips). Each level adds +40% to the next attack, which lands first. Charge is spent on attack.
- **Forms and stages persist.** Transformations (hair, auras, armor, whole new bodies) and locations stay until a later move changes them. Stage changes play an animated journey: digging down, flying up, dashing across, portals.

Each round both players lock in an action, then Player 1's browser asks the function to resolve it and broadcasts the result to everyone.

## Setup

1. **Claude API key.** Get one at console.anthropic.com (needs billing credits).
2. **Add it to Supabase.** Project *Connect War* → Edge Functions → Secrets → add `ANTHROPIC_API_KEY`.
   Optional: `CLAUDE_MODEL` (default `claude-sonnet-5-5`; `claude-haiku-5-5` is faster and cheaper but animates less carefully).
3. **Host the page.** Push this repo to GitHub, then Settings → Pages → Deploy from branch → `main`, `/ (root)`.
4. Open the Pages URL, tap **Create game**, then **Invite** to send the link to player 2.

The function is already deployed to the Connect War project. To redeploy after edits:
`supabase functions deploy resolve-round --project-ref ucdwqexhkglvhilurqti`

## Limits and known gaps

- Each round is one Claude call; expect roughly 20–60 seconds on Sonnet while it writes the animation. Supabase's free plan cuts function calls off at 150 seconds, so if long rounds time out, switch `CLAUDE_MODEL` to `claude-haiku-5-5`.
- Damage is capped server-side (25 per hit, 35 per fighter per round), so "I win instantly" can't end the game.
- Player actions are capped at 300 characters.
- Anyone with the page can call the function, which spends your API credits. Set a monthly spend limit in the Anthropic console.
- The final replay uses the rounds each browser saw, so someone who joined mid-fight only replays from when they joined.
- Player 1's browser runs the round logic. If Player 1 closes the tab mid-game, the round stalls until they return.
