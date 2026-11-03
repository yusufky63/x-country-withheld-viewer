import { failureNote, markTitle, profileMarkTitle } from "../core/i18n";
import type { AppliedMark, FailedMark, Language, ProfileMark } from "../core/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARK_CLASS = "xcwv-mark";
const NOTE_CLASS = "xcwv-note";
/** Draws the glowing border. An attribute leaves X's own class names and styles alone. */
const RECOVERED_ATTRIBUTE = "data-xcwv-recovered";
const SCAN_DELAY_MS = 150;
const FAILURE_NOTE_INTERVAL_MS = 1_000;
const MESSAGE_KEY_LENGTH = 32;
const ROW_SEARCH_DEPTH = 3;
// X only keeps the posts near the viewport in the page, so older entries can go.
const MAX_REMEMBERED = 2_000;
const PERMALINK_ID = /\/status\/(\d+)(?:[?#]|$)/;

function trimOldest(entries: Map<string, unknown>): void {
  for (const key of entries.keys()) {
    if (entries.size <= MAX_REMEMBERED) return;
    entries.delete(key);
  }
}

/** Matches the post's own link, with or without the query X adds, but not `/photo/1` and the like. */
function isPermalink(href: string | null, id: string): boolean {
  return new RegExp(`/status/${id}(?:[?#]|$)`).test(href ?? "");
}

/**
 * The Relay client pads a wrapper around the article, so a border on the article would
 * hug the content and look narrower than the row. The classic client's article already
 * fills the row, so no wider ancestor is found nearby and the article itself is used.
 */
function rowOf(article: Element): Element {
  const width = article.getBoundingClientRect().width;
  let ancestor = article.parentElement;
  for (let level = 0; level < ROW_SEARCH_DEPTH && ancestor; level += 1) {
    if (ancestor.getBoundingClientRect().width > width + 1) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return article;
}

function createIcon(doc: Document): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const lens = doc.createElementNS(SVG_NS, "path");
  lens.setAttribute("d", "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z");
  const pupil = doc.createElementNS(SVG_NS, "circle");
  pupil.setAttribute("cx", "12");
  pupil.setAttribute("cy", "12");
  pupil.setAttribute("r", "3");
  svg.append(lens, pupil);
  return svg;
}

/**
 * Adds the only visible differences on a recovered post: a glowing border and one small
 * icon beside its timestamp. X renders everything else, so the DOM here is X's own and
 * may change. Nothing of X's is removed, which keeps React's view of the tree intact.
 */
export class Marker {
  readonly #doc: Document;
  readonly #applied = new Map<string, AppliedMark>();
  readonly #failed = new Map<string, FailedMark>();
  readonly #profiles = new Map<string, ProfileMark>();
  #observer: MutationObserver | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #notesTimer: ReturnType<typeof setTimeout> | null = null;
  #lastNotesAt = 0;
  #glow = true;
  #language: Language;

  constructor(doc: Document, language: Language = "tr") {
    this.#doc = doc;
    this.#language = language;
  }

  /** Redraws what is on screen, so the setting needs no reload. */
  setLanguage(language: Language): void {
    if (language === this.#language) return;
    this.#language = language;
    for (const element of this.#doc.querySelectorAll(`.${MARK_CLASS}, .${NOTE_CLASS}`)) element.remove();
    this.#lastNotesAt = 0;
    this.scan();
  }

  /** Applies at once to posts already on screen, so the setting needs no reload. */
  setGlow(enabled: boolean): void {
    this.#glow = enabled;
    if (!enabled) {
      for (const element of this.#doc.querySelectorAll(`[${RECOVERED_ATTRIBUTE}]`)) element.removeAttribute(RECOVERED_ATTRIBUTE);
    }
    this.scan();
  }

  add(applied: AppliedMark[], failed: FailedMark[], profiles: ProfileMark[] = []): void {
    for (const mark of applied) {
      this.#applied.set(mark.id, mark);
      this.#failed.delete(mark.id);
    }
    for (const failure of failed) {
      if (!this.#applied.has(failure.id)) this.#failed.set(failure.id, failure);
    }
    trimOldest(this.#applied);
    trimOldest(this.#failed);
    for (const profile of profiles) this.#profiles.set(profile.handle.toLowerCase(), profile);
    this.#observe();
    this.#schedule();
  }

  /** Starts lazily so pages with nothing recovered pay no observer cost. */
  #observe(): void {
    if (this.#observer || !this.#doc.documentElement) return;
    const view = this.#doc.defaultView;
    if (!view) return;
    // Only new nodes can need a marker. X also removes nodes constantly while scrolling.
    this.#observer = new view.MutationObserver((records) => {
      if (records.some((record) => record.addedNodes.length > 0)) this.#schedule();
    });
    this.#observer.observe(this.#doc.documentElement, { childList: true, subtree: true });
  }

  #schedule(): void {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.scan();
    }, SCAN_DELAY_MS);
  }

  scan(): void {
    if (this.#applied.size > 0 || this.#doc.querySelector(`.${MARK_CLASS}`)) {
      this.#removeStale();
      this.#markPermalinks();
      this.#markQuoted();
    }
    if (this.#profiles.size > 0) this.#markProfileHeader();
    if (this.#failed.size > 0) this.#scheduleFailureNotes();
  }

  /** Walking every text node is the slowest step here, so it runs at most once a second. */
  #scheduleFailureNotes(): void {
    const wait = this.#lastNotesAt + FAILURE_NOTE_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.#lastNotesAt = Date.now();
      this.#noteFailures();
    } else if (this.#notesTimer === null) {
      this.#notesTimer = setTimeout(() => {
        this.#notesTimer = null;
        this.#scheduleFailureNotes();
      }, wait);
    }
  }

  /** X can reuse a node for another post while virtualizing, so markers are rechecked. */
  #removeStale(): void {
    for (const element of this.#doc.querySelectorAll<HTMLElement>(`.${MARK_CLASS}`)) {
      const id = element.dataset.xcwvId ?? "";
      const previous = element.previousElementSibling;
      if (id.startsWith("@")) {
        if (previous?.textContent?.trim().toLowerCase() !== id.toLowerCase()) element.remove();
        continue;
      }
      const mark = this.#applied.get(id);
      const stillValid =
        mark &&
        previous &&
        (previous.tagName === "TIME"
          ? previous.getAttribute("datetime") === new Date(mark.createdAtMs).toISOString()
          : isPermalink(previous.getAttribute("href"), id));
      if (!stillValid) element.remove();
    }
    for (const element of this.#doc.querySelectorAll(`[${RECOVERED_ATTRIBUTE}]`)) {
      const id = element.getAttribute(RECOVERED_ATTRIBUTE);
      if (!element.querySelector(`.${MARK_CLASS}[data-xcwv-id="${id}"]`)) element.removeAttribute(RECOVERED_ATTRIBUTE);
    }
  }

  #createMark(id: string, title: string, anchor: Element): HTMLElement {
    const element = this.#doc.createElement("span");
    element.className = MARK_CLASS;
    element.dataset.xcwvId = id;
    element.title = title;
    element.setAttribute("role", "img");
    element.setAttribute("aria-label", title);
    // X sets the muted timestamp color on the anchor, and it differs per theme.
    const color = this.#doc.defaultView?.getComputedStyle(anchor).color;
    if (color) element.style.color = color;
    element.append(createIcon(this.#doc));
    return element;
  }

  /** One pass over the page's links, so the cost follows what is on screen, not the session. */
  #markPermalinks(): void {
    for (const anchor of this.#doc.querySelectorAll('a[href*="/status/"]')) {
      const id = anchor.getAttribute("href")?.match(PERMALINK_ID)?.[1];
      const mark = id ? this.#applied.get(id) : undefined;
      if (!mark || mark.quoted) continue;
      const article = anchor.closest("article");
      const container = article ?? anchor.parentElement;
      if (!container) continue;
      if (!container.querySelector(`.${MARK_CLASS}[data-xcwv-id="${mark.id}"]`)) {
        anchor.after(this.#createMark(mark.id, markTitle(mark, this.#language), anchor));
      }
      // Measuring forces layout, so it happens once per post rather than on every scan.
      if (article && this.#glow && !article.closest(`[${RECOVERED_ATTRIBUTE}="${mark.id}"]`)) {
        rowOf(article).setAttribute(RECOVERED_ATTRIBUTE, mark.id);
      }
    }
  }

  #markQuoted(): void {
    const quoted = new Map<string, AppliedMark>();
    for (const mark of this.#applied.values()) {
      if (mark.quoted) quoted.set(new Date(mark.createdAtMs).toISOString(), mark);
    }
    if (quoted.size === 0) return;
    for (const time of this.#doc.querySelectorAll("time[datetime]")) {
      const mark = quoted.get(time.getAttribute("datetime") ?? "");
      const card = mark ? time.closest('[role="link"]') : null;
      if (!mark || !card || !(card.textContent ?? "").toLowerCase().includes(`@${mark.handle}`.toLowerCase())) continue;
      if (!card.querySelector(`.${MARK_CLASS}[data-xcwv-id="${mark.id}"]`)) {
        time.after(this.#createMark(mark.id, markTitle(mark, this.#language), time));
      }
      if (this.#glow) card.setAttribute(RECOVERED_ATTRIBUTE, mark.id);
    }
  }

  /** The header is the only place in `main` that shows the handle outside a post. */
  #markProfileHeader(): void {
    const route = this.#doc.defaultView?.location.pathname.split("/")[1]?.toLowerCase() ?? "";
    const profile = this.#profiles.get(route);
    const main = this.#doc.querySelector("main");
    if (!profile || !main) return;
    const key = `@${profile.handle}`;
    if (main.querySelector(`.${MARK_CLASS}[data-xcwv-id="${key}"]`)) return;
    for (const span of main.querySelectorAll("span")) {
      if (span.closest("article") || span.childElementCount > 0) continue;
      if ((span.textContent ?? "").trim().toLowerCase() === key.toLowerCase()) {
        span.after(this.#createMark(key, profileMarkTitle(profile, this.#language), span));
        return;
      }
    }
  }

  #noteFailures(): void {
    const root = this.#doc.querySelector("main") ?? this.#doc.body;
    const view = this.#doc.defaultView;
    if (!root || !view) return;
    const failures = [...this.#failed.values()].filter((failure) => failureNote(failure.status, this.#language));
    if (failures.length === 0) return;

    const walker = this.#doc.createTreeWalker(root, view.NodeFilter.SHOW_TEXT);
    const placements: Array<[Element, FailedMark]> = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const failure = failures.find((candidate) => text.includes(candidate.message.slice(0, MESSAGE_KEY_LENGTH)));
      if (failure && node.parentElement && !node.parentElement.closest(`.${NOTE_CLASS}`)) {
        placements.push([node.parentElement, failure]);
      }
    }

    for (const [element, failure] of placements) {
      const block = element.closest("[dir]") ?? element;
      const parent = block.parentElement;
      if (!parent || parent.querySelector(`.${NOTE_CLASS}[data-xcwv-id="${failure.id}"]`)) continue;
      const note = this.#doc.createElement("div");
      note.className = NOTE_CLASS;
      note.dataset.xcwvId = failure.id;
      note.textContent = failureNote(failure.status, this.#language) ?? "";
      const color = view.getComputedStyle(element).color;
      if (color) note.style.color = color;
      block.after(note);
    }
  }
}
