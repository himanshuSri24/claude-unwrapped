// The few lines printed after a run, so the terminal alone is worth a look.

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c(1, s);
const dim = (s) => c(2, s);
const red = (s) => c("38;5;202", s);

const nf = new Intl.NumberFormat("en-US");
function short(n) {
  for (const [v, w] of [[1e9, "B"], [1e6, "M"], [1e3, "k"]]) if (n >= v) return (n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, "") + w;
  return nf.format(Math.round(n));
}

export function summary(s, file) {
  if (!s.sessions.yours && !s.headless.runs) return `\n  No Claude Code sessions found yet.\n\n`;
  const hrs = s.time.hours >= 10 ? Math.round(s.time.hours) : s.time.hours.toFixed(1);
  const lines = [
    "",
    `  ${bold("claude-unwrapped")}  ${dim(`${s.range.days} days, ${s.sessions.yours} sessions`)}`,
    "",
    `  ${bold(String(hrs))} hours with Claude   ${bold(short(s.tokens.total))} tokens   ${bold("$" + nf.format(Math.round(s.cost.usd)))} at API prices`,
  ];
  if (s.peak.count >= 2) lines.push(`  ${bold(String(s.peak.count))} Claudes at once, at peak${s.headless.runs ? dim(`   (+${nf.format(s.headless.runs)} headless runs)`) : ""}`);
  if (s.you.catchphrase) lines.push(`  catchphrase: ${bold(`"${s.you.catchphrase.text}"`)} ${dim(`x${s.you.catchphrase.count}`)}`);
  lines.push("", `  You are ${red(bold(s.archetype.name))}.`, "", `  ${dim("story:")} ${file}`, "");
  return lines.join("\n") + "\n";
}
