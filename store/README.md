# Chrome Web Store başvurusu

Geliştirici panelindeki alanlara yapıştırılacak metinler. Görseller `store/assets` klasöründedir ve `pnpm store:assets` ile yeniden üretilir. Yüklenecek paket `pnpm package` ile repo kökünde oluşur.

## Mağaza kaydı

| Alan | Değer |
| --- | --- |
| Ad ve özet | Paketteki `_locales` dosyalarından gelir |
| Varsayılan dil | Türkçe, ek dil İngilizce |
| Kategori | Social Networking |
| Ana sayfa | `https://github.com/yusufky63/x-country-withheld-viewer` |
| Destek | `https://github.com/yusufky63/x-country-withheld-viewer/issues` |
| Yetişkin içeriği | Hayır, eklentinin kendi içeriği yok |
| Ekran görüntüleri, Türkçe | `store/assets/tr-1.png` ... `tr-4.png` |
| Ekran görüntüleri, İngilizce | `store/assets/en-1.png` ... `en-4.png` |
| Küçük tanıtım görseli | `store/assets/promo-440x280.png` |

### Açıklama, Türkçe

```text
X'te ülke bazlı gizlenen herkese açık gönderileri ve hesapları, X'in kendi arayüzünde normal bir gönderi gibi gösterir.

X bir gönderiyi ya da hesabı yasal bir talep nedeniyle bir ülkede gizlediğinde, o ülkeden bakanlar içerik yerine bir uyarı görür. Bu eklenti aynı içeriği herkese açık iki servisten alır ve uyarının olduğu yere koyar. Gönderiyi X kendi bileşenleriyle çizer, ayrı kart ya da pencere açılmaz.

Ne yapar
- Gizlenen gönderi, yanıt ve alıntıları olduğu yerde gösterir.
- Gizlenen hesapların profilini ve gönderilerini gösterir.
- Oturum açmadan bakarken X'in boş döndürdüğü gönderiler için de servislere sorar, çünkü X oturumsuz sayfada gizlenen gönderiyi böyle gönderir.
- Kurtarılan gönderinin kenarını hafifçe parlatır, yanına küçük bir göz koyar. Gözün üzerine gelince ülke ve kaynak yazar. Kenarlık kapatılabilir.
- Türkçe ve İngilizce kullanılabilir.

Neyi göstermez
- Korumalı hesapların gönderilerini, bir servis döndürse bile.
- Silinmiş gönderileri.
- Servislerde bulunmayan gönderileri. Bu durumda X'in uyarısı kalır, altına nedeni yazılır.

Verilerin
İlk açılışta eklenti ne yaptığını anlatır ve onayını ister. Onay verene kadar hiçbir şey göndermez. Onay verirsen, gizlenen gönderi ve hesapların kimliklerini ve kullanıcı adlarını FxTwitter ve x.md servislerine gönderir. Bu servisler IP adresini de görür. X çerezlerin, oturum bilgilerin ve mesajların gönderilmez. Geliştiricinin sunucusu yoktur, ona hiçbir veri gelmez. Reklam ve izleme yoktur.

Bilmen gerekenler
- Gizleme kararları ilgili ülkedeki yasal taleplere dayanır. Kullanmadan önce sana uygulanan kuralları kontrol et, sorumluluk kullanıcıya aittir.
- Eklentinin X, FxTwitter ya da x.md ile bağlantısı yoktur, onlar tarafından onaylanmamıştır.
- Beğeni ve yeniden paylaşım gibi işlemleri X gizlenen gönderide reddedebilir.

Kaynak kodu açıktır (MIT): https://github.com/yusufky63/x-country-withheld-viewer
```

### Açıklama, İngilizce

```text
Shows public posts and accounts that X withholds by country inside X's own interface, like any other post.

When X withholds a post or an account in a country because of a legal demand, people viewing from that country see a notice instead. This extension gets the same content from two public services and puts it where the notice was. X draws the post with its own components, so no separate card or window opens.

What it does
- Shows withheld posts, replies and quotes where they belong.
- Shows the profiles and posts of withheld accounts.
- Also asks the services about posts X returns empty when you are signed out, because that is how X sends a withheld post to a signed-out page.
- Adds a soft glow to a recovered post and a small eye next to it. Hovering over the eye shows the country and the source. The glow can be turned off.
- Works in Turkish and English. The interface starts in Turkish, and you can switch to English in the popup.

What it does not show
- Posts of protected accounts, even if a service returns them.
- Deleted posts.
- Posts the services do not have. X's notice stays, with the reason below it.

Your data
On first run the extension explains what it does and asks for your agreement. Until you agree, it sends nothing. If you agree, it sends the IDs and usernames of withheld posts and accounts to the FxTwitter and x.md services, which also see your IP address. Your X cookies, login details and messages are not sent. The developer runs no server and receives no data. There are no ads and no tracking.

Good to know
- Withholding decisions rest on legal demands in the country concerned. Check the rules that apply to you before using this, as the responsibility is yours.
- The extension is not affiliated with or endorsed by X, FxTwitter or x.md.
- X may refuse actions such as likes and reposts on a withheld post.

Open source (MIT): https://github.com/yusufky63/x-country-withheld-viewer
```

## Gizlilik sekmesi

### Tek amaç

```text
Shows posts and accounts that X withholds by country in place on X, using public third-party services, with a small marker on each recovered item.
```

### İzin gerekçeleri

`storage`

```text
Keeps the user's settings and their answer to the consent question in local storage. Keeps recovered posts, session counters and diagnostics in session storage, which stays in memory and is cleared when the browser closes.
```

Sunucu izinleri (`api.fxtwitter.com`, `mdfromx.com`, `x.com`, `twitter.com`, `mobile.x.com`, `mobile.twitter.com`)

```text
api.fxtwitter.com is the primary source of withheld posts and accounts. mdfromx.com (x.md) is the fallback, which the user can turn off. The service worker sends these hosts post IDs, account IDs and public usernames, without cookies or referrer, and gets JSON back.

x.com, twitter.com and their mobile hosts are the only pages the content scripts run on. bridge.js runs in the page's main world and wraps fetch and XMLHttpRequest, because X keeps its API responses inside the page and draws them with its own code, so a withheld item must be filled in before that code reads the response. content.js adds the small marker and relays requests to the service worker. Responses with nothing withheld pass through unchanged.
```

### Uzak kod

`Hayır, uzak kod kullanmıyorum` seçeneği. Gerekçe alanı açılırsa:

```text
All code ships in the package. The two services return JSON data only, which is validated and never executed. No HTML from them is added to the page.
```

### Veri kullanımı

İşaretlenecekler:

| Kategori | Neden |
| --- | --- |
| Web geçmişi | Açılan sayfadaki gizlenen gönderilerin kimlikleri ve kullanıcı adları servislere gider. Sayfa yolları tanı bilgisinde durur. |
| Kullanıcı etkinliği | X sayfasının ağ yanıtları okunur. |
| Web sitesi içeriği | X'in yanıtları okunur, kurtarılan metin bellekte tutulur. |
| Konum | Servisler IP adresini görür, gizlilik politikası da bunu söyler. |

Üç onay kutusunun üçü de işaretlenir: veriler onaylı kullanım dışında satılmaz ya da aktarılmaz, tek amaç dışında kullanılmaz, kredi değerlendirmesi için kullanılmaz.

### Gizlilik politikası adresi

```text
https://github.com/yusufky63/x-country-withheld-viewer/blob/main/PRIVACY.md
```

## Dağıtım

Ücretsiz ve herkese açık. Bölgeleri panelde sen seçersin.

## Test talimatları

```text
The extension acts only when X withholds content for the viewer's country. From most review locations X shows such posts normally, so the extension correctly does nothing there and its counters stay at 0.

To see it work:
1. Install it and press "I agree, turn it on" in the tab that opens. The Language control on that tab switches it to English.
2. Connect from a country where X withholds content, such as Turkey, and reload x.com.
3. Open a post or account that X reports as withheld in that country. X's notice is replaced by the post, with a soft glow and a small eye next to its timestamp.

To test without such a connection, the repository has a browser test that loads this build into Chromium against a stand-in for x.com and calls FxTwitter for real: https://github.com/yusufky63/x-country-withheld-viewer (pnpm install, pnpm test:e2e).

No account or login is needed by the extension. Readable source for the minified files is in the same repository, under src/.
```
