import type { PostAuthor, PostMedia, PostRecord } from "./types";

type Json = Record<string, unknown>;

/**
 * Builds a `Tweet` GraphQL result that X's own client renders like any other post.
 *
 * X currently ships two clients with different schemas: the classic one reads
 * `legacy.*`, the Relay-based one reads `details`, `counts`, `media_entities2` and
 * friends. Both read fields by name and ignore the rest, so one superset object
 * serves both and survives whichever client a given account is on.
 */

const relayId = (type: string, id: string): string => btoa(`${type}:${id}`);

function scaledSize(width: number, height: number, max: number): Json {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { h: Math.round(height * scale), w: Math.round(width * scale), resize: "fit" };
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

function mediaEntity(post: PostRecord, media: PostMedia, index: number): Json {
  const isPhoto = media.type === "photo";
  const expandedUrl = `https://x.com/${post.author.handle}/status/${post.id}/${isPhoto ? "photo" : "video"}/${index + 1}`;
  const keyPrefix = isPhoto ? "3" : media.type === "video" ? "13" : "16";
  const mediaKey = `${keyPrefix}_${media.id}`;
  const end = post.displayRange[1];
  const divisor = greatestCommonDivisor(media.width, media.height) || 1;

  return {
    display_url: media.displayUrl ?? expandedUrl.replace(/^https:\/\//, ""),
    expanded_url: expandedUrl,
    id_str: media.id,
    indices: media.indices ?? [end, end],
    media_key: mediaKey,
    media_url_https: media.url,
    type: media.type,
    url: media.shortUrl ?? expandedUrl,
    ext_media_availability: { status: "Available" },
    ext_playlists: [],
    features: {},
    sizes: {
      large: scaledSize(media.width, media.height, 2048),
      medium: scaledSize(media.width, media.height, 1200),
      small: scaledSize(media.width, media.height, 680),
      thumb: { h: 150, w: 150, resize: "crop" },
    },
    original_info: { height: media.height, width: media.width, focus_rects: [] },
    media_results: { result: { media_key: mediaKey } },
    ...(media.altText ? { ext_alt_text: media.altText } : {}),
    ...(isPhoto
      ? {}
      : {
          additional_media_info: { monetizable: false },
          video_info: {
            aspect_ratio: [media.width / divisor, media.height / divisor],
            duration_millis: media.durationMs ?? 0,
            variants: (media.variants ?? []).map((variant) => ({
              content_type: variant.contentType,
              url: variant.url,
              ...(variant.bitrate === undefined ? {} : { bitrate: variant.bitrate }),
            })),
          },
        }),
  };
}

export function buildUser(author: PostAuthor): Json {
  const websiteEntities = author.website
    ? {
        urls: [
          {
            display_url: author.website.displayUrl,
            expanded_url: author.website.url,
            url: author.website.url,
            indices: [0, author.website.url.length],
          },
        ],
      }
    : undefined;
  return {
    __typename: "User",
    id: relayId("User", author.id),
    rest_id: author.id,
    affiliates_highlighted_label: {},
    identity_profile_labels_highlighted_label: {},
    avatar: { image_url: author.avatarUrl },
    ...(author.bannerUrl ? { banner: { image_url: author.bannerUrl } } : {}),
    business_account: {},
    can_view_expanded_profile: false,
    core: { created_at: author.joinedAt, created_at_ms: author.joinedAtMs, name: author.name, screen_name: author.handle },
    creator_subscriptions_count: 0,
    grok_translated_bio_with_availability: { is_available: false },
    has_hidden_subscriptions_on_profile: false,
    highlights_info: { can_highlight_tweets: false, highlighted_tweets: "0" },
    is_profile_translatable: false,
    legacy_extended_profile: {},
    possibly_sensitive: false,
    profile_metadata: { profile_interstitial_type: "" },
    subscribers_count: 0,
    user_seed_tweet_count: 0,
    dm_permissions: { can_dm: false },
    follow_request_sent: false,
    has_graduated_access: true,
    is_blue_verified: author.blueVerified,
    legacy: {
      blocked_by: false,
      blocking: false,
      can_dm: false,
      can_media_tag: false,
      created_at: author.joinedAt,
      default_profile: false,
      default_profile_image: false,
      description: author.description,
      entities: { description: { urls: [] }, ...(websiteEntities ? { url: websiteEntities } : {}) },
      fast_followers_count: 0,
      favourites_count: author.likes,
      followed_by: false,
      followers_count: author.followers,
      following: false,
      friends_count: author.following,
      has_custom_timelines: false,
      is_translator: false,
      listed_count: 0,
      location: author.location,
      media_count: author.mediaCount,
      muting: false,
      name: author.name,
      normal_followers_count: author.followers,
      notifications: false,
      pinned_tweet_ids_str: [],
      possibly_sensitive: false,
      ...(author.bannerUrl ? { profile_banner_url: author.bannerUrl } : {}),
      profile_image_url_https: author.avatarUrl,
      profile_interstitial_type: "",
      protected: false,
      screen_name: author.handle,
      statuses_count: author.statuses,
      translator_type: "none",
      ...(author.website ? { url: author.website.url } : {}),
      verified: false,
      ...(author.verifiedType ? { verified_type: author.verifiedType } : {}),
      want_retweets: false,
      withheld_in_countries: [],
      withheld_scope: "",
    },
    location: { location: author.location },
    action_counts: { favorites_count: author.likes },
    media_permissions: { can_media_tag: false },
    notifications_settings: { notifications_enabled: false },
    pinned_items: {},
    parody_commentary_fan_label: "None",
    privacy: { protected: false },
    profile_bio: {
      description: author.description,
      entities: { description: {}, ...(websiteEntities ? { url: websiteEntities } : {}) },
      // The classic client merges users into one record and only overwrites fields that are
      // present, so these must be sent empty to clear a flag it has already stored.
      with_held_scope: "",
      withheld_description: "",
      withheld_in_countries: [],
    },
    profile_image_shape: "Circle",
    profile_sort_enabled: true,
    profile_translation: { translator_type: "none", translator_type_enum: "None" },
    relationship_counts: { followers: author.followers, following: author.following },
    relationship_perspectives: {
      blocked_by: false,
      blocking: false,
      followed_by: false,
      following: false,
      live_following: false,
      muting: false,
    },
    super_follow_eligible: false,
    super_followed_by: false,
    super_following: false,
    tipjar_settings: {},
    ...(author.website ? { website: { url: author.website.url } } : {}),
    tweet_counts: { media_tweets: author.mediaCount, tweets: author.statuses },
    verification: {
      is_blue_verified: author.blueVerified,
      verified: false,
      ...(author.verifiedType ? { verified_type: author.verifiedType } : {}),
    },
  };
}

export function buildUserResults(author: PostAuthor): Json {
  return { id: relayId("UserResults", author.id), rest_id: author.id, result: buildUser(author) };
}

export function buildTweetResult(post: PostRecord): Json {
  const media = post.media.map((item, index) => mediaEntity(post, item, index));
  const hashtags = post.hashtags.map(({ text, indices }) => ({ indices, text }));
  const urls = post.urls.map(({ url, expandedUrl, displayUrl, indices }) => ({
    display_url: displayUrl,
    expanded_url: expandedUrl,
    indices,
    url,
  }));
  const mentions = post.mentions.map(({ id, handle, indices }) => ({
    id_str: id,
    indices,
    name: handle,
    screen_name: handle,
  }));
  const conversationId = post.conversationId ?? post.parentId ?? post.id;
  const quote = post.quote;

  return {
    __typename: "Tweet",
    id: relayId("Tweet", post.id),
    rest_id: post.id,
    core: { user_results: buildUserResults(post.author) },
    unmention_data: {},
    edit_control: {
      __typename: "EditControlInitial",
      edit_tweet_ids: [post.id],
      editable_until_msecs: String(post.createdAtMs),
      is_edit_eligible: false,
      edits_remaining: "0",
    },
    // X's translate action looks the post up by ID and would fail on a withheld post.
    is_translatable: false,
    views:
      post.counts.views === undefined
        ? { state: "Enabled" }
        : { count: String(post.counts.views), state: "EnabledWithCount" },
    source: "",
    grok_analysis_button: false,
    legacy: {
      bookmark_count: post.counts.bookmarks,
      bookmarked: false,
      created_at: post.createdAt,
      conversation_id_str: conversationId,
      display_text_range: post.displayRange,
      entities: {
        hashtags,
        symbols: [],
        timestamps: [],
        urls,
        user_mentions: mentions,
        ...(media.length > 0 ? { media } : {}),
      },
      ...(media.length > 0 ? { extended_entities: { media } } : {}),
      favorite_count: post.counts.likes,
      favorited: false,
      full_text: post.text,
      ...(post.parentId
        ? {
            in_reply_to_status_id_str: post.parentId,
            in_reply_to_screen_name: post.parentHandle,
            in_reply_to_user_id_str: post.parentUserId,
          }
        : {}),
      is_quote_status: quote !== undefined,
      lang: post.lang,
      possibly_sensitive: post.possiblySensitive,
      possibly_sensitive_editable: false,
      quote_count: post.counts.quotes,
      reply_count: post.counts.replies,
      retweet_count: post.counts.reposts,
      retweeted: false,
      user_id_str: post.author.id,
      id_str: post.id,
      ...(quote
        ? {
            quoted_status_id_str: quote.id,
            quoted_status_permalink: {
              url: `https://x.com/${quote.author.handle}/status/${quote.id}`,
              expanded: `https://x.com/${quote.author.handle}/status/${quote.id}`,
              display: `x.com/${quote.author.handle}/status/${quote.id}`,
            },
          }
        : {}),
    },
    // Fields below are what the Relay-based client selects.
    cashtag_attachments: [],
    content_disclosure: { ai_generated_disclosure: { can_edit: false, has_ai_generated_media: false } },
    counts: {
      bookmark_count: post.counts.bookmarks,
      favorite_count: post.counts.likes,
      quote_count: post.counts.quotes,
      reply_count: post.counts.replies,
      retweet_count: post.counts.reposts,
    },
    details: {
      cashtag_entities: [],
      created_at_ms: post.createdAtMs,
      display_text_range: post.displayRange,
      full_text: post.text,
      hashtag_entities: hashtags,
      smarttags: [],
    },
    grok_translated_post_with_availability: { is_available: false },
    media_entities2: media,
    mention_entities: post.mentions.map(({ id, handle, indices }) => ({ id_str: id, indices, screen_name: handle })),
    quick_promote_eligibility: { eligibility: "IneligibleUserUnauthorized" },
    url_entities: urls,
    ...(post.parentId
      ? {
          reply_to_results: {
            __typename: "TweetResults",
            id: relayId("TweetResults", post.parentId),
            rest_id: post.parentId,
          },
        }
      : {}),
    ...(post.parentId && post.parentUserId && post.parentHandle
      ? {
          reply_to_user_results: {
            id: relayId("UserResults", post.parentUserId),
            rest_id: post.parentUserId,
            result: {
              __typename: "User",
              core: { screen_name: post.parentHandle },
              id: relayId("User", post.parentUserId),
              rest_id: post.parentUserId,
            },
          },
        }
      : {}),
    // The classic client reads the first name, the Relay client the second.
    ...(quote ? { quoted_status_result: wrapTweetResult(quote), quoted_tweet_results: wrapTweetResult(quote) } : {}),
  };
}

/** The `{ id, rest_id, result }` wrapper both clients expect around a tweet. */
export function wrapTweetResult(post: PostRecord): Json {
  return { id: relayId("TweetResults", post.id), rest_id: post.id, result: buildTweetResult(post) };
}
