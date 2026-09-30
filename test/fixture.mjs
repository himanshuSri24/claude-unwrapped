// Builds a fake Claude config folder in a temp dir. The shapes are copied
// from real Claude Code 2.1 logs, trimmed to the fields we read.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const T0 = Date.parse("2026-09-01T09:00:00Z");
const at = (min) => new Date(T0 + min * 60000).toISOString();

const user = (sid, min, content, extra = {}) => ({
  type: "user", sessionId: sid, timestamp: at(min), cwd: "/work", entrypoint: "cli",
  message: { role: "user", content }, ...extra,
});

// One API message is logged as one line per content block, each repeating
// the same usage. That duplication is the thing most counters get wrong.
const assistant = (sid, min, id, blocks, usage, model = "claude-opus-5-5") =>
  blocks.map((b) => ({
    type: "assistant", sessionId: sid, timestamp: at(min), cwd: "/work", entrypoint: "cli",
    message: { id, model, role: "assistant", content: [b], usage },
  }));

const U = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200,
  cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 0 } };

export function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "cu-test-"));
  const proj = join(root, "projects", "-work");
  mkdirSync(join(proj, "s1", "subagents"), { recursive: true });

  const s1 = [
    { type: "custom-title", customTitle: "first", sessionId: "s1" },
    user("s1", 0, "<command-name>/model</command-name>\n<command-message>model</command-message>"),
    user("s1", 1, "build me a todo app please"),
    ...assistant("s1", 2, "m1", [
      { type: "thinking", thinking: "" },
      { type: "text", text: "On it. Writing the files now." },
      { type: "tool_use", id: "t1", name: "Write", input: { file_path: "/work/app/index.js", content: "a\nb\nc" } },
    ], U),
    user("s1", 3, [{ type: "tool_result", tool_use_id: "t1", content: "ok" }]),
    ...assistant("s1", 4, "m2", [
      { type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/work/app/index.js", old_string: "a", new_string: "x\ny" } },
      { type: "tool_use", id: "t3", name: "Bash", input: { command: "cd /work && npm test" } },
    ], U),
    user("s1", 5, [{ type: "tool_result", tool_use_id: "t3", content: "The user doesn't want to proceed with this tool use." }]),
    user("s1", 6, "[Request interrupted by user]"),
    user("s1", 7, "go on"),
    user("s1", 8, "go on"),
    user("s1", 9, "go on"),
    user("s1", 10, "it's still not working"),
    user("s1", 11, "some context", { isMeta: true }),
    // 3 hours later: a new stretch, not 3 hours of work
    user("s1", 190, "go on"),
    ...assistant("s1", 195, "m3", [{ type: "text", text: "Done." }], U, "claude-sonnet-5"),
  ];

  // A second session overlapping the first: wall-clock time must not double.
  const s2 = [
    user("s2", 2, "and fix the css in the other one"),
    ...assistant("s2", 6, "m4", [{ type: "text", text: "Fixed." }], U),
  ];

  // Headless run from a script
  const s3 = [
    user("s3", 30, "summarise this file", { entrypoint: "sdk-cli" }),
    ...assistant("s3", 31, "m5", [{ type: "text", text: "Summary." }], U).map((l) => ({ ...l, entrypoint: "sdk-cli" })),
  ];

  // A subagent's transcript: tokens count, prompts and time do not
  const sub = [
    { type: "user", isSidechain: true, sessionId: "s1", timestamp: at(4), message: { role: "user", content: "search the repo" } },
    ...assistant("s1", 4, "m6", [{ type: "tool_use", id: "t9", name: "Grep", input: { pattern: "x" } }], U).map((l) => ({ ...l, isSidechain: true })),
  ];

  const w = (file, lines) => writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\nnot json at all\n");
  w(join(proj, "s1.jsonl"), s1);
  w(join(proj, "s2.jsonl"), s2);
  w(join(proj, "s3.jsonl"), s3);
  w(join(proj, "s1", "subagents", "agent-a1.jsonl"), sub);
  return root;
}
