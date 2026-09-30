// Ready-to-post captions, filled in with your numbers. The same text goes in
// post.txt, on your clipboard, and behind the share buttons in the story, so
// posting is paste and attach.

const nf = new Intl.NumberFormat("en-US");
const int = (n) => nf.format(Math.round(n));
function tokens(n) {
  for (const [v, w] of [[1e9, "B"], [1e6, "M"], [1e3, "k"]]) if (n >= v) return (n / v).toFixed(n / v >= 100 ? 0 : 1).replace(/\.0$/, "") + w;
  return int(n);
}
const hours = (h) => (h >= 10 ? int(h) : h.toFixed(1));
const usd = (n) => "$" + int(n);

export const X_LIMIT = 280;

export function posts(s) {
  const peak = s.peak.count >= 2;
  const cp = s.you.catchphrase;

  const li = [
    "I ran my Claude Code logs through claude-unwrapped. The receipts:",
    "",
    `→ ${hours(s.time.hours)} hours with Claude over the last ${s.range.days} days`,
    peak && `→ ${s.peak.count} Claudes running at the same time, at my peak`,
    `→ ${tokens(s.tokens.total)} tokens${s.tokens.cacheShare > 0.5 ? `, ${Math.round(s.tokens.cacheShare * 100)}% of them Claude re-reading context it already had` : ""}`,
    s.cost.usd >= 1 && `→ ${usd(s.cost.usd)} at API prices`,
    s.claude.linesWritten > 0 && `→ Claude wrote ${int(s.claude.linesWritten)} lines across ${int(s.claude.filesTouched)} files`,
    cp && `→ My catchphrase: "${cp.text}" (${cp.count}×)`,
    "",
    `Apparently I'm ${s.archetype.name}: "${s.archetype.line}"`,
    "",
    "It reads the logs already on your machine and uploads nothing. Try it on yours:",
    "npx claude-unwrapped",
    "",
    "What did you get?",
  ].filter((l) => l !== false && l !== null && l !== undefined).join("\n");

  // X: keep dropping the least important line until it fits
  const head = "My Claude Code, unwrapped:";
  const stats = `${hours(s.time.hours)} hours · ${tokens(s.tokens.total)} tokens · ${usd(s.cost.usd)} at API prices`;
  const optional = [
    peak ? `${s.peak.count} Claudes running at once` : null,
    cp ? `catchphrase: "${cp.text}" ×${cp.count}` : null,
  ].filter(Boolean);
  const build = (extra) => [head, "", stats, ...extra, "", `I'm ${s.archetype.name}.`, "", "npx claude-unwrapped"].join("\n");
  let extra = [...optional], x = build(extra);
  while (x.length > X_LIMIT && extra.length) { extra.pop(); x = build(extra); }

  return { linkedin: li, x };
}

export function postFile(p) {
  return [
    "LINKEDIN",
    "--------",
    p.linkedin,
    "",
    "",
    "X / TWITTER",
    "-----------",
    p.x,
    "",
    "",
    "Attach card.png (or unwrapped.mp4) from this folder.",
    "",
  ].join("\n");
}
