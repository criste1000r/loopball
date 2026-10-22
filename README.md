# Loopball

You are a ring with one open side. Drive into the orb to cradle it, dash to fire it.
Play **2D** or **3D**, against bots or with friends online.

- `/` main page: pick 2D or 3D, enter a friend's code, set your name once for both games
- `/2d/` the 2D game
- `/3d/` the 3D game (hop, aerials, ball cam, goal replays)
- `server.js` serves the site and relays online matches. No dependencies, nothing to install.

## Play with friends

1. Open the site and tap **Host for friends** under 2D or 3D.
2. Send your friends the **invite link** (or just the 5-letter code).
3. In your lobby, set team size, bot skill and match length, move people between teams, or tap **Friends vs bots** to put everyone on Blue against bots.
4. Tap **Start**. Empty spots fill with bots. After a match, **Rematch** or **Back to lobby** to change things.

Matches are private by default (code only). Tap **Make public** to list yours under Open matches.

## Ranked

Ranked play is in both games (1v1, 2v2, 3v3, each with its own rank). There are no accounts: each browser
keeps a private key, and the **Star Chart** on the main page shows a recovery code that restores your ranks
on another device.

- The server hosts every ranked match, so results can't be faked from a browser.
- Ratings work like Elo/MMR: beating a higher-rated team earns more, losing to a lower-rated team costs more.
  Five placement matches count extra, then each match moves you about ±11 at even odds.
- Ranks: Stardust, Comet, Moon, Planet, Star, Nova and Pulsar (three divisions each), then Supernova, Quasar
  and Singularity. The top three have no divisions, and the bots there think ahead about every dash and turn.
- If nobody else is searching, bots of your rank fill the match after a few seconds.
- The main page has the leaderboards (top 100 per game and playlist).

### Keep ranks safe with Neon (free)

Render's free server forgets its files whenever it restarts, so ranks need a database. Neon's free plan is enough.

1. Sign up at neon.tech (free, no card). Create a project (any name, region **AWS US East**, close to Render Virginia).
2. On the project dashboard click **Connect** and copy the connection string (starts with `postgresql://`).
3. In Render, open your loopball service → **Environment** → **Add environment variable**:
   key `DATABASE_URL`, value: the connection string. Save; Render redeploys.
4. Check `https://<your-site>/api/health`: `"store":{"kind":"neon"...}` means it's connected.

The server creates its one table by itself. Without `DATABASE_URL` it still works, but keeps ranks in a local file
that is wiped on every restart.

## Put it online for free (Render)

Render's free plan runs this site, including online play.

### 1. Put this folder on GitHub
1. Sign in at github.com (free account).
2. Click **+ → New repository**, name it `loopball`, keep it **Public**, and create it.
3. On the new repo page, click **uploading an existing file**.
4. Drag in everything in this folder: `server.js`, `package.json`, `render.yaml`, `README.md`, `.gitignore`, and the whole `public` folder. Click **Commit changes**.

### 2. Deploy on Render
1. Sign up at render.com with your GitHub account (free, no card needed for the free plan).
2. Click **New → Blueprint**, pick your `loopball` repo, and click **Apply**. Render reads `render.yaml` and sets everything up.
   - Or use **New → Web Service**, pick the repo, set Start command to `node server.js` and Instance type to **Free**.
3. Wait a minute or two. Your game is live at a link like `https://loopball.onrender.com`. Send that to your friends.

Good to know about the free plan:
- The server sleeps after about 15 minutes with nobody playing. The next visitor waits up to a minute while it wakes up.
- Upgrading the instance on Render (about $7/month) keeps it always awake.

To update the game later, upload the changed files to the GitHub repo; Render redeploys on its own.

## Full screen on phones

- **iPhone (Safari):** Share → **Add to Home Screen**, then open Loopball from the home screen.
- **Android (Chrome):** menu ⋮ → **Install app**.

## Run it on your own computer

Install Node.js 18 or newer, then in this folder run `node server.js` and open http://localhost:3000.
Phones on the same Wi-Fi can join using your computer's local address, for example `http://192.168.1.20:3000`.

## Controls

- **Phone:** left thumb steers; right side dashes (and hops in 3D)
- **Computer:** pick in **Controls**: Mouse (point where to go, click to dash, right click to hop in 3D), Steer keys (W drive, A/D turn, adjustable turn speed), or Classic keys
- **Controller:** left stick; A/X/RT for actions
