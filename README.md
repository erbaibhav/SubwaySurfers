# Last Runner Standing

A multiplayer endless-runner "battle royale" — everyone races the same procedurally generated obstacle track at once, and the last player still alive wins. Think Subway Surfers, but the whole room runs the same track together.

**Play it here:** https://claude.ai/artifact/MDcgqHobJZvebupYP53bTS

## Setup

There's nothing to install. The game is a single self-contained HTML page hosted as a Claude Artifact.

1. Open the link above (or the `last-runner-standing.html` file, if you're hosting it yourself as a Claude Artifact).
2. It works on desktop and mobile browsers — no account, download, or extra app needed.

If you want to host your own copy instead of using the shared link, publish `last-runner-standing.html` as a Claude Artifact yourself (via the Artifact tool's `publish` action). A plain upload to a normal web server will **not** work, because the multiplayer room system is a capability only available inside Claude's Artifact runtime.

## How room-sharing / multiplayer works

- **Creating a room:** one player enters a name and taps **Create room**. This generates a random 5-letter room code and opens a lobby.
- **Joining a room:** other players open the same game link, enter a name and the room code, and tap **Join**.
- **Starting:** the room creator (host) taps **Start game** once everyone has joined. There's a 3-second countdown before the track begins moving for everyone.
- **Staying in sync:** each player's device runs its own copy of the game, but everyone uses the same "seed" (derived from the room code) to generate the identical sequence of obstacles and coins, so all players see the same track. Player positions, distance, coins, and alive/dead status are shared live through the room so you can see other runners as ghosts on your own screen and watch a live scoreboard.
- **Late joiners:** anyone who joins after the host has already started becomes a **spectator** for that round — they can watch but not play until the next game.
- **Who can join a room:** only people in your organization, or people you've explicitly invited as guests to the artifact, can connect. A room code alone won't let a random stranger with just the public link join — they need access to the artifact itself first.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move left | `←` or `A` | Swipe left |
| Move right | `→` or `D` | Swipe right |
| Jump | `↑`, `W`, or `Space` | Swipe up |

You run on a 3-lane road. Red barriers must be dodged by changing lanes; yellow-and-black low barriers can be jumped over.

## Scoring

- You gain distance automatically just by staying alive; the pace gradually speeds up the longer you survive.
- Gold coins are scattered along the track in each lane — running through one adds to your coin count.
- **Score = distance traveled + 10 points per coin collected.**
- The live scoreboard (below the track) ranks every player in the room by score in real time, and shows who's still alive.
- **Winning:** the round ends when only one player is still alive — that player wins. If everyone crashes at roughly the same time, whoever has the highest score at that point is declared the winner.

## Known limitations

- **Room access is org/invite-gated.** As noted above, players need to already have access to the artifact (same organization, or an explicit invite) — a bare link isn't enough for a total stranger to join a room.
- **Late joiners can't join an in-progress round** — they spectate until the next game starts.
- **No server-authoritative timing.** Each player's obstacle timing and speed run locally on their own device; the game syncs positions/scores but not exact frame timing, so there can be small discrepancies between players' clocks (e.g., a very close finish might look slightly different on two screens).
- **Visual style:** this version uses a simple, flat, light-themed 2D look with a basic pseudo-3D perspective (lanes converge toward a horizon), colorful buildings, and simple train/barrier obstacles — it's intentionally lightweight rather than a full 3D game engine.
- **No persistence:** scores and rooms are not saved between sessions — closing the tab or ending the game loses that round's data. There's no account system, leaderboard history, or matchmaking.
- **No power-ups yet** (no magnets, shields, or speed boosts) and no rematch button — players return to the main menu after a round ends and need to create/join a new room to play again.

## Possible next steps

If you want to keep building this out, natural additions would be power-ups (magnet, shield, speed boost), a "Play again" button that re-launches the same room without going back to the menu, character skins, and a proper 3D-style rendering pass.
