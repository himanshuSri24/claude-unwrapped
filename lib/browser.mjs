// Drives the Chrome or Edge you already have, over the DevTools protocol on
// a pipe (--remote-debugging-pipe). No puppeteer, no downloads: fd 3 is what
// we write to the browser, fd 4 is what it writes back, and every message is
// JSON ending in a NUL byte.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";

function onPath(names) {
  const dirs = (process.env.PATH || "").split(delimiter);
  for (const n of names) for (const d of dirs) {
    const p = join(d, n);
    if (existsSync(p)) return p;
  }
  return null;
}

export function findBrowser() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = process.platform === "win32"
    ? pf.flatMap((b) => [
        join(b, "Google", "Chrome", "Application", "chrome.exe"),
        join(b, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(b, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        join(b, "Chromium", "Application", "chrome.exe"),
      ])
    : process.platform === "darwin"
      ? ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"].map((a) => `/Applications/${a}.app/Contents/MacOS/${a}`)
      : [];
  return candidates.find((p) => existsSync(p))
    || onPath(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]);
}

export function findFfmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  const found = onPath(process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"]);
  if (found) return found;
  // installed a moment ago by winget or brew: this shell's PATH is stale
  const extra = process.platform === "win32"
    ? [join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ffmpeg.exe")]
    : ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
  return extra.find((p) => existsSync(p)) || null;
}

// How to get ffmpeg here: a command we can run for you, or one to show.
export function ffmpegInstall() {
  if (process.platform === "win32" && onPath(["winget.exe"])) return { cmd: "winget", args: ["install", "--id", "Gyan.FFmpeg", "-e", "--accept-source-agreements", "--accept-package-agreements"], show: "winget install Gyan.FFmpeg", run: true };
  if (process.platform === "darwin" && (onPath(["brew"]) || existsSync("/opt/homebrew/bin/brew"))) return { cmd: onPath(["brew"]) || "/opt/homebrew/bin/brew", args: ["install", "ffmpeg"], show: "brew install ffmpeg", run: true };
  if (process.platform === "linux") return { show: onPath(["apt"]) ? "sudo apt install ffmpeg" : onPath(["dnf"]) ? "sudo dnf install ffmpeg" : onPath(["pacman"]) ? "sudo pacman -S ffmpeg" : "install ffmpeg with your package manager", run: false };
  return { show: "https://ffmpeg.org/download.html", run: false };
}

export async function launch(executable) {
  const profile = mkdtempSync(join(tmpdir(), "claude-unwrapped-browser-"));
  const proc = spawn(executable, [
    "--headless=new", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "--disable-gpu",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true });

  const out = proc.stdio[3], inp = proc.stdio[4];
  let id = 0, buf = "";
  const pending = new Map(), listeners = new Map();
  inp.setEncoding("utf8");
  inp.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const fn of listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
      }
    }
  });
  const exited = new Promise((r) => proc.once("exit", r));
  proc.once("error", (e) => { for (const p of pending.values()) p.reject(e); });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, { resolve, reject });
    out.write(JSON.stringify(msg) + "\0");
  });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };

  async function newPage(width, height, scale = 2) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
    const page = {
      sessionId,
      async front() {
        await s("Page.bringToFront");
        await s("Emulation.setFocusEmulationEnabled", { enabled: true });
      },
      async close() { await send("Target.closeTarget", { targetId }).catch(() => {}); },
      send: s,
      async goto(url) {
        const loaded = new Promise((r) => on("Page.loadEventFired", (_, sid) => sid === sessionId && r()));
        await s("Page.navigate", { url });
        await loaded;
        await page.eval("document.fonts.ready.then(() => true)");
      },
      async eval(expression) {
        const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      },
      async screenshot() {
        const { data } = await s("Page.captureScreenshot", { format: "png" });
        return Buffer.from(data, "base64");
      },
      async waitFor(expression, timeout = 120000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
          if (await page.eval(`!!(${expression})`)) return;
          await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`timed out waiting for ${expression}`);
      },
    };
    return page;
  }

  async function close() {
    try { await Promise.race([send("Browser.close"), new Promise((r) => setTimeout(r, 3000))]); } catch { /* already gone */ }
    if (proc.exitCode == null) proc.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Windows may hold a lock for a moment */ }
  }

  return { send, on, newPage, close };
}
