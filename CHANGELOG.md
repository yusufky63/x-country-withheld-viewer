# Changelog

## 0.1.8

- Ask for agreement before the extension does anything, in a tab on install and in the popup, as the Chrome Web Store requires. Until then no source is asked and nothing is kept. The userscript is unchanged.
- Keep no diagnostics while switched off, since they name page paths.
- Add a privacy policy and link it from the popup.
- Give the 128px icon the margin the store asks for.
- Add `pnpm package` and `pnpm store:assets`, and the store listing texts under `store/`.

## 0.1.7

- Add a userscript for Tampermonkey and Violentmonkey, built from the same code, with its settings in the manager's menu and automatic updates.
- Let only one copy run when the extension and the userscript are both installed.

## 0.1.6

- Keep a recovered profile recovered. X overwrites its user record from every response, so copies of the account in later GraphQL and REST responses are now filled too, and repeat lookups no longer depend on the sources.
- Name the requests in the console if the withheld page ever comes back.

## 0.1.5

- Show the extension in Turkish by default, with English available from the popup. The language applies at once.
- Follow X's own language for the repost line on recovered timelines.

## 0.1.4

- Scan the page in one pass, so long timelines stay smooth however many posts were recovered.
- Never lose a recovered post to a full cache.
- Wait at most 4 seconds on the sources before showing X's response, down from 6.
- Parse fewer of X's responses and write to the console only when something was found.
- Leave server-rendered withheld pages alone while the extension is switched off.
- Shrink the injected scripts by about half.

## 0.1.3

- Fill every profile tab of a withheld account on the classic client: the default Posts view, All, Replies, Reposts and Media.

## 0.1.2

- Keep a recovered profile recovered when a later response repeats the blocked copy.
- Show the version in the popup and in the console, so it is clear which build is running.

## 0.1.1

- Detect withheld accounts in signed-in responses, which keep the flags under `profile_bio` and have no `legacy` user.
- Fill in only what X stripped from a withheld profile, so follow state and counts stay real.
- Add a popup setting to turn the glowing border off.
- Write status lines to the console, so it is clear the extension is running and what X sent.

## 0.1.0

- Show country-withheld posts, replies and quotes through X's own interface, with a glowing border and a small eye icon beside the timestamp.
- Show withheld accounts as normal profiles, with their posts, quotes and reposts.
- Recover from FxTwitter, then x.md, with caching, rate limits and retries.
- Keep X's notice with one explanatory line when no source has the post.
- Add a toolbar popup to turn lookups off, control the x.md fallback, clear recovered posts and copy diagnostics.
