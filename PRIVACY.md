# Privacy Policy

X Country Withheld Viewer. Last updated: 5 November 2026.

[Türkçe metin aşağıda.](#gizlilik-politikası)

## Summary

The extension asks for your agreement before it does anything. Once you agree, it sends the IDs of withheld posts and accounts to two public services so it can show them on X. The developer runs no server and receives no data.

## What the extension reads

The extension reads the responses X sends to the X page you have open, inside your browser, to find posts and accounts that X has withheld. Until you agree, these responses are left as they are, nothing is sent and nothing is kept.

## What leaves your browser

When X withholds a post or an account on a page you open, the extension sends these to the services below, over HTTPS:

- the post ID
- the account ID and public username
- a page cursor, when it loads more posts of a withheld account or more replies to a withheld post

| Service | Address | When |
| --- | --- | --- |
| FxTwitter | `api.fxtwitter.com` | First |
| x.md | `mdfromx.com` | If FxTwitter has no result. You can turn this off in the popup. |

These services see your IP address, as with any web request, and they can tell which posts and accounts were asked for. Their own privacy terms apply to what they do with it. The extension is not affiliated with them or with X.

The requests carry no X cookies, tokens or referrer. The extension does not use, keep or send your X cookies, login details, private messages or the username of your own account.

## What is kept on your device

| Data | Where | How long |
| --- | --- | --- |
| Recovered posts and accounts, and failed lookups | `chrome.storage.session`, in memory | Up to 30 minutes, and gone when the browser closes |
| Session counters and diagnostics (page paths, X's request names, response shapes, counts) | `chrome.storage.session`, in memory | Until the browser closes |
| Your settings and your answer to the consent question | `chrome.storage.local`, on your device | Until you uninstall the extension |

Diagnostics stay on your device unless you press **Copy diagnostics** and share them yourself. They hold no post text, cookies or request headers.

## What the developer receives

Nothing. There is no server, analytics, advertising or tracking, and no data is sold or shared for any other purpose.

## Your choices

- **Disagree:** The extension stays off. You can change your answer in the popup at any time.
- **Switch off:** With the main switch in the popup off, no service is asked and no diagnostics are kept.
- **Clear:** **Clear recovered posts** in the popup deletes the recovered content and the counters.
- **Remove:** Uninstalling the extension deletes everything it stored.

## Limited Use

The use of information received from Google APIs, including the Chrome extension APIs, and from the web pages the extension works on will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. The data is used only to show withheld posts and accounts on X. It is not used for advertising or for determining credit-worthiness, it is not sold, and no person reads it.

## Children

The extension is a general-audience tool and is not directed at children.

## Changes

Changes to this policy are published in this file, and the extension tells you before any new use of your data starts.

## Contact

Open an issue at <https://github.com/yusufky63/x-country-withheld-viewer/issues>.

---

# Gizlilik Politikası

X Country Withheld Viewer. Son güncelleme: 5 Kasım 2026.

## Özet

Eklenti bir şey yapmadan önce onayını ister. Onay verirsen, gizlenen gönderi ve hesapları X'te gösterebilmek için kimliklerini herkese açık iki servise gönderir. Geliştiricinin sunucusu yoktur ve ona hiçbir veri gelmez.

## Eklentinin okudukları

Eklenti, gizlenen gönderi ve hesapları bulmak için X'in açık X sayfasına gönderdiği yanıtları tarayıcının içinde okur. Onay verene kadar bu yanıtlar olduğu gibi bırakılır, hiçbir şey gönderilmez ve saklanmaz.

## Tarayıcıdan çıkanlar

Açtığın sayfada X bir gönderiyi ya da hesabı gizlediğinde eklenti şunları HTTPS ile aşağıdaki servislere gönderir:

- gönderi kimliği
- hesap kimliği ve herkese açık kullanıcı adı
- gizlenen hesabın diğer gönderileri ya da gizlenen gönderinin diğer yanıtları yüklenirken sayfa imleci

| Servis | Adres | Ne zaman |
| --- | --- | --- |
| FxTwitter | `api.fxtwitter.com` | Önce |
| x.md | `mdfromx.com` | FxTwitter sonuç vermezse. Açılır pencereden kapatabilirsin. |

Bu servisler, her web isteğinde olduğu gibi IP adresini görür ve hangi gönderi ve hesapların istendiğini bilebilir. Bu bilgiyle ne yaptıkları kendi koşullarına bağlıdır. Eklentinin bu servislerle ya da X ile bağlantısı yoktur.

İstekler X çerezi, token ya da yönlendirme bilgisi taşımaz. Eklenti X çerezlerini, oturum bilgilerini, özel mesajlarını ve kendi hesabının kullanıcı adını kullanmaz, saklamaz, göndermez.

## Cihazında tutulanlar

| Veri | Yer | Süre |
| --- | --- | --- |
| Kurtarılan gönderi ve hesaplar, başarısız sorgular | `chrome.storage.session`, bellekte | En fazla 30 dakika, tarayıcı kapanınca silinir |
| Oturum sayaçları ve tanı bilgisi (sayfa yolları, X'in istek adları, yanıt şekilleri, sayılar) | `chrome.storage.session`, bellekte | Tarayıcı kapanana kadar |
| Ayarların ve onay sorusuna verdiğin yanıt | `chrome.storage.local`, cihazında | Eklentiyi kaldırana kadar |

Tanı bilgisi, **Tanı bilgisini kopyala** düğmesine basıp kendin paylaşmadıkça cihazında kalır. Bu bilgide gönderi metni, çerez ya da istek başlığı yoktur.

## Geliştiriciye gelenler

Hiçbir şey. Sunucu, analiz, reklam ya da izleme yoktur. Veriler satılmaz ve başka bir amaçla paylaşılmaz.

## Seçeneklerin

- **Kabul etmemek:** Eklenti kapalı kalır. Yanıtını istediğin zaman açılır pencereden değiştirebilirsin.
- **Kapatmak:** Açılır penceredeki ana anahtar kapalıyken hiçbir servise sorulmaz ve tanı bilgisi tutulmaz.
- **Temizlemek:** Açılır penceredeki **Kurtarılan gönderileri temizle** kurtarılan içeriği ve sayaçları siler.
- **Kaldırmak:** Eklentiyi kaldırmak sakladığı her şeyi siler.

## Sınırlı Kullanım

Chrome eklenti API'leri dahil Google API'lerinden ve eklentinin çalıştığı web sayfalarından alınan bilgilerin kullanımı, Sınırlı Kullanım şartları dahil Chrome Web Mağazası Kullanıcı Verileri Politikası'na uyar. Veriler yalnızca gizlenen gönderi ve hesapları X'te göstermek için kullanılır. Reklam ya da kredi değerlendirmesi için kullanılmaz, satılmaz ve hiç kimse tarafından okunmaz.

## Çocuklar

Eklenti genel kullanıcıya yönelik bir araçtır, çocuklara yönelik değildir.

## Değişiklikler

Bu politikadaki değişiklikler bu dosyada yayımlanır. Verilerinin yeni bir kullanımı başlamadan önce eklenti seni bilgilendirir.

## İletişim

<https://github.com/yusufky63/x-country-withheld-viewer/issues> adresinden sorun aç.
