#!/usr/bin/env node
// claude-unwrapped - your Claude Code history, told as a story.
//
//   npx claude-unwrapped
//
// Reads the session logs Claude Code already keeps in ~/.claude. Everything
// runs on this machine. Nothing is uploaded, ever.

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { readAll, defaultRoots } from "../lib/read.mjs";
import { buildStory } from "../lib/stats.mjs";
import { render } from "../lib/render.mjs";
import { demoStory } from "../lib/demo.mjs";
import { exportFolder } from "../lib/export.mjs";
import { findBrowser, findFfmpeg, ffmpegInstall } from "../lib/browser.mjs";
import { summary, credit } from "../lib/terminal.mjs";
import * as tui from "../lib/tui.mjs";
import { posts } from "../lib/posts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

const HELP = `
  claude-unwrapped ${pkg.version}
  Your Claude Code history, unwrapped.

  Usage
    npx claude-unwrapped              asks what you want, step by step
    npx claude-unwrapped [options]    no questions

  Reads the logs in ~/.claude/projects, writes one HTML file and opens it.
  Nothing leaves your machine.

  Options
    --days <n>       Only the last n days (default: everything on disk)
    --dir <path>     A Claude config folder to read (repeatable; default:
                     $CLAUDE_CONFIG_DIR and ~/.claude)
    --private        Hide project and file names
    --export [dir]   Also make a folder to post from: the card, every slide
                     as a story image, and a video with music. Needs Chrome
                     or Edge; the video also needs ffmpeg.
                     (default: ./claude-unwrapped-<date>)
    --no-video       With --export, skip the video
    --demo           A made-up story, no logs needed
    --out <file>     Where to write the story (default: a temp file)
    --json           Print the numbers as JSON instead
    --no-open        Do not open a browser
    -h, --help       Show this
    -v, --version    Show the version
`;

function parseArgs(argv) {
  const o = { days: null, dirs: [], privateMode: false, demo: false, out: null, json: false, open: true, exportDir: null, video: true };
  const val = (i, a, flag) => (a.includes("=") ? a.slice(flag.length + 1) : argv[i + 1]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { process.stdout.write(HELP); process.exit(0); }
    if (a === "-v" || a === "--version") { console.log(pkg.version); process.exit(0); }
    if (a === "--days" || a.startsWith("--days=")) { o.days = Number(val(i, a, "--days")); if (!a.includes("=")) i++; }
    else if (a === "--dir" || a.startsWith("--dir=")) { o.dirs.push(val(i, a, "--dir")); if (!a.includes("=")) i++; }
    else if (a === "--out" || a.startsWith("--out=")) { o.out = val(i, a, "--out"); if (!a.includes("=")) i++; }
    else if (a === "--export" || a.startsWith("--export=")) {
      const v = a.includes("=") ? a.slice(9) : argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : "";
      o.exportDir = v || defaultExportDir();
    }
    else if (a === "--no-video") o.video = false;
    else if (a === "--private") o.privateMode = true;
    else if (a === "--demo") o.demo = true;
    else if (a === "--json") o.json = true;
    else if (a === "--no-open") o.open = false;
    else { console.error(`Unknown option ${a}. Try --help.`); process.exit(2); }
  }
  if (o.days != null && !(o.days > 0)) { console.error("--days needs a positive number."); process.exit(2); }
  return o;
}

function defaultExportDir() {
  return `claude-unwrapped-${new Date().toISOString().slice(0, 10)}`;
}

function openInBrowser(file) {
  if (process.env.UNWRAPPED_NO_OPEN) return;
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", file]]
    : process.platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
  try {
    const child = spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch { /* headless machine: the path is printed anyway */ }
}

// Best effort: the caption is in post.txt either way.
function copyText(text) {
  if (process.env.UNWRAPPED_NO_OPEN) return false;
  try {
    if (process.platform === "win32") {
      // clip.exe mangles non-ASCII (→, ×), so hand PowerShell a UTF-8 file
      const f = join(tmpdir(), `claude-unwrapped-caption-${process.pid}.txt`);
      writeFileSync(f, text);
      const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Get-Content -Raw -Encoding UTF8 -LiteralPath '${f}' | Set-Clipboard`], { stdio: "ignore", windowsHide: true });
      try { rmSync(f); } catch { /* temp file, fine */ }
      return r.status === 0;
    }
    const tools = process.platform === "darwin" ? [["pbcopy", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
    for (const [cmd, args] of tools) {
      const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
      if (r.status === 0) return true;
    }
  } catch { /* no clipboard here */ }
  return false;
}

function summaryLines(story) {
  return summary(story, "").replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").filter((l) => !/^\s*story:/.test(l));
}

function findRoots() {
  const roots = opts.dirs.length ? opts.dirs.map((d) => resolve(d)) : defaultRoots();
  const found = roots.filter((r) => existsSync(join(r, "projects")));
  if (!found.length) {
    console.error(opts.dirs.length
      ? `No projects/ folder in ${roots.join(", ")}. Point --dir at a Claude config folder (the one with projects/ inside).`
      : "Could not find ~/.claude/projects. Use Claude Code for a bit first, or pass --dir. (Or try --demo.)");
    process.exit(1);
  }
  return found;
}

// ---------------------------------------------------------------- flags

async function plain() {
  let story;
  if (opts.demo) story = demoStory();
  else {
    const since = opts.days ? Date.now() - opts.days * 86400000 : 0;
    const tty = process.stderr.isTTY && !opts.json;
    const tot = await readAll(findRoots(), {
      since,
      onProgress: tty ? (i, n) => { if (i === n || i % 25 === 0) process.stderr.write(`\r  reading ${i}/${n} session logs`); } : null,
    });
    if (tty) process.stderr.write("\r\x1b[K");
    story = buildStory(tot, { privateMode: opts.privateMode });
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(story, null, 2) + "\n");
    return;
  }
  const out = resolve(opts.out || join(tmpdir(), "claude-unwrapped.html"));
  writeFileSync(out, render(story));
  process.stdout.write(summary(story, out));
  if (opts.exportDir) await plainExport(resolve(opts.exportDir), story);
  process.stdout.write(credit() + "\n");
  if (opts.open) openInBrowser(out);
}

async function plainExport(dir, story) {
  const browser = findBrowser();
  if (!browser) {
    console.error("  --export needs Chrome, Edge, Brave or Chromium installed (or CHROME_PATH set). Skipped.\n");
    return;
  }
  const ffmpeg = opts.video ? findFfmpeg() : null;
  const tty = process.stderr.isTTY;
  const log = (p) => {
    if (!tty) return;
    const msg = p.phase === "slides" ? `slides ${p.i}/${p.n}` : p.phase === "video" ? `recording video ${Math.round(p.t)}s` : "encoding";
    process.stderr.write(`\r\x1b[K  ${msg}`);
  };
  const t0 = Date.now();
  try {
    const made = await exportFolder(story, dir, { browser, ffmpeg, summaryLines: summaryLines(story), log });
    if (tty) process.stderr.write("\r\x1b[K");
    const parts = ["card.png", `${made.slides} slides`];
    if (made.video) parts.push("unwrapped.mp4");
    process.stdout.write(`  export: ${dir}\n          ${parts.join(" · ")}  (${Math.round((Date.now() - t0) / 1000)}s${story.private ? ", names hidden" : ""})\n`);
    if (opts.video && !ffmpeg) process.stdout.write(`          no ffmpeg found, so no video. ${ffmpegInstall().show}, then run again.\n`);
    process.stdout.write("\n");
  } catch (e) {
    if (tty) process.stderr.write("\r\x1b[K");
    console.error(`  export failed: ${e.message}\n`);
  }
}

// ---------------------------------------------------------- interactive

async function interactive() {
  tui.intro(pkg.version);

  let tot = null, story;
  if (opts.demo) story = demoStory();
  else {
    const read = tui.task("Reading your Claude Code logs");
    tot = await readAll(findRoots(), { onProgress: (i, n) => read.update(`${i}/${n}`, i / n) });
    read.done(`Read ${tot.files} session logs`);
    story = buildStory(tot);
  }
  if (!story.sessions.yours && !story.headless.runs) {
    tui.outro("No Claude Code sessions found yet. Use it for a while and come back.");
    return;
  }

  const body = summaryLines(story).slice(1);
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body.at(-1).trim()) body.pop();
  for (const l of body) tui.line(l.replace(/^ {2}/, ""));
  tui.line();

  // Everyone gets the folder: the point is to make posting it effortless.
  const want = "folder";

  const hide = tot ? await tui.select("Project and file names?", [
    { value: false, label: "Show them", hint: "it's just me looking", short: "shown" },
    { value: true, label: "Hide them", hint: "I'll be posting this", short: "hidden" },
  ], 0) : false;
  if (tot && hide) story = buildStory(tot, { privateMode: true });

  const out = resolve(opts.out || join(tmpdir(), "claude-unwrapped.html"));
  writeFileSync(out, render(story));

  if (want === "folder") {
    const browser = findBrowser();
    if (!browser) {
      tui.line(tui.dim("The folder needs Chrome, Edge, Brave or Chromium to draw the images, and I couldn't find one."));
      tui.line(tui.dim("Install one (or set CHROME_PATH) and run this again. Opening your story instead."));
      tui.line();
    } else {
      let ffmpeg = findFfmpeg();
      let video = true;
      if (ffmpeg) {
        video = await tui.select("A video too?", [
          { value: true, label: "Yes, with music", hint: "4:5, about a minute to make", short: "yes" },
          { value: false, label: "No, just the images", short: "images only" },
        ], 0);
      } else {
        const how = ffmpegInstall();
        const choice = await tui.select("The video needs ffmpeg, which isn't installed", [
          ...(how.run ? [{ value: "install", label: "Install it for me", hint: how.show, short: "installing" }] : []),
          { value: "skip", label: "Skip the video", hint: "card and slides only", short: "no video" },
          { value: "show", label: "I'll install it myself", hint: how.show, short: how.show },
        ], 0);
        if (choice === "install") {
          tui.line(tui.dim(`$ ${how.show}`));
          const r = spawnSync(how.cmd, how.args, { stdio: "inherit", shell: false });
          ffmpeg = findFfmpeg();
          tui.line();
          if (!ffmpeg) {
            tui.line(r.status === 0 ? "Installed, but this terminal can't see it yet. Open a new one and run again for the video." : "That didn't work. Skipping the video for now.");
            tui.line();
          }
        } else if (choice === "show") {
          tui.line(`Run ${tui.butter(how.show)}, then ${tui.butter("npx claude-unwrapped")} again for the video.`);
          tui.line();
        }
        video = !!ffmpeg;
      }

      const dir = resolve(opts.exportDir || defaultExportDir());
      const slides = tui.task("Drawing your slides");
      let rec = null, enc = null;
      const log = (p) => {
        if (p.phase === "slides") slides.update(`${p.i}/${p.n}`, p.i / p.n);
        else if (p.phase === "video") {
          if (!rec) { slides.done("Drew the card and slides"); rec = tui.task("Recording the video"); }
          rec.update(`${Math.round(p.t)}s`, Math.min(0.99, p.t / 45));
        } else if (p.phase === "encode") { rec.done("Recorded the video"); enc = tui.task("Adding the music"); }
      };
      try {
        const made = await exportFolder(story, dir, { browser, ffmpeg: video ? ffmpeg : null, summaryLines: summaryLines(story), log });
        if (enc) enc.done("Added the music");
        else slides.done("Drew the card and slides");
        tui.line(`${tui.bold(dir)}`);
        tui.line(tui.dim(`card.png · slides/01-${String(made.slides).padStart(2, "0")}.png${made.video ? " · unwrapped.mp4" : ""} · post.txt · story.html`));
        tui.line();
        if (copyText(posts(story).linkedin)) tui.line(`${tui.green("✓")} Your LinkedIn caption is on the clipboard. ${tui.dim("The X one is in post.txt.")}`);
        else tui.line(`Captions for LinkedIn and X are in ${tui.bold("post.txt")}.`);
        tui.line(tui.dim(`Paste it, attach ${made.video ? "unwrapped.mp4 or " : ""}card.png, post.`));
        tui.line();
        openInBrowser(dir);
      } catch (e) {
        (enc || rec || slides).fail(`Couldn't make the folder: ${e.message}`);
      }
    }
  }

  openInBrowser(out);
  tui.outro(`${tui.red(story.archetype.name)}.  ${tui.dim("Your story is open in the browser.")}\n     ${credit()}`);
}

// --------------------------------------------------------------- run

const opts = parseArgs(process.argv.slice(2));
const noFlags = process.argv.length <= 2 || (process.argv.length === 3 && opts.demo);
if (noFlags && process.stdin.isTTY && process.stdout.isTTY) await interactive();
else await plain();
process.exit(0);
