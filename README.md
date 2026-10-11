# Stick Duel

Two players, two stick figures, one chatbox each. Players type anything ("jump 10 ft and breathe fire down at them"), and Claude choreographs both moves into one animation and referees the outcome.

## How it works

- **index.html / game.js** — lobby with room codes, chatbox, and sync between players over Supabase Realtime (no database tables needed).
- **renderer.js** — draws the arena and plays Claude's animation scripts: jointed stick figures, props (weapons, summoned objects), particle effects, hits, speech bubbles, screen shake.
- **supabase/functions/resolve-round** — Edge Function that sends both actions and the game state to Claude and returns the script. Your Claude API key lives here as a secret, never in the page.

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

- Each round is one Claude call; expect roughly 10–40 seconds on Sonnet while it writes the animation.
- Damage is capped server-side (25 per hit, 35 per fighter per round), so "I win instantly" can't end the game.
- Player actions are capped at 300 characters.
- Anyone with the page can call the function, which spends your API credits. Set a monthly spend limit in the Anthropic console.
- Player 1's browser runs the round logic. If Player 1 closes the tab mid-game, the round stalls until they return.
