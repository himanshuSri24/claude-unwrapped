#!/usr/bin/env node
// claude-unwrapped - your Claude Code history, told as a story.
//
//   npx claude-unwrapped
//
// Reads the session logs Claude Code already keeps in ~/.claude. Everything
// runs on this machine. Nothing is uploaded, ever.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { readAll, defaultRoots } from "../lib/read.mjs";
import { buildStory } from "../lib/stats.mjs";
import { render } from "../lib/render.mjs";
import { summary } from "../lib/terminal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

const HELP = `
  claude-unwrapped ${pkg.version}
  Your Claude Code history, unwrapped.

  Usage
    npx claude-unwrapped [options]

  Reads the logs in ~/.claude/projects, writes one HTML file and opens it.
  Nothing leaves your machine.

  Options
    --days <n>       Only the last n days (default: everything on disk)
    --dir <path>     A Claude config folder to read (repeatable; default:
                     $CLAUDE_CONFIG_DIR and ~/.claude)
    --private        Hide project and file names and your catchphrase
    --out <file>     Where to write the story (default: a temp file)
    --json           Print the numbers as JSON instead
    --no-open        Do not open a browser
    -h, --help       Show this
    -v, --version    Show the version
`;

function parseArgs(argv) {
  const o = { days: null, dirs: [], privateMode: false, out: null, json: false, open: true };
  const val = (i, a, flag) => (a.includes("=") ? a.slice(flag.length + 1) : argv[i + 1]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { process.stdout.write(HELP); process.exit(0); }
    if (a === "-v" || a === "--version") { console.log(pkg.version); process.exit(0); }
    if (a === "--days" || a.startsWith("--days=")) { o.days = Number(val(i, a, "--days")); if (!a.includes("=")) i++; }
    else if (a === "--dir" || a.startsWith("--dir=")) { o.dirs.push(val(i, a, "--dir")); if (!a.includes("=")) i++; }
    else if (a === "--out" || a.startsWith("--out=")) { o.out = val(i, a, "--out"); if (!a.includes("=")) i++; }
    else if (a === "--private") o.privateMode = true;
    else if (a === "--json") o.json = true;
    else if (a === "--no-open") o.open = false;
    else { console.error(`Unknown option ${a}. Try --help.`); process.exit(2); }
  }
  if (o.days != null && !(o.days > 0)) { console.error("--days needs a positive number."); process.exit(2); }
  return o;
}

function openInBrowser(file) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", file]]
    : process.platform === "darwin" ? ["open", [file]] : ["xdg-open", [file]];
  try {
    const child = spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch { /* headless machine: the path is printed anyway */ }
}

const opts = parseArgs(process.argv.slice(2));
const roots = opts.dirs.length ? opts.dirs.map((d) => resolve(d)) : defaultRoots();
const found = roots.filter((r) => existsSync(join(r, "projects")));
if (!found.length) {
  console.error(opts.dirs.length
    ? `No projects/ folder in ${roots.join(", ")}. Point --dir at a Claude config folder (the one with projects/ inside).`
    : "Could not find ~/.claude/projects. Use Claude Code for a bit first, or pass --dir.");
  process.exit(1);
}

const since = opts.days ? Date.now() - opts.days * 86400000 : 0;
const tty = process.stderr.isTTY && !opts.json;
const tot = await readAll(found, {
  since,
  onProgress: tty ? (i, n) => { if (i === n || i % 25 === 0) process.stderr.write(`\r  reading ${i}/${n} session logs`); } : null,
});
if (tty) process.stderr.write("\r\x1b[K");

const story = buildStory(tot, { privateMode: opts.privateMode });

if (opts.json) {
  process.stdout.write(JSON.stringify(story, null, 2) + "\n");
  process.exit(0);
}

const out = resolve(opts.out || join(tmpdir(), "claude-unwrapped.html"));
writeFileSync(out, render(story));
process.stdout.write(summary(story, out));
if (opts.open) openInBrowser(out);
