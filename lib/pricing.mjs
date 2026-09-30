// Anthropic first-party API list prices, USD per million tokens.
// Checked 2026-09-30. This is "what it would have cost on the API",
// not what you paid: most people run Claude Code on a flat subscription.
//
// Cache writes are 1.25x input (5 minute TTL) or 2x input (1 hour TTL).
// Cache reads are 0.1x input unless a model says otherwise.

const TABLE = [
  // prefix,             input, output, cacheRead (null = 0.1x input)
  ["claude-fable-5-1",   10,    50,     0.25],
  ["claude-mythos-5-1",  10,    50,     0.25],
  ["claude-fable-5",     10,    50,     1],
  ["claude-mythos-5",    10,    50,     1],
  ["claude-opus-5-5",    4,     20,     0.2],
  ["claude-opus-5",      5,     25,     null],
  ["claude-opus-4-8",    5,     25,     null],
  ["claude-opus-4-7",    5,     25,     null],
  ["claude-opus-4-6",    5,     25,     null],
  ["claude-opus-4-5",    5,     25,     null],
  ["claude-opus-4",      15,    75,     null],
  ["claude-sonnet-5",    2,     10,     0.2],
  ["claude-sonnet-4-6",  3,     15,     null],
  ["claude-sonnet-4",    3,     15,     null],
  ["claude-3-7-sonnet",  3,     15,     null],
  ["claude-haiku-4",     1,     5,      null],
  ["claude-3-5-haiku",   0.8,   4,      null],
];

export function priceFor(model) {
  const row = TABLE.find(([p]) => model === p || model.startsWith(p + "-") || model.startsWith(p + "["));
  if (!row) return null;
  const [, input, output, read] = row;
  return { input, output, cacheRead: read ?? input * 0.1, cacheWrite: input * 1.25, cacheWrite1h: input * 2 };
}

// usage: { input, output, cacheRead, cacheWrite, cacheWrite1h } in tokens.
export function costOf(model, u) {
  const p = priceFor(model);
  if (!p) return null;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead
    + u.cacheWrite * p.cacheWrite + u.cacheWrite1h * p.cacheWrite1h) / 1e6;
}

export function prettyModel(model) {
  const m = /^claude-(?:(\d+)-(\d+)-)?([a-z]+)(?:-(\d+))?(?:-(\d+))?/.exec(model);
  if (!m) return model;
  if (m[1]) return `${cap(m[3])} ${m[1]}.${m[2]}`;              // claude-3-5-haiku
  const ver = m[5] && m[5].length < 3 ? `${m[4]}.${m[5]}` : m[4]; // claude-opus-5-5 vs claude-opus-4-20250514
  return ver ? `${cap(m[3])} ${ver}` : cap(m[3]);
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);
