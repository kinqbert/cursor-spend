import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SpendError } from "./errors.js";

const execFileAsync = promisify(execFile);

export function stateDbPath() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? "", "Cursor/User/globalStorage/state.vscdb");
  }
  return join(homedir(), ".config/Cursor/User/globalStorage/state.vscdb");
}

function unwrapToken(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
      if (parsed && typeof parsed.token === "string") return parsed.token;
    } catch {
      // stored as a raw JWT
    }
  }
  return trimmed.replace(/^"+|"+$/g, "");
}

function decodeJwtPayload(jwt) {
  const [, payload] = jwt.split(".");
  if (!payload) throw new SpendError(401, { message: "Cursor session token is not a JWT" });
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

async function readTokenFromSqlite() {
  const db = stateDbPath();
  const sql = "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';";
  try {
    const { stdout } = await execFileAsync("sqlite3", ["-readonly", db, sql]);
    return unwrapToken(stdout);
  } catch (readonlyError) {
    try {
      const { stdout } = await execFileAsync("sqlite3", [db, sql]);
      return unwrapToken(stdout);
    } catch (error) {
      throw new SpendError(401, {
        message: `Could not read Cursor's local session (${error.message || readonlyError.message}). Sign into the Cursor app on this machine, or set CURSOR_SESSION_TOKEN.`,
      });
    }
  }
}

export async function loadSessionCookie() {
  const jwt = unwrapToken(process.env.CURSOR_SESSION_TOKEN ?? "") || (await readTokenFromSqlite());
  if (!jwt) {
    throw new SpendError(401, {
      message: "No Cursor session found. Sign into the Cursor app, then retry. No API key needed.",
    });
  }
  const payload = decodeJwtPayload(jwt);
  const sub = payload.sub;
  if (!sub) {
    throw new SpendError(401, { message: "Cursor session JWT has no sub claim" });
  }
  return {
    cookie: `WorkosCursorSessionToken=${sub}%3A%3A${jwt}`,
    sub,
    email: payload.email ?? null,
  };
}
