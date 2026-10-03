// Reads Claude Code's own session logs (~/.claude/projects/**/*.jsonl) and
// folds them into plain counters. No judgement happens here; stats.mjs turns
// the counters into the story.
//
// The log format is undocumented and changes between Claude Code versions, so
// every field is read defensively: a line we do not understand is skipped, not
// fatal.

import { createReadStream, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

// A gap longer than this between two events in a session means you walked away.
export const IDLE_MS = 15 * 60 * 1000;

export function defaultRoots() {
  const roots = [];
  const env = process.env.CLAUDE_CONFIG_DIR;
  if (env) for (const d of env.split(/[;,]/)) if (d.trim()) roots.push(d.trim());
  roots.push(join(homedir(), ".claude"));
  return [...new Set(roots)].filter((r) => existsSync(join(r, "projects")));
}

// Every .jsonl under <root>/projects. Files under a "subagents" folder are
// transcripts of agents Claude spawned, not sessions you had.
export function findLogs(roots) {
  const out = [];
  const walk = (dir, sub) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, sub || e.name === "subagents");
      else if (e.name.endsWith(".jsonl")) out.push({ path: p, subagent: sub });
    }
  };
  for (const r of roots) walk(join(r, "projects"), false);
  return out;
}

const NOT_A_PROMPT = /^\s*(<command-name>|<command-message>|<local-command|<task-notification>|<system-reminder>|<bash-input>|<bash-stdout>|<user-memory-input>|Caveat:)/;
const INTERRUPTED = /^\[Request interrupted by user/;
const REJECTED = /(doesn't want to proceed with this tool use|user rejected|tool use was rejected)/i;

function promptText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.some((c) => c && c.type === "tool_result")) return null;
  const t = content.filter((c) => c && c.type === "text").map((c) => c.text).join("\n");
  return t || null;
}

function toolResultText(content) {
  if (!Array.isArray(content)) return "";
  let s = "";
  for (const c of content) {
    if (!c || c.type !== "tool_result") continue;
    if (typeof c.content === "string") s += c.content;
    else if (Array.isArray(c.content)) for (const x of c.content) if (x && x.type === "text") s += x.text;
  }
  return s;
}

function lineCount(s) {
  return typeof s === "string" && s.length ? s.split("\n").length : 0;
}

export function emptyTotals() {
  return {
    files: 0,
    sessions: new Map(),      // sessionId -> { project, cwd, first, last, events: [], prompts, title }
    lines: new Set(),         // line uuids already read (forks copy history into a new file)
    messages: new Set(),      // assistant message ids already counted (one message spans many lines)
    tools: new Set(),         // tool_use ids already counted
    usage: {},                // model -> { input, output, cacheRead, cacheWrite, cacheWrite1h, messages }
    toolCounts: {},
    fileEdits: {},            // path -> edits
    projectEdits: {},         // project folder -> edits, see projectOf
    linesWritten: 0,
    linesRemoved: 0,
    bashHeads: {},
    slash: {},
    subagentsSpawned: 0,
    webSearches: 0,
    prompts: [],              // { t, text, session } — kept in memory only, never written out raw
    interrupts: 0,
    rejections: 0,
    claudeWords: 0,
    thinkingBlocks: 0,
    first: Infinity,
    last: -Infinity,
  };
}

function session(tot, id, o) {
  let s = tot.sessions.get(id);
  if (!s) {
    s = { id, cwd: null, events: [], prompts: 0, title: null, tokens: 0, headless: false, entry: null };
    tot.sessions.set(id, s);
  }
  if (!s.cwd && o && typeof o.cwd === "string") s.cwd = o.cwd;
  // `claude -p` and the Agent SDK log as sdk-*; that is a script, not you.
  if (!s.entry && o && typeof o.entrypoint === "string") {
    s.entry = o.entrypoint;
    s.headless = o.entrypoint.startsWith("sdk");
  }
  return s;
}

function addUsage(tot, model, u) {
  const m = (tot.usage[model] ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, messages: 0 });
  m.input += u.input_tokens || 0;
  m.output += u.output_tokens || 0;
  m.cacheRead += u.cache_read_input_tokens || 0;
  const cw = u.cache_creation_input_tokens || 0;
  const cw1h = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
  m.cacheWrite += cw - Math.min(cw1h, cw);
  m.cacheWrite1h += Math.min(cw1h, cw);
  m.messages += 1;
  return (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + cw;
}

// One parsed line. Exported so tests can feed records without touching disk.
export function ingest(tot, o, { subagent = false, since = 0 } = {}) {
  if (!o || typeof o !== "object") return;
  const t = o.timestamp ? Date.parse(o.timestamp) : NaN;
  if (Number.isFinite(t) && t < since) return;
  // A forked or carried-over session starts its file with a copy of the old
  // conversation: same uuids and timestamps, new sessionId. Read each line once
  // or every prompt in it counts twice and the copy looks like a second Claude.
  if (typeof o.uuid === "string") {
    if (tot.lines.has(o.uuid)) return;
    tot.lines.add(o.uuid);
  }
  const sid = o.sessionId;

  if (o.type === "custom-title" && sid && !subagent) {
    session(tot, sid).title = o.customTitle || null;
    return;
  }
  if (o.type !== "user" && o.type !== "assistant") return;
  if (!Number.isFinite(t) || !sid) return;

  if (t < tot.first) tot.first = t;
  if (t > tot.last) tot.last = t;
  const s = subagent ? null : session(tot, sid, o);
  if (s) s.events.push(t);

  const msg = o.message || {};

  if (o.type === "assistant") {
    const id = msg.id || o.uuid;
    if (msg.usage && id && !tot.messages.has(id)) {
      tot.messages.add(id);
      const model = msg.model || "unknown";
      if (model !== "<synthetic>") {
        const n = addUsage(tot, model, msg.usage);
        if (s) s.tokens += n;
        const st = msg.usage.server_tool_use;
        if (st) tot.webSearches += st.web_search_requests || 0;
      }
    }
    if (!Array.isArray(msg.content)) return;
    for (const c of msg.content) {
      if (!c) continue;
      if (c.type === "text" && !subagent) tot.claudeWords += (c.text || "").split(/\s+/).filter(Boolean).length;
      else if (c.type === "thinking") tot.thinkingBlocks += 1;
      else if (c.type === "tool_use") {
        const key = c.id || `${id}:${c.name}`;
        if (tot.tools.has(key)) continue;
        tot.tools.add(key);
        const name = c.name || "unknown";
        tot.toolCounts[name] = (tot.toolCounts[name] || 0) + 1;
        const inp = c.input || {};
        if (name === "Task" || name === "Agent") tot.subagentsSpawned += 1;
        if ((name === "Write" || name === "Edit" || name === "MultiEdit") && inp.file_path) {
          const proj = projectOf(o.cwd, inp.file_path);
          if (proj) tot.projectEdits[proj] = (tot.projectEdits[proj] || 0) + 1;
        }
        if (name === "Write" && inp.file_path) {
          tot.fileEdits[inp.file_path] = (tot.fileEdits[inp.file_path] || 0) + 1;
          tot.linesWritten += lineCount(inp.content);
        } else if ((name === "Edit" || name === "MultiEdit") && inp.file_path) {
          tot.fileEdits[inp.file_path] = (tot.fileEdits[inp.file_path] || 0) + 1;
          const edits = Array.isArray(inp.edits) ? inp.edits : [inp];
          for (const e of edits) {
            tot.linesWritten += lineCount(e.new_string);
            tot.linesRemoved += lineCount(e.old_string);
          }
        } else if ((name === "Bash" || name === "PowerShell") && typeof inp.command === "string") {
          const head = inp.command.trim().replace(/^(cd\s+("[^"]*"|\S+)\s*(&&|;)\s*)+/, "").split(/\s+/)[0];
          if (head && /^[\w.\-]+$/.test(head)) tot.bashHeads[head] = (tot.bashHeads[head] || 0) + 1;
        }
      }
    }
    return;
  }

  // type === "user"
  if (subagent || o.isSidechain) return;
  const content = msg.content;
  if (Array.isArray(content) && REJECTED.test(toolResultText(content))) tot.rejections += 1;
  const text = promptText(content);
  if (text == null) return;
  const cmd = /<command-name>\/?([\w:-]+)<\/command-name>/.exec(text);
  if (cmd) { tot.slash[cmd[1]] = (tot.slash[cmd[1]] || 0) + 1; return; }
  if (INTERRUPTED.test(text)) { tot.interrupts += 1; return; }
  if (o.isMeta || NOT_A_PROMPT.test(text)) return;
  s.prompts += 1;
  if (s.headless) return;
  tot.prompts.push({ t, text, session: sid });
}

export async function readFile(tot, file, opts = {}) {
  const rl = createInterface({ input: createReadStream(file.path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line[0] !== "{") continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    ingest(tot, o, { ...opts, subagent: file.subagent });
  }
  tot.files += 1;
}

export async function readAll(roots, { since = 0, onProgress } = {}) {
  const tot = emptyTotals();
  const logs = findLogs(roots).filter((f) => {
    try { return statSync(f.path).mtimeMs >= since; } catch { return false; }
  });
  let i = 0;
  for (const f of logs) {
    await readFile(tot, f, { since });
    if (onProgress) onProgress(++i, logs.length);
  }
  return tot;
}

// Which project an edited file belongs to. Plenty of people start Claude in
// the folder that holds all their projects, so the session's cwd alone says
// nothing. Walk up from the file to the nearest folder that looks like a
// project root; failing that, the first folder below the cwd.
const MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "requirements.txt", "deno.json"];
const rootCache = new Map();

function isProjectRoot(dir) {
  if (rootCache.has(dir)) return rootCache.get(dir);
  let yes = false;
  try { yes = MARKERS.some((m) => existsSync(join(dir, m))); } catch { /* unreadable: not a root */ }
  rootCache.set(dir, yes);
  return yes;
}

// Claude's own scratch space and memory are not your projects.
const INTERNAL = /\/(\.claude|appdata\/local\/temp|tmp|temp)\//i;

export function projectOf(cwd, file) {
  const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const c = norm(cwd), f = norm(file);
  if (!f || INTERNAL.test(f + "/")) return null;
  const segs = f.split("/");
  for (let i = segs.length - 1; i > 0; i--) {
    const dir = segs.slice(0, i).join("/");
    if (c && dir.length < c.length) break;
    if (isProjectRoot(dir || "/")) return segs[i - 1];
  }
  if (c && f.toLowerCase().startsWith(c.toLowerCase() + "/")) {
    const rel = f.slice(c.length + 1).split("/");
    return rel.length > 1 ? rel[0] : projectName(c);
  }
  return segs.length > 1 ? segs[segs.length - 2] : null;
}

export function projectName(cwd) {
  if (!cwd) return "unknown";
  return basename(cwd.replace(/[\\/]+$/, "")) || cwd;
}
