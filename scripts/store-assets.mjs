// Draws the store's screenshots and promo tile, and the README's popup pictures, from the
// built extension: `pnpm store:assets`. The popup pictures are the real popup. The X rows
// are a stand-in with a made-up account, using the real marker styles, and say so on the image.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

/* global chrome, document -- These run inside the browser, in the worker and on the page. */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = join(root, "store", "assets");
const docs = join(root, "docs", "assets");

const WIDTH = 1280;
const HEIGHT = 800;
const BRAND = "#0370fd";

const dataUri = (path, type) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const font = (family, weight, file, range = "") =>
  `@font-face{font-family:"${family}";font-weight:${weight};src:url("${dataUri(join(dist, "fonts", file), "font/woff2")}") format("woff2");${range}}`;
const LATIN_EXT = "unicode-range:U+0100-024F;";
const FONTS = [
  font("DM Sans", 400, "dm-sans-400.woff2"),
  font("DM Sans", 500, "dm-sans-500.woff2"),
  font("DM Sans", 400, "dm-sans-ext-400.woff2", LATIN_EXT),
  font("DM Sans", 500, "dm-sans-ext-500.woff2", LATIN_EXT),
  font("JetBrains Mono", 400, "jetbrains-mono-400.woff2"),
  font("JetBrains Mono", 400, "jetbrains-mono-ext-400.woff2", LATIN_EXT),
].join("");

const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

const STYLE = `
${FONTS}
${readFileSync(join(dist, "marker.css"), "utf8")}
*{box-sizing:border-box}
html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:#fff;color:#0a0b0d}
body{display:grid;grid-template-columns:440px 1fr;font:400 16px/1.5 "DM Sans",sans-serif}
.copy{display:flex;flex-direction:column;padding:64px 48px;border-right:1px solid #e3e5e9}
.eyebrow{display:flex;align-items:center;gap:10px;color:#5b616e;font:400 13px/1.5 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase}
.eyebrow::before{content:"";width:14px;height:2px;background:${BRAND}}
h1{margin:24px 0 16px;font-size:40px;font-weight:500;line-height:1.1;letter-spacing:-.02em}
.body{margin:0;color:#5b616e;font-size:18px}
.foot{margin:auto 0 0;color:#5b616e;font:400 12px/1.5 "JetBrains Mono",monospace}
.stage{display:flex;flex-direction:column;justify-content:center;gap:12px;padding:48px 64px;background:#f4f5f7}
.label{margin:12px 0 0;color:#5b616e;font:400 12px/1.5 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase}
.panel{background:#fff;border:1px solid #e3e5e9;font-family:"Segoe UI",-apple-system,"Helvetica Neue",Arial,sans-serif;font-size:17px;line-height:24px;color:#0f1419}
.notice{margin:16px;padding:16px;border:1px solid #e3e5e9;border-radius:12px;background:#f7f9f9;color:#536471}
.notice a{color:#1d9bf0}
.row{display:grid;grid-template-columns:48px 1fr;gap:12px;padding:16px;border-bottom:1px solid #eff3f4}
.row:last-child{border-bottom:0}
.avatar{width:48px;height:48px;border-radius:50%;background:#cfd9de}
.who{display:flex;align-items:center;gap:6px;white-space:nowrap}
.name{font-weight:700}
.dim{color:#536471}
.actions{display:flex;justify-content:space-between;max-width:420px;margin-top:10px;color:#536471;font-size:14px}
.action{display:flex;align-items:center;gap:6px}
.action svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.xcwv-mark{color:#536471;opacity:1;width:16px;height:16px}
.tip{position:absolute;padding:6px 10px;border-radius:4px;background:#0f1419;color:#fff;font-size:14px;line-height:20px;white-space:nowrap}
.anchor{position:relative;display:inline-flex}
.banner{height:140px;background:#cfd9de}
.profile{padding:0 16px 16px;border-bottom:1px solid #eff3f4}
.profile .avatar{width:104px;height:104px;margin-top:-52px;border:4px solid #fff;background:#aab8c2}
.profile h2{margin:8px 0 0;font-size:22px;line-height:28px}
.popups{flex-direction:row;align-items:flex-start;justify-content:center;gap:32px}
.popups img{display:block;border:1px solid #e3e5e9}
`;

const ICONS = {
  reply: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/></svg>',
  repost: '<svg viewBox="0 0 24 24"><path d="M4 7l3-3 3 3M7 4v12a2 2 0 0 0 2 2h5M20 17l-3 3-3-3M17 20V8a2 2 0 0 0-2-2h-5"/></svg>',
  like: '<svg viewBox="0 0 24 24"><path d="M12 20s-8-5-8-10.500a4.500 4.500 0 0 1 8-2.800 4.500 4.500 0 0 1 8 2.800C20 15 12 20 12 20Z"/></svg>',
  views: '<svg viewBox="0 0 24 24"><path d="M5 20v-7M12 20V5M19 20v-10"/></svg>',
};

function actions(counts) {
  return `<div class="actions">${Object.keys(ICONS)
    .map((key, index) => `<span class="action">${ICONS[key]}${counts[index]}</span>`)
    .join("")}</div>`;
}

function post({ name, handle, time, text, counts, recovered, tip }) {
  const mark = recovered ? `<span class="anchor"><span class="xcwv-mark">${EYE}</span>${tip ?? ""}</span>` : "";
  return `<article class="row"${recovered ? ' data-xcwv-recovered="1"' : ""}><div class="avatar"></div><div>
    <div class="who"><span class="name">${name}</span><span class="dim">${handle} · ${time}</span>${mark}</div>
    <div>${text}</div>${actions(counts)}</div></article>`;
}

const COPY = {
  tr: {
    sample: "Temsili görünüm. Hesap ve metin örnektir.",
    real: "Eklentinin gerçek ekranları.",
    name: "Örnek Hesap",
    handle: "@ornek_hesap",
    other: "Başka Bir Hesap",
    otherHandle: "@baska_hesap",
    time: "2s",
    withheld: "Bu gönderi Türkiye'de gizlenmişti. Şimdi aynı yerde, diğer gönderilerle aynı görünüyor.",
    normal: "Bu normal bir gönderi, eklenti ona dokunmaz.",
    second: "Hesabın başka bir gönderisi de sekmede yerini alır.",
    bio: "Profil, gönderiler ve sekmeler X'in kendi görünümünde.",
    slides: [
      {
        eyebrow: "01 — Gönderiler",
        title: "Gizlenen gönderi olduğu yerde görünür",
        body: "X'in uyarısının yerine gönderinin kendisi gelir. Çizimi X yapar, ayrı kart ya da pencere açılmaz.",
        before: "Eklentisiz",
        after: "Eklentiyle",
        notice: `Bu gönderi, yasal bir talep nedeniyle Türkiye'de gizlendi. <a>Daha fazla bilgi al</a>`,
      },
      {
        eyebrow: "02 — İşaret",
        title: "Hangisinin kurtarıldığı belli olur",
        body: "Kenar hafifçe parlar, zaman damgasının yanında küçük bir göz durur. Üzerine gelince ülke ve kaynak yazar.",
        tip: "Gizlendiği ülke: Türkiye. Kaynak: FxTwitter.",
      },
      {
        eyebrow: "03 — Hesaplar",
        title: "Gizlenen hesaplar da açılır",
        body: "Profil normal görünür, gönderiler de sekmelerine dolar. Göz bu kez kullanıcı adının yanında durur.",
        tip: "Hesabın gizlendiği ülke: Türkiye. Kaynak: FxTwitter.",
      },
      {
        eyebrow: "04 — Kontrol",
        title: "Önce sorar, sonra çalışır",
        body: "İlk açılışta neyin nereye gittiğini anlatır ve onayını ister. Ayarlar tek pencerede, istediğin an kapatırsın.",
      },
    ],
  },
  en: {
    sample: "Illustration. The account and text are examples.",
    real: "The extension's real screens.",
    name: "Sample Account",
    handle: "@sample_account",
    other: "Another Account",
    otherHandle: "@another_account",
    time: "2h",
    withheld: "This post was withheld in Turkey. Now it sits in the same place and looks like any other post.",
    normal: "This is a normal post, and the extension leaves it alone.",
    second: "Another post from the account takes its place in the tab too.",
    bio: "The profile, posts and tabs in X's own look.",
    slides: [
      {
        eyebrow: "01 — Posts",
        title: "A withheld post shows where it belongs",
        body: "The post itself replaces X's notice. X draws it, so no separate card or window opens.",
        before: "Without the extension",
        after: "With the extension",
        notice: `This Post from @sample_account has been withheld in Turkey in response to a legal demand. <a>Learn more</a>`,
      },
      {
        eyebrow: "02 — Marker",
        title: "You can tell which ones were recovered",
        body: "A soft glow around the post and a small eye next to its timestamp. Hover over the eye for the country and the source.",
        tip: "Withheld in Turkey. Shown from FxTwitter.",
      },
      {
        eyebrow: "03 — Accounts",
        title: "Withheld accounts open too",
        body: "The profile looks normal and its posts fill the tabs. Here the eye sits next to the username.",
        tip: "Account withheld in Turkey. Shown from FxTwitter.",
      },
      {
        eyebrow: "04 — Control",
        title: "It asks first, then it works",
        body: "On first run it explains what goes where and asks for your agreement. Settings sit in one window, and you can turn it off at any time.",
      },
    ],
  },
};

function page(slide, stage, foot, stageClass = "") {
  return `<!doctype html><meta charset="utf-8"><style>${STYLE}</style><body>
    <div class="copy"><div class="eyebrow">${slide.eyebrow}</div><h1>${slide.title}</h1><p class="body">${slide.body}</p><p class="foot">${foot}</p></div>
    <div class="stage ${stageClass}">${stage}</div></body>`;
}

function slides(language, popups) {
  const t = COPY[language];
  const [one, two, three, four] = t.slides;
  const recoveredPost = (tip) => post({ name: t.name, handle: t.handle, time: t.time, text: t.withheld, counts: ["12", "4", "86", "2 B"], recovered: true, tip });
  const normalPost = post({ name: t.other, handle: t.otherHandle, time: t.time, text: t.normal, counts: ["3", "1", "19", "640"] });
  const tip = (text) => `<span class="tip" style="left:24px;top:-3px">${text}</span>`;
  return [
    page(
      one,
      `<p class="label">${one.before}</p><div class="panel"><div class="notice">${one.notice}</div></div>
       <p class="label">${one.after}</p><div class="panel">${recoveredPost()}</div>`,
      t.sample,
    ),
    page(two, `<div class="panel">${normalPost}${recoveredPost(tip(two.tip))}${normalPost}</div>`, t.sample),
    page(
      three,
      `<div class="panel"><div class="banner"></div><div class="profile"><div class="avatar"></div><h2>${t.name}</h2>
        <div class="who dim">${t.handle}<span class="anchor"><span class="xcwv-mark">${EYE}</span>${tip(three.tip)}</span></div><div style="margin-top:8px">${t.bio}</div></div>
        <article class="row" data-xcwv-recovered="1"><div class="avatar"></div><div><div class="who"><span class="name">${t.name}</span><span class="dim">${t.handle} · ${t.time}</span></div><div>${t.second}</div>${actions(["7", "2", "41", "980"])}</div></article></div>`,
      t.sample,
    ),
    page(four, `<img src="${popups.consent}" alt=""><img src="${popups.settings}" alt="">`, t.real, "popups"),
  ];
}

// The art matches the toolbar icon: a lens of two circles with a ring cut into it.
const PROMO = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:440px;height:280px;background:${BRAND}}svg{display:block}</style>
<svg width="440" height="280" viewBox="-2.2 -1.4 4.4 2.8"><defs><clipPath id="a"><circle cx="0" cy="0.46" r="0.86"/></clipPath></defs>
<circle cx="0" cy="-0.46" r="0.86" fill="#fff" clip-path="url(#a)"/><circle r="0.34" fill="${BRAND}"/><circle r="0.2" fill="#fff"/></svg>`;

/** The store refuses images with an alpha channel, so this stops the build instead of the upload. */
function assertOpaque(buffer, name) {
  const colorType = buffer[25];
  if (colorType !== 2) throw new Error(`${name} has PNG color type ${colorType}, expected 2 (RGB)`);
}

mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "playwright_xcwv-store-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    deviceScaleFactor: 1,
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html`;
  const tab = await context.newPage();

  async function shootPopup(settings, colorScheme) {
    await worker.evaluate(async (stored) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set(stored);
    }, settings);
    await tab.setViewportSize({ width: 320, height: 520 });
    await tab.emulateMedia({ colorScheme });
    await tab.goto(popupUrl);
    await tab.waitForSelector("body.ready");
    return tab.screenshot({ fullPage: true, type: "png" });
  }

  writeFileSync(join(docs, "popup-acik.png"), await shootPopup({ consent: "accepted" }, "light"));
  writeFileSync(join(docs, "popup-koyu.png"), await shootPopup({ consent: "accepted" }, "dark"));

  for (const language of ["tr", "en"]) {
    const popups = {
      consent: `data:image/png;base64,${(await shootPopup({ language }, "light")).toString("base64")}`,
      settings: `data:image/png;base64,${(await shootPopup({ language, consent: "accepted" }, "light")).toString("base64")}`,
    };
    await tab.emulateMedia({ colorScheme: "light" });
    await tab.setViewportSize({ width: WIDTH, height: HEIGHT });
    let number = 0;
    for (const html of slides(language, popups)) {
      number += 1;
      await tab.setContent(html, { waitUntil: "load" });
      await tab.evaluate(() => document.fonts.ready);
      const image = await tab.screenshot({ type: "png" });
      assertOpaque(image, `${language}-${number}`);
      writeFileSync(join(out, `${language}-${number}.png`), image);
    }
  }

  await tab.setViewportSize({ width: 440, height: 280 });
  await tab.setContent(PROMO);
  const promo = await tab.screenshot({ type: "png" });
  assertOpaque(promo, "promo");
  writeFileSync(join(out, "promo-440x280.png"), promo);
} finally {
  // Closing a persistent context ends the browser process tree, also after a failure.
  await context?.close().catch(() => {});
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}
