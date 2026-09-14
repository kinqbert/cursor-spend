# Cursor spend

Local Node app that shows **your** Cursor spend for the current billing cycle.

You do not need to be a team admin and you do not need an API key. The app reads the session the Cursor app already stored on this machine and calls the same dashboard endpoints as [cursor.com/usage](https://cursor.com/usage).

A Cloud Agent / user key (`crsr_…` from API Keys) cannot do this. That key only talks to the Cloud Agents API. Team spend (`/teams/spend`) is admin-only. That's the 401 you hit.

## Run

Cursor must be signed in on this Mac.

```bash
cd ~/dev/cursor-spend
npm start
# http://127.0.0.1:3847
```

```bash
npm run spend
```

**On-demand** is extra billed usage this cycle. **Included** is usage covered by the plan.

You can delete the `usage-calculation` API key — this app never uses it.

## Optional

If Cursor isn't signed in here, put a session JWT in `.env` as `CURSOR_SESSION_TOKEN`. You almost certainly don't need that.
