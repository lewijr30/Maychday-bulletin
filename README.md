# Matchday Bulletin

Two pages, one backend:
- **`/`** — public fixture feed. Anyone can view, nobody can edit. Refreshes itself every 30s.
- **`/admin.html`** — password-gated. Post, edit, delete fixtures and send them to your Telegram channel/group.

Tested locally: public reads, unauthenticated writes correctly rejected (401),
password login, authenticated writes, and both pages serving — all verified
before packaging.

## 1. Set up your bot

Same as before: message **@BotFather** → `/newbot` → copy the token. Then
decide where fixtures get posted (channel `@username` with the bot as admin,
a group's numeric ID, or your own user ID).

## 2. Configure

```
cd matchday-bulletin
cp .env.example .env
```
Edit `.env`:
- `BOT_TOKEN` / `CHAT_ID` — for posting to Telegram
- `ADMIN_PASSWORD` — whatever you want to log into `/admin.html` with. **Pick a real one** — this is the only thing standing between the public and your posting panel.

## 3. Run it

```
node server.js
```
- Customer view: `http://localhost:3000`
- Your posting panel: `http://localhost:3000/admin.html`

No `npm install` needed — zero dependencies.

## 4. Deploy (so it has a public HTTPS URL)

Render.com, Railway.app, or Glitch.com all work — same steps as any Node app:
1. Upload/push this folder.
2. Start command: `node server.js`.
3. Add `BOT_TOKEN`, `CHAT_ID`, `ADMIN_PASSWORD` as environment variables in the host's dashboard.
4. Deploy — you'll get a URL like `https://your-app.onrender.com`.

Share `https://your-app.onrender.com` with customers (or register it with
BotFather via `/newapp` as your Telegram Mini App). Keep
`https://your-app.onrender.com/admin.html` to yourself.

## Notes on the admin password

It's checked on every write (add/edit/delete/send) via a header, over HTTPS.
That's solid for a small personal or single-operator tool, but it's not a
full user-account system — anyone with the password has full access, and
there's no per-user log of who posted what. Fine for "me posting to my own
channel"; if you ever need multiple named admins or an audit trail, that's
a bigger step up (real accounts + a database) worth flagging separately.

## Data storage

Fixtures live in `events.json` next to `server.js`. Some hosts (Glitch)
preserve this across restarts; others (a fresh Render deploy) may reset the
filesystem — don't treat it as permanent archive without a backup.
