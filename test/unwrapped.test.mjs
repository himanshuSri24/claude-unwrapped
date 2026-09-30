import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixture } from "./fixture.mjs";
import { readAll, projectOf } from "../lib/read.mjs";
import { buildStory, stretches, unionMs, peakOverlap, catchphrase, longestStreak } from "../lib/stats.mjs";
import { costOf, prettyModel, priceFor } from "../lib/pricing.mjs";
import { render } from "../lib/render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = makeFixture();
const tot = await readAll([root]);
const story = buildStory(tot);
test.after(() => rmSync(root, { recursive: true, force: true }));

test("usage is counted once per message, not once per logged line", () => {
  const opus = tot.usage["claude-opus-5-5"];
  // m1, m2, m4, m5 and the subagent's m6 on Opus; m3 on Sonnet
  assert.equal(opus.messages, 5);
  assert.equal(opus.output, 500);
  assert.equal(tot.usage["claude-sonnet-5"].messages, 1);
});

test("prompts: typed ones only", () => {
  // build, go on x4, still not working, and the s2 prompt. Not the slash
  // command, the interrupt, the meta line, tool results or the headless run.
  assert.equal(story.you.promptCount, 7);
  assert.equal(tot.interrupts, 1);
  assert.equal(tot.rejections, 1);
  assert.deepEqual(tot.slash, { model: 1 });
  assert.equal(story.you.phrases.please, 1);
  assert.equal(story.you.phrases.stillBroken, 1);
});

test("headless runs are counted apart from your sessions", () => {
  assert.equal(story.sessions.yours, 2);
  assert.equal(story.headless.runs, 1);
});

test("tools, edits and lines", () => {
  assert.equal(tot.toolCounts.Write, 1);
  assert.equal(tot.toolCounts.Edit, 1);
  assert.equal(tot.toolCounts.Grep, 1, "subagent tool calls still count");
  assert.equal(tot.linesWritten, 5);
  assert.equal(tot.linesRemoved, 1);
  assert.equal(tot.bashHeads.npm, 1, "leading cd is skipped");
  assert.equal(story.claude.topFile.name, "index.js");
  assert.equal(story.claude.topFile.edits, 2);
});

test("time is wall clock: idle gaps end a stretch, overlaps count once", () => {
  // s1: 0..11 then 190..195; s2: 2..6 sits inside s1's first stretch
  assert.equal(story.time.hours * 60, 16);
  assert.equal(story.peak.count, 2);
});

test("catchphrase needs 3+ repeats and never looks like a path or a secret", () => {
  assert.deepEqual(story.you.catchphrase, { text: "go on", count: 4 });
  const p = (text, n) => Array.from({ length: n }, () => ({ text }));
  assert.equal(catchphrase(p("yes", 2)), null);
  assert.equal(catchphrase(p("/users/me/secret", 9)), null);
  assert.equal(catchphrase(p("sk-ant-12345", 9)), null);
  assert.equal(catchphrase(p("my token is abc", 9)), null);
  assert.deepEqual(catchphrase([...p("continue", 3), ...p("ok do it", 5)]), { text: "ok do it", count: 5 });
});

test("private mode drops names but keeps the (already filtered) catchphrase", () => {
  const s = buildStory(tot, { privateMode: true });
  assert.equal(s.you.catchphrase.text, "go on");
  assert.equal(s.claude.topFile.name, "one file");
  assert.ok(s.projects.every((p) => p.name.startsWith("project ")));
});

test("interval helpers", () => {
  const m = 60000;
  assert.deepEqual(stretches([0, m, 2 * m, 60 * m]), [[0, 2 * m], [60 * m, 60 * m]]);
  assert.equal(unionMs([[0, 10], [5, 20], [30, 40]]), 30);
  assert.equal(peakOverlap([[0, 10], [5, 20], [9, 12], [20, 30]]).count, 3);
  assert.equal(peakOverlap([[0, 10], [10, 20]]).count, 1, "touching is not overlapping");
  assert.equal(longestStreak(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-05"]).days, 3);
  assert.equal(longestStreak(["2026-10-31", "2026-11-01"]).days, 2, "across a month");
});

test("project of a file: nearest project root, else first folder under cwd", () => {
  const cwd = join(here, "..", "..");
  assert.equal(projectOf(cwd, join(here, "..", "lib", "read.mjs")), "claude-unwrapped");
  assert.equal(projectOf("/nowhere", "/nowhere/app/x.js"), "app");
  assert.equal(projectOf("/nowhere/app", "/nowhere/app/x.js"), "app");
  assert.equal(projectOf("/w", "C:\\Users\\me\\.claude\\memory\\a.md"), null);
});

test("pricing", () => {
  const u = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6, cacheWrite1h: 1e6 };
  assert.equal(costOf("claude-opus-5-5", u), 4 + 20 + 0.2 + 5 + 8);
  assert.equal(costOf("claude-opus-5", u), 5 + 25 + 0.5 + 6.25 + 10);
  assert.equal(priceFor("claude-fable-5-1").cacheRead, 0.25);
  assert.equal(priceFor("claude-fable-5").cacheRead, 1);
  assert.equal(priceFor("claude-sonnet-4-20250514").input, 3);
  assert.equal(costOf("gpt-5", u), null);
  assert.equal(prettyModel("claude-opus-5-5"), "Opus 5.5");
  assert.equal(prettyModel("claude-sonnet-4-20250514"), "Sonnet 4");
  assert.equal(prettyModel("claude-3-5-haiku-20241022"), "Haiku 3.5");
});

test("render inlines the story and cannot be broken out of", () => {
  const html = render({ ...story, projects: [{ name: "</script><script>alert(1)</script>", edits: 1 }] });
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes("\\u003c/script>"));
  assert.ok(!html.includes("/*__STORY__*/null"));
});

test("cli --json runs end to end", () => {
  const out = execFileSync(process.execPath, [join(here, "..", "bin", "claude-unwrapped.mjs"), "--dir", root, "--json"], { encoding: "utf8" });
  const s = JSON.parse(out);
  assert.equal(s.sessions.yours, 2);
  assert.ok(s.archetype.name);
});

test("--demo needs no logs", () => {
  const out = execFileSync(process.execPath, [join(here, "..", "bin", "claude-unwrapped.mjs"), "--demo", "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(out).demo, true);
});

test("an empty folder is an error, not a crash", () => {
  let err;
  try { execFileSync(process.execPath, [join(here, "..", "bin", "claude-unwrapped.mjs"), "--dir", here, "--json"], { stdio: "pipe" }); }
  catch (e) { err = e; }
  assert.equal(err.status, 1);
  assert.match(String(err.stderr), /No projects\/ folder/);
});

test("captions: numbers filled in, X always fits 280", async () => {
  const { posts, postFile, X_LIMIT } = await import("../lib/posts.mjs");
  const p = posts(story);
  assert.match(p.linkedin, /npx claude-unwrapped/);
  assert.match(p.linkedin, new RegExp(story.archetype.name));
  assert.match(p.x, /npx claude-unwrapped/);
  const huge = { ...story, archetype: { name: "The Backseat Driver", line: "x" },
    you: { ...story.you, catchphrase: { text: "a".repeat(28), count: 99999 } },
    peak: { count: 12 }, time: { ...story.time, hours: 99999 }, tokens: { ...story.tokens, total: 9.9e12 }, cost: { usd: 9.9e9 } };
  assert.ok(posts(huge).x.length <= X_LIMIT);
  assert.match(postFile(p), /LINKEDIN[\s\S]*X \/ TWITTER/);
});

test("the story page carries the captions for its share buttons", () => {
  const html = render(story);
  assert.match(html, /"posts":\{"linkedin":/);
  assert.match(html, /x\.com\/intent\/post/);
});
