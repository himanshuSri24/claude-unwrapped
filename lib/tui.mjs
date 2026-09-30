// A small interactive terminal, no dependencies: arrow-key choices, a
// progress line, and a gutter down the left so the whole run reads as one
// piece. Only used when stdin and stdout are both a real terminal.

import { emitKeypressEvents } from "node:readline";

const color = !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = c(1), dim = c(2), red = c("38;5;202"), butter = c("38;5;221"), green = c("38;5;114"), inv = c(7);

const out = process.stdout;
const w = (s) => out.write(s);
const BAR = dim("│");
let hidden = false, cleanedUp = false;
const hideCursor = () => { hidden = true; w("\x1b[?25l"); };
const showCursor = () => { if (hidden) { hidden = false; w("\x1b[?25h"); } };

function restore() {
  if (cleanedUp) return;
  cleanedUp = true;
  showCursor();
  if (process.stdin.isTTY) try { process.stdin.setRawMode(false); } catch { /* already closed */ }
}
process.on("exit", restore);

export function intro(version) {
  const title = ` ${bold("claude-unwrapped")} ${dim(version)} `;
  w(`\n  ${dim("┌")}${inv(red(title))}   ${dim("your Claude Code history, unwrapped")}\n  ${BAR}\n`);
}

export function line(s = "") { w(`  ${BAR}  ${s}\n`); }

export function outro(s) { w(`  ${dim("└")}  ${s}\n\n`); restore(); }

// One choice from a list. Returns the chosen option's value.
export function select(question, options, initial = 0) {
  return new Promise((resolve) => {
    let i = initial;
    const lines = options.length + 1;
    const draw = (first) => {
      if (!first) w(`\x1b[${lines}A\x1b[J`);
      w(`  ${butter("◆")}  ${bold(question)}\n`);
      options.forEach((o, k) => {
        const on = k === i;
        const hint = o.hint ? dim(`  ${o.hint}`) : "";
        w(`  ${BAR}  ${on ? red("●") : dim("○")} ${on ? o.label : dim(o.label)}${on ? hint : ""}\n`);
      });
    };
    hideCursor();
    draw(true);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onKey = (_, key = {}) => {
      if (key.ctrl && key.name === "c") { w(`\x1b[${lines}A\x1b[J  ${dim("◇")}  ${dim(question)}\n  ${dim("└")}  ${dim("cancelled")}\n\n`); restore(); process.exit(130); }
      if (key.name === "up" || key.name === "k") i = (i - 1 + options.length) % options.length;
      else if (key.name === "down" || key.name === "j" || key.name === "tab") i = (i + 1) % options.length;
      else if (key.name === "return" || key.name === "enter" || key.name === "space") {
        process.stdin.off("keypress", onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        w(`\x1b[${lines}A\x1b[J  ${green("◇")}  ${question} ${dim("·")} ${options[i].short || options[i].label}\n  ${BAR}\n`);
        showCursor();
        return resolve(options[i].value);
      } else return;
      draw(false);
    };
    process.stdin.on("keypress", onKey);
  });
}

// A task with a live line: spinner + label + optional bar.
export function task(label) {
  const frames = ["◐", "◓", "◑", "◒"];
  let f = 0, text = "", frac = null, t0 = Date.now(), done = false;
  const bar = (x) => {
    const width = 22, fill = Math.round(Math.max(0, Math.min(1, x)) * width);
    return red("█".repeat(fill)) + dim("░".repeat(width - fill));
  };
  const draw = () => {
    if (done) return;
    w(`\r\x1b[K  ${butter(frames[f++ % frames.length])}  ${label}${frac != null ? "  " + bar(frac) : ""}${text ? "  " + dim(text) : ""}`);
  };
  hideCursor();
  draw();
  const timer = setInterval(draw, 90);
  return {
    update(t, fraction = null) { text = t; frac = fraction; },
    done(msg) {
      done = true; clearInterval(timer);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      w(`\r\x1b[K  ${green("◇")}  ${msg || label} ${dim(`${secs}s`)}\n  ${BAR}\n`);
      showCursor();
    },
    fail(msg) {
      done = true; clearInterval(timer);
      w(`\r\x1b[K  ${red("■")}  ${msg}\n  ${BAR}\n`);
      showCursor();
    },
  };
}
