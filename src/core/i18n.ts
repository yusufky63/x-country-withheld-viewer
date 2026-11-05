import type { AppliedMark, Language, ProfileMark, ProviderId, RecoveryStatus } from "./types";

const SOURCE_NAMES: Record<ProviderId, string> = { fxtwitter: "FxTwitter", xmd: "x.md" };

/** The popup's texts. Each key matches a `data-i18n` attribute in popup.html. */
export const POPUP_TEXT = {
  tr: {
    tagline: "Ülke bazlı gizlenen gönderileri X'te diğerleri gibi gösterir.",
    enabledLabel: "Gizlenen gönderileri göster",
    sources: "Kaynaklar",
    primary: "birincil",
    xmd: "x.md yedeği",
    display: "Görünüm",
    glow: "Parlayan kenarlık",
    language: "Dil",
    session: "Bu oturum",
    shown: "Gösterilen gönderi",
    missed: "Kurtarılamayan",
    disclosure:
      "Gizlenen gönderilerin kimlikleri yukarıdaki kaynaklara gider, bu kaynaklar IP adresini de görür. X çerezleri ve token'ları tarayıcından çıkmaz. Kaynak değişiklikleri bundan sonra yüklenen gönderilere uygulanır.",
    clear: "Kurtarılan gönderileri temizle",
    copy: "Tanı bilgisini kopyala",
    consentTitle: "Açmadan önce onayın gerekiyor",
    consentIntro: "Onay verene kadar hiçbir şey göndermez.",
    consentReads: "X'in sayfaya gönderdiği yanıtları tarayıcının içinde okur, gizlenen gönderi ve hesapları bulur.",
    consentSends:
      "Gizlenenlerin gönderi kimliğini, hesap kimliğini ve kullanıcı adını FxTwitter (api.fxtwitter.com) ve x.md (mdfromx.com) servislerine gönderir. Bu servisler IP adresini ve neyin istendiğini de görür.",
    consentKeeps: "Kurtarılan içerik ve tanı bilgisi bellekte durur, tarayıcı kapanınca silinir.",
    consentNever: "X çerezlerin, oturum bilgilerin ve mesajların gönderilmez. Geliştiriciye hiçbir veri gelmez.",
    consentAccept: "Kabul ediyorum, aç",
    consentDecline: "Kabul etmiyorum",
    consentDeclined: "Eklenti kapalı kalıyor. Fikrini değiştirirsen buradan açabilirsin.",
    consentReady: "Eklenti açık. Başlaması için açık X sekmelerini yenile.",
    policy: "Gizlilik politikası",
  },
  en: {
    tagline: "Shows country-withheld posts on X like any other post.",
    enabledLabel: "Show withheld posts",
    sources: "Sources",
    primary: "primary",
    xmd: "x.md fallback",
    display: "Display",
    glow: "Glowing border",
    language: "Language",
    session: "This session",
    shown: "Posts shown",
    missed: "Not recovered",
    disclosure:
      "The IDs of withheld posts go to the sources above, which also see your IP address. X cookies and tokens never leave your browser. Source changes apply to posts loaded after this.",
    clear: "Clear recovered posts",
    copy: "Copy diagnostics",
    consentTitle: "Your OK is needed before it starts",
    consentIntro: "Until you agree, it sends nothing.",
    consentReads: "It reads the responses X sends to the page, inside your browser, to find withheld posts and accounts.",
    consentSends:
      "It sends the post ID, account ID and username of what was withheld to FxTwitter (api.fxtwitter.com) and x.md (mdfromx.com). These services also see your IP address and what was asked for.",
    consentKeeps: "Recovered content and diagnostics stay in memory and are gone when the browser closes.",
    consentNever: "Your X cookies, login details and messages are not sent. Nothing reaches the developer.",
    consentAccept: "I agree, turn it on",
    consentDecline: "I do not agree",
    consentDeclined: "It stays off. You can turn it on here if you change your mind.",
    consentReady: "It is on. Reload any open X tabs for it to start.",
    policy: "Privacy policy",
  },
} as const satisfies Record<Language, Record<string, string>>;

export type PopupKey = keyof (typeof POPUP_TEXT)["tr"];

/** What the userscript's menu adds to the popup's texts, since a menu entry has no switch to show. */
export const MENU_TEXT = {
  tr: { on: "Açık", off: "Kapalı", languageName: "Türkçe" },
  en: { on: "On", off: "Off", languageName: "English" },
} as const satisfies Record<Language, Record<string, string>>;

export function copiedLines(count: number, language: Language): string {
  return language === "tr" ? `${count} satır kopyalandı` : `Copied ${count} lines`;
}

const FAILURE_NOTES: Record<Language, Partial<Record<RecoveryStatus, string>>> = {
  tr: {
    not_found: "Alternatif kaynaklarda bulunamadı.",
    deleted: "Alternatif kaynaklara göre bu gönderi silinmiş.",
    private: "Bu gönderi korumalı olduğu için gizli kalıyor.",
    suspended: "Alternatif kaynaklara göre bu hesap askıya alınmış.",
    rate_limited: "Alternatif kaynaklar istek sınırına takıldı. Daha sonra sayfayı yenileyip tekrar dene.",
    provider_unavailable: "Alternatif kaynaklar yanıt vermedi. Daha sonra sayfayı yenileyip tekrar dene.",
  },
  en: {
    not_found: "Not found in alternative sources.",
    deleted: "Alternative sources report this post as deleted.",
    private: "This post is private, so it stays hidden.",
    suspended: "Alternative sources report this account as suspended.",
    rate_limited: "Alternative sources are rate limiting. Reload later to try again.",
    provider_unavailable: "Alternative sources did not respond. Reload later to try again.",
  },
};

export function failureNote(status: RecoveryStatus, language: Language): string | undefined {
  return FAILURE_NOTES[language][status];
}

let englishRegionCodes: Map<string, string> | null = null;

/** X's post notices name the country in English, and Turkish text needs it as a region code. */
function regionCodeFromEnglish(name: string): string | undefined {
  if (!englishRegionCodes) {
    englishRegionCodes = new Map([["turkey", "TR"]]);
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const display = names.of(code);
        if (display && display !== code) englishRegionCodes.set(display.toLowerCase(), code);
      }
    }
  }
  return englishRegionCodes.get(name.toLowerCase());
}

/** X reports countries as ISO codes on profiles and as English names in post notices. */
function placeName(country: string, language: Language): string {
  const isCode = /^[A-Z]{2}$/.test(country);
  if (!isCode && language === "en") return country;
  const code = isCode ? country : regionCodeFromEnglish(country);
  if (!code) return country;
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(code) ?? country;
  } catch {
    return country;
  }
}

// The Turkish sentences avoid putting a suffix on the country's name, because the right
// suffix depends on the name's last vowel and these names come from outside.
export function markTitle(mark: AppliedMark, language: Language): string {
  const source = SOURCE_NAMES[mark.source];
  if (language === "tr") {
    if (mark.kind === "missing") return `X'te burada görünmüyor. Kaynak: ${source}.`;
    if (!mark.country) return `Ülkende gizlenmiş. Kaynak: ${source}.`;
    return `Gizlendiği ülke: ${placeName(mark.country, language)}. Kaynak: ${source}.`;
  }
  if (mark.kind === "missing") return `Not available on X here. Shown from ${source}.`;
  return `Withheld in ${mark.country ? placeName(mark.country, language) : "your country"}. Shown from ${source}.`;
}

export function profileMarkTitle(mark: ProfileMark, language: Language): string {
  const source = SOURCE_NAMES[mark.source];
  if (language === "tr") {
    if (!mark.country) return `Hesap ülkende gizlenmiş. Kaynak: ${source}.`;
    return `Hesabın gizlendiği ülke: ${placeName(mark.country, language)}. Kaynak: ${source}.`;
  }
  return `Account withheld in ${mark.country ? placeName(mark.country, language) : "your country"}. Shown from ${source}.`;
}
