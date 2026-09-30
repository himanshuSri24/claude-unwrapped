// A made-up but believable story, for screenshots and for people who want
// to see what they will get before pointing it at their own logs.

export function demoStory(now = Date.now()) {
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const DAY = 86400000;
  const first = now - 61 * DAY;
  const calendar = [];
  for (let d = 0; d < 62; d++) {
    if (rnd() < 0.28) continue;
    const t = new Date(first + d * DAY);
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    calendar.push([key, +(0.4 + rnd() * rnd() * 7).toFixed(2)]);
  }
  const hours = calendar.reduce((a, [, h]) => a + h, 0);
  const busiest = calendar.reduce((m, c) => (c[1] > m[1] ? c : m));
  const hoursOfDay = [9, 4, 1, 0, 0, 0, 0, 2, 11, 24, 31, 29, 18, 22, 35, 38, 30, 21, 12, 15, 26, 33, 28, 17];
  const latest = new Date(now - 9 * DAY); latest.setHours(2, 41, 0, 0);
  const peakAt = new Date(now - 20 * DAY); peakAt.setHours(15, 12, 0, 0);

  return {
    version: 1,
    demo: true,
    generatedAt: now,
    private: false,
    range: { first, last: now, days: 62 },
    sessions: { yours: 214, activeDays: calendar.length },
    time: {
      hours, sessionHours: hours * 1.6, parallel: 1.6,
      busiestDay: { day: busiest[0], hours: busiest[1] },
      streak: { days: 11, end: calendar[calendar.length - 1][0] },
      hoursOfDay, weekdays: [40, 88, 97, 91, 84, 70, 31], peakHour: 15,
      latest: latest.getTime(), calendar,
    },
    peak: { count: 4, at: peakAt.getTime() },
    tokens: { total: 1.84e9, cacheRead: 1.79e9, output: 7.9e6, cacheShare: 0.973, unpriced: 0 },
    cost: { usd: 1312.4 },
    models: [
      { id: "claude-opus-5-5", name: "Opus 5.5", tokens: 1.3e9, cost: 811.2, messages: 6100 },
      { id: "claude-opus-5", name: "Opus 5", tokens: 4.1e8, cost: 402.9, messages: 2300 },
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5", tokens: 1.1e8, cost: 71.3, messages: 900 },
      { id: "claude-haiku-4-5", name: "Haiku 4.5", tokens: 2e7, cost: 27, messages: 400 },
    ],
    you: {
      promptCount: 1488, words: 41200, avgPromptWords: 27.7, medianPromptWords: 14,
      catchphrase: { text: "ok ship it", count: 57 },
      phrases: { please: 212, thanks: 96, stillBroken: 38, swears: 7, sorry: 4, why: 30 },
      interrupts: 61, rejections: 44,
    },
    claude: {
      words: 610000, wordsPerYourWord: 14.8, thinking: 5210, toolCalls: 11840,
      tools: [{ name: "Bash", n: 4210 }, { name: "Edit", n: 2980 }, { name: "Read", n: 2410 }, { name: "Write", n: 890 }, { name: "Grep", n: 760 }],
      commands: [{ name: "git", n: 910 }, { name: "npm", n: 640 }, { name: "rg", n: 380 }, { name: "node", n: 300 }],
      linesWritten: 88420, linesRemoved: 31200, filesTouched: 1204,
      topFile: { name: "App.tsx", edits: 143 }, subagents: 38,
    },
    headless: { runs: 132, tokens: 2.1e7 },
    projects: [
      { name: "side-project", edits: 1210 }, { name: "dotfiles", edits: 402 }, { name: "blog", edits: 388 },
      { name: "api", edits: 240 }, { name: "cli-tool", edits: 131 }, { name: "game-jam", edits: 64 },
    ],
    projectCount: 14,
    rates: { night: 0.14, polite: 0.21, steer: 0.07 },
    archetype: { id: "gentle", name: "The Gentle Parent", line: "Please, thank you, sorry. If the robots take over, you're safe." },
  };
}
