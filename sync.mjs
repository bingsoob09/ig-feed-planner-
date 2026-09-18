// Reads your Notion Content database and writes posts.json.
// Runs automatically inside GitHub, never in your browser.
// Your Notion key comes from a GitHub Secret called NOTION_KEY.

import { writeFileSync } from "node:fs";

const KEY = process.env.NOTION_KEY;
const DATABASE_ID = "62aaae7820bf825c90d98160fef16f56";
const VERSION = "2022-06-28";

if (!KEY) {
  console.error("NOTION_KEY secret is missing.");
  process.exit(1);
}

const notion = (path, init = {}) =>
  fetch("https://api.notion.com/v1/" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + KEY,
      "Notion-Version": VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const text = (rt) => (rt || []).map((r) => r.plain_text).join("");
const checked = (p) => !!(p && p.checkbox);

const pillarCache = {};
async function pillarName(id) {
  if (pillarCache[id] !== undefined) return pillarCache[id];
  pillarCache[id] = "";
  try {
    const r = await notion("pages/" + id);
    if (r.ok) {
      const pg = await r.json();
      const t = Object.values(pg.properties || {}).find((x) => x.type === "title");
      pillarCache[id] = t ? text(t.title) : "";
    }
  } catch {}
  return pillarCache[id];
}

const res = await notion("databases/" + DATABASE_ID + "/query", {
  method: "POST",
  body: JSON.stringify({ page_size: 100 }),
});

if (!res.ok) {
  console.error("Notion refused:", res.status, (await res.text()).slice(0, 400));
  process.exit(1);
}

const data = await res.json();
const posts = [];

for (const page of data.results) {
  const P = page.properties || {};
  const title = text(P["Name"] && P["Name"].title);
  if (!title) continue; // skip blank rows

  const rel = (P["Content Pillar"] && P["Content Pillar"].relation) || [];
  const pillar = rel.length ? await pillarName(rel[0].id) : "";

  // Picture: the Image link, else a file uploaded to File, else the page cover.
  let image = (P["Image"] && P["Image"].url) || "";
  if (!image) {
    const files = (P["File"] && P["File"].files) || [];
    if (files.length) {
      image =
        (files[0].file && files[0].file.url) ||
        (files[0].external && files[0].external.url) || "";
    }
  }
  if (!image && page.cover) {
    image =
      (page.cover.external && page.cover.external.url) ||
      (page.cover.file && page.cover.file.url) || "";
  }

  posts.push({
    id: page.id,
    title,
    caption: text(P["Description"] && P["Description"].rich_text),
    pillar,
    format: (P["Format"] && P["Format"].select && P["Format"].select.name) || "Photo",
    writing: checked(P["Writing"]),
    filming: checked(P["Filming"]),
    editing: checked(P["Editing"]),
    posting: checked(P["Posting"]),
    image,
    pinned: checked(P["Pinned"]),
    date: (P["Date"] && P["Date"].date && P["Date"].date.start) || "",
    order:
      P["Grid Order"] && typeof P["Grid Order"].number === "number"
        ? P["Grid Order"].number
        : null,
    notionUrl: page.url,
  });
}

posts.sort((a, b) => {
  const ao = a.order === null ? 1e9 : a.order;
  const bo = b.order === null ? 1e9 : b.order;
  if (ao !== bo) return ao - bo;
  return String(a.date).localeCompare(String(b.date));
});

writeFileSync(
  "posts.json",
  JSON.stringify({ posts, syncedAt: new Date().toISOString() }, null, 1)
);

console.log("Wrote posts.json with " + posts.length + " post(s).");
