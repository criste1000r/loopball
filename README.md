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
