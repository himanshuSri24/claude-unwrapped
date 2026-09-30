// Turns the raw counters from read.mjs into the numbers the story shows.
// Everything returned here is safe to put in the HTML: counts, dates, model
// names, and (unless private) project and file base names. Prompt text never
// leaves this file except for one short repeated phrase, the catchphrase.

import { IDLE_MS } from "./read.mjs";
import { costOf, prettyModel } from "./pricing.mjs";

const DAY = 24 * 3600 * 1000;

// Active stretches of one session: consecutive events closer than IDLE_MS.
export function stretches(events) {
  const ev = [...events].sort((a, b) => a - b);
  const out = [];
  let start = null, prev = null;
  for (const t of ev) {
    if (prev != null && t - prev > IDLE_MS) { out.push([start, prev]); start = null; }
    if (start == null) start = t;
    prev = t;
  }
  if (start != null) out.push([start, prev]);
  return out;
}

// Wall-clock time covered by any interval, so two sessions open at once
// do not count twice.
export function unionMs(intervals) {
  const iv = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0, cs = null, ce = null;
  for (const [a, b] of iv) {
    if (ce == null || a > ce) { if (ce != null) total += ce - cs; cs = a; ce = b; }
    else if (b > ce) ce = b;
  }
  if (ce != null) total += ce - cs;
  return total;
}

export function peakOverlap(intervals) {
  const pts = [];
  for (const [a, b] of intervals) if (b > a) { pts.push([a, 1]); pts.push([b, -1]); }
  pts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0, best = 0, at = null;
  for (const [t, d] of pts) { cur += d; if (cur > best) { best = cur; at = t; } }
  return { count: best, at };
}

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function longestStreak(dayKeys) {
  const days = [...new Set(dayKeys)].sort();
  let best = 0, run = 0, prev = null, end = null, bestEnd = null;
  for (const k of days) {
    const t = Date.parse(k + "T12:00:00");
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    if (run > best) { best = run; bestEnd = k; }
    prev = t; end = k;
  }
  return { days: best, end: bestEnd };
}

const median = (xs) => {
  if (!xs.length) return 0;
  const v = [...xs].sort((a, b) => a - b), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const words = (s) => s.split(/\s+/).filter(Boolean).length;

// A catchphrase is something short you typed again and again: "go on",
// "continue", "yes do it". It must look like chat, not like a path, a key
// or a name, because it goes on the share card.
export function catchphrase(prompts) {
  const counts = new Map();
  for (const p of prompts) {
    const k = p.text.trim().toLowerCase().replace(/[.!?]+$/, "");
    if (k.length < 2 || k.length > 28) continue;
    if (/[\\/@:#`{}<>\[\]=$]|\d{3,}|https?|\bkey\b|token|password/.test(k)) continue;
    if (!/^[a-z' ,]+$/.test(k)) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) if (n >= 3 && (!best || n > best.count)) best = { text: k, count: n };
  return best;
}

const PHRASES = {
  please: /\b(please|pls|plz)\b/i,
  thanks: /\b(thank(s| you)|thx|ty)\b/i,
  stillBroken: /\b(still (not|doesn'?t|isn'?t|broken|failing|wrong)|not working|doesn'?t work|didn'?t work)\b/i,
  swears: /\b(wtf|wth|fuck\w*|shit\w*|damn)\b/i,
  sorry: /\b(sorry|my bad)\b/i,
  why: /^\s*why\b/i,
};

function archetype(s) {
  // Each rule scores 0..1; the highest wins. Thresholds come from looking at
  // real logs, not from theory, so they are blunt on purpose.
  const r = s.rates;
  const cands = [
    { id: "conductor", name: "The Conductor", line: "You don't pair with Claude. You run an orchestra of them.",
      score: Math.min(1, (s.peak.count - 1) / 4) * 0.7 + Math.min(1, s.headless.runs / 300) * 0.5 },
    { id: "nightshift", name: "The Night Shift", line: "Your best ideas show up after everyone else logs off.",
      score: Math.min(1, r.night / 0.35) },
    { id: "novelist", name: "The Novelist", line: "You write specs, not prompts. Claude always knows exactly what you mean.",
      score: Math.min(1, s.you.medianPromptWords / 120) },
    { id: "director", name: "The Director", line: "Three words and Claude builds the rest. You say 'go on' like a film director says 'action'.",
      score: s.you.promptCount > 30 ? Math.min(1, (s.claude.wordsPerYourWord || 0) / 40) * 0.9 : 0 },
    { id: "backseat", name: "The Backseat Driver", line: "You hit Esc like it owes you money. Claude has learned to check in.",
      score: Math.min(1, r.steer / 0.08) },
    { id: "gentle", name: "The Gentle Parent", line: "Please, thank you, sorry. If the robots take over, you're safe.",
      score: Math.min(1, r.polite / 0.2) },
    { id: "builder", name: "The Builder", line: "Heads down, shipping. No drama, just diffs.", score: 0.35 },
  ];
  cands.sort((a, b) => b.score - a.score);
  return { id: cands[0].id, name: cands[0].name, line: cands[0].line };
}

export function buildStory(tot, { privateMode = false, now = Date.now() } = {}) {
  const all = [...tot.sessions.values()].filter((s) => s.events.length);
  const mine = all.filter((s) => !s.headless);
  const robots = all.filter((s) => s.headless);

  // Time
  const myStretches = mine.flatMap((s) => stretches(s.events));
  const allStretches = all.flatMap((s) => stretches(s.events));
  const wallMs = unionMs(myStretches);
  const sessionMs = myStretches.reduce((a, [x, y]) => a + (y - x), 0);
  const peak = peakOverlap(allStretches);

  const perDay = {};
  for (const [a, b] of myStretches) perDay[dayKey(a)] = (perDay[dayKey(a)] || 0) + (b - a);
  const busiestDay = Object.entries(perDay).sort((x, y) => y[1] - x[1])[0] || null;

  const prompts = tot.prompts;
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  const promptDays = {};
  for (const p of prompts) {
    const d = new Date(p.t);
    hours[d.getHours()]++;
    weekdays[d.getDay()]++;
    const k = dayKey(p.t);
    promptDays[k] = (promptDays[k] || 0) + 1;
  }
  const streak = longestStreak(Object.keys(promptDays));
  const peakHour = hours.indexOf(Math.max(...hours));

  // Latest night: the prompt closest to 5 AM from the dark side.
  let latest = null;
  for (const p of prompts) {
    const d = new Date(p.t);
    const h = d.getHours() + d.getMinutes() / 60;
    const lateness = h < 5 ? h + 24 : h;
    if (lateness >= 23 && (!latest || lateness > latest.lateness)) latest = { t: p.t, lateness };
  }

  // Tokens and money
  const models = [];
  let tokens = 0, cacheRead = 0, output = 0, cost = 0, unpriced = 0;
  for (const [model, u] of Object.entries(tot.usage)) {
    const n = u.input + u.output + u.cacheRead + u.cacheWrite + u.cacheWrite1h;
    const c = costOf(model, u);
    tokens += n; cacheRead += u.cacheRead; output += u.output;
    if (c == null) unpriced += n; else cost += c;
    models.push({ id: model, name: prettyModel(model), tokens: n, cost: c, messages: u.messages });
  }
  models.sort((a, b) => b.tokens - a.tokens);

  // You vs Claude
  const yourWords = prompts.reduce((a, p) => a + words(p.text), 0);
  const phraseCounts = {};
  for (const [k, re] of Object.entries(PHRASES)) phraseCounts[k] = prompts.filter((p) => re.test(p.text)).length;

  // Code
  const files = Object.entries(tot.fileEdits).sort((a, b) => b[1] - a[1]);
  const topFile = files[0] ? { name: baseName(files[0][0]), edits: files[0][1] } : null;
  const tools = Object.entries(tot.toolCounts).map(([name, n]) => ({ name: toolLabel(name), n }));
  const toolsMerged = {};
  for (const t of tools) toolsMerged[t.name] = (toolsMerged[t.name] || 0) + t.n;
  const toolList = Object.entries(toolsMerged).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  const commands = Object.entries(tot.bashHeads).filter(([k]) => !SHELL_NOISE.has(k)).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const toolTotal = toolList.reduce((a, t) => a + t.n, 0);

  // Projects, by where the edits landed
  let projects = Object.entries(tot.projectEdits).map(([name, edits]) => ({ name, edits }))
    .filter((p) => p.name !== "unknown").sort((a, b) => b.edits - a.edits);
  if (privateMode) projects = projects.map((p, i) => ({ ...p, name: `project ${String.fromCharCode(65 + (i % 26))}` }));

  const interactions = Math.max(1, prompts.length + tot.interrupts);
  const story = {
    version: 1,
    generatedAt: now,
    private: privateMode,
    range: { first: tot.first === Infinity ? null : tot.first, last: tot.last === -Infinity ? null : tot.last,
      days: tot.first === Infinity ? 0 : Math.max(1, Math.round((tot.last - tot.first) / DAY) + 1) },
    sessions: { yours: mine.length, activeDays: Object.keys(promptDays).length },
    time: {
      hours: wallMs / 3.6e6,
      sessionHours: sessionMs / 3.6e6,
      parallel: wallMs ? sessionMs / wallMs : 1,
      busiestDay: busiestDay ? { day: busiestDay[0], hours: busiestDay[1] / 3.6e6 } : null,
      streak,
      hoursOfDay: hours,
      weekdays,
      peakHour,
      latest: latest ? latest.t : null,
      calendar: Object.entries(perDay).map(([day, ms]) => [day, +(ms / 3.6e6).toFixed(2)]).sort(),
    },
    peak: { count: peak.count, at: peak.at },
    tokens: { total: tokens, cacheRead, output, cacheShare: tokens ? cacheRead / tokens : 0, unpriced },
    cost: { usd: cost },
    models,
    you: {
      promptCount: prompts.length,
      words: yourWords,
      avgPromptWords: prompts.length ? yourWords / prompts.length : 0,
      medianPromptWords: median(prompts.map((p) => words(p.text))),
      catchphrase: catchphrase(prompts),
      phrases: phraseCounts,
      interrupts: tot.interrupts,
      rejections: tot.rejections,
    },
    claude: {
      words: tot.claudeWords,
      wordsPerYourWord: yourWords ? tot.claudeWords / yourWords : null,
      thinking: tot.thinkingBlocks,
      toolCalls: toolTotal,
      tools: toolList.slice(0, 8),
      commands: commands.map(([name, n]) => ({ name, n })),
      linesWritten: tot.linesWritten,
      linesRemoved: tot.linesRemoved,
      filesTouched: files.length,
      topFile: privateMode ? (topFile && { name: "one file", edits: topFile.edits }) : topFile,
      subagents: tot.subagentsSpawned,
    },
    headless: { runs: robots.length, tokens: robots.reduce((a, s) => a + s.tokens, 0) },
    projects: projects.slice(0, 6),
    projectCount: projects.length,
  };
  story.rates = {
    night: prompts.length ? prompts.filter((p) => { const h = new Date(p.t).getHours(); return h >= 22 || h < 5; }).length / prompts.length : 0,
    polite: prompts.length ? (phraseCounts.please + phraseCounts.thanks + phraseCounts.sorry) / prompts.length : 0,
    steer: (tot.interrupts + tot.rejections) / interactions,
  };
  story.archetype = archetype(story);
  return story;
}

const SHELL_NOISE = new Set(["cd", "echo", "for", "if", "while", "export", "set", "true", "false", "sleep", "test", "[", "then", "do"]);

function baseName(p) {
  return String(p).split(/[\\/]/).filter(Boolean).pop() || p;
}

function toolLabel(name) {
  if (name.startsWith("mcp__")) {
    const server = name.split("__")[1] || "mcp";
    if (/chrome|browser/i.test(server)) return "Browser";
    return "MCP";
  }
  if (name === "PowerShell") return "Bash";
  if (name === "MultiEdit") return "Edit";
  if (name === "Task") return "Agent";
  return name;
}
