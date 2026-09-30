import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { posts } from "./posts.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// One self-contained HTML file: the template with the story inlined.
// "</" is escaped so a project called </script> cannot end the script tag.
export function render(story) {
  const tpl = readFileSync(join(here, "..", "template", "story.html"), "utf8");
  const json = JSON.stringify({ ...story, posts: posts(story) }).replace(/</g, "\\u003c");
  return tpl.replace("/*__STORY__*/null", () => json);
}
