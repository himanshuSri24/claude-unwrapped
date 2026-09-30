// --export: a folder you can post from. The share card, every slide as a
// 1080x1920 story image, and a 4:5 video with music. Private or not is the
// caller's choice; plenty of people are happy to show their project names.

import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { render } from "./render.mjs";
import { launch } from "./browser.mjs";
import { track } from "./music.mjs";
import { posts, postFile } from "./posts.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function filmPage(story, summaryLines) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = (t) => { const x = new Date(t); return `${x.getDate()} ${MONTHS[x.getMonth()]}`; };
  const range = story.range.first ? `${d(story.range.first)} – ${d(story.range.last)} ${new Date(story.range.last).getFullYear()}` : "";
  const film = {
    summary: summaryLines,
    range: range.toLowerCase(),
    sub: `${story.sessions.yours} sessions · ${story.sessions.activeDays} days · ${story.you.promptCount} prompts`,
  };
  const tpl = readFileSync(join(here, "..", "template", "film.html"), "utf8");
  return tpl.replace("/*__FILM__*/{ summary: [], range: \"\", sub: \"\" }", () => JSON.stringify(film).replace(/</g, "\\u003c"));
}

function serve(files) {
  const server = createServer((req, res) => {
    const f = files[req.url.split("?")[0]];
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": f[1], "cache-control": "no-store" });
    res.end(f[0]);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

export async function exportFolder(story, dir, { browser, ffmpeg, summaryLines, log = () => {} }) {
  mkdirSync(join(dir, "slides"), { recursive: true });
  const html = render(story);
  writeFileSync(join(dir, "story.html"), html);
  writeFileSync(join(dir, "post.txt"), postFile(posts(story)));

  const files = { "/story.html": [html, "text/html; charset=utf-8"] };
  const server = await serve(files);
  const base = `http://127.0.0.1:${server.address().port}`;
  const br = await launch(browser);
  const made = { slides: 0, card: false, video: false };
  try {
    // slides + card
    const page = await br.newPage(540, 960);
    await page.goto(`${base}/story.html?still&slide=0`);
    const n = await page.eval(`document.querySelectorAll(".slide").length`);
    for (let i = 0; i < n - 1; i++) {
      await page.goto(`${base}/story.html?still&slide=${i}`);
      await new Promise((r) => setTimeout(r, 250));
      writeFileSync(join(dir, "slides", `${String(i + 1).padStart(2, "0")}.png`), await page.screenshot());
      made.slides++;
      log({ phase: "slides", i: made.slides, n: n - 1 });
    }
    await page.goto(`${base}/story.html?still&slide=${n - 1}`);
    const card = await page.eval(`new Promise((r) => setTimeout(() => r(document.getElementById("card").toDataURL("image/png")), 400))`);
    const cardPng = Buffer.from(card.split(",")[1], "base64");
    writeFileSync(join(dir, "card.png"), cardPng);
    made.card = true;
    await page.close();

    // video
    if (ffmpeg) {
      log({ phase: "video", t: 0 });
      files["/film.html"] = [filmPage(story, summaryLines), "text/html; charset=utf-8"];
      files["/card.png"] = [cardPng, "image/png"];
      // a background tab stops painting, so the film tab has to be the front one
      const film = await br.newPage(540, 675);
      await film.front();
      await film.goto(`${base}/film.html`);
      await film.waitFor(`document.getElementById("story").contentWindow.document.readyState === "complete"`, 20000);

      const frames = [];
      br.on("Page.screencastFrame", (f, sid) => {
        if (sid !== film.sessionId) return;
        frames.push({ t: f.metadata.timestamp, data: f.data });
        film.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      });
      await film.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
      const t0 = Date.now() / 1000;
      const ticker = setInterval(() => log({ phase: "video", t: Date.now() / 1000 - t0 }), 250);
      await film.eval(`window.__start(), true`);
      await film.waitFor(`window.__done === true`, 180000);
      clearInterval(ticker);
      const cuts = await film.eval(`window.__cuts`);
      await film.send("Page.stopScreencast");
      const tEnd = Date.now() / 1000;

      const work = mkdtempSync(join(tmpdir(), "claude-unwrapped-film-"));
      try {
        frames.sort((a, b) => a.t - b.t);
        const use = frames.filter((f) => f.t >= t0 - 0.05);
        let list = "";
        use.forEach((f, i) => {
          const name = `f${String(i).padStart(5, "0")}.jpg`;
          writeFileSync(join(work, name), Buffer.from(f.data, "base64"));
          const next = i + 1 < use.length ? use[i + 1].t : Math.max(f.t + 0.5, tEnd);
          list += `file '${name}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}\n`;
        });
        list += `file 'f${String(use.length - 1).padStart(5, "0")}.jpg'\n`;
        writeFileSync(join(work, "list.txt"), list);

        const duration = tEnd - use[0].t;
        const offset = use[0].t - t0;
        const rel = cuts.map((c) => c - offset);
        const storyStart = rel[2] ?? 8;  // hook, terminal, then the story: drums come in there
        writeFileSync(join(work, "track.wav"), track(duration, rel.slice(1), storyStart));
        log({ phase: "encode" });
        execFileSync(ffmpeg, ["-loglevel", "error", "-y",
          "-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-i", join(work, "track.wav"),
          "-vf", "scale=1080:1350:flags=lanczos,fps=30", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", join(dir, "unwrapped.mp4")], { stdio: "ignore" });
        made.video = true;
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
  } finally {
    await br.close();
    server.close();
  }
  return made;
}
