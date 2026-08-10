/**
 * Detect high-value web destinations from browser tab URL+title
 * and shape capture text for Residence cross-reasoning.
 */

function parseTabContext(raw) {
  const lines = String(raw || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  let title = lines[0];
  let url = lines.find((l) => /^https?:\/\//i.test(l)) || "";
  if (!url && lines.length > 1) url = lines[lines.length - 1];
  return { title, url };
}

function classifyWeb(url, title) {
  const u = (url || "").toLowerCase();
  const t = (title || "").toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be") || t.includes("youtube"))
    return "youtube";
  if (u.includes("mail.google.com") || u.includes("gmail.com")) return "gmail";
  if (u.includes("calendar.google.com")) return "gcal";
  if (u.includes("meet.google.com") || u.includes("zoom.us") || u.includes("teams.microsoft.com"))
    return "meeting";
  if (
    u.includes("amazon.") ||
    u.includes("amzn.") ||
    u.includes("ebay.") ||
    u.includes("etsy.com") ||
    u.includes("walmart.com") ||
    u.includes("target.com") ||
    u.includes("shopify") ||
    t.includes("buy now")
  )
    return "shopping";
  if (
    u.includes("maps.google.") ||
    u.includes("google.com/maps") ||
    u.includes("maps.apple.com") ||
    u.includes("openstreetmap.org")
  )
    return "maps";
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("github.com") || u.includes("gitlab.com") || u.includes("bitbucket.org"))
    return "github";
  if (u.includes("spotify.com") || u.includes("music.apple.com") || u.includes("open.spotify.com"))
    return "music";
  if (u.includes("notion.so") || u.includes("notion.site")) return "notion";
  if (u.includes("chatgpt.com") || u.includes("chat.openai.com") || u.includes("claude.ai"))
    return "ai-chat";
  if (u.includes("linear.app") || u.includes("atlassian.net") || u.includes("asana.com") || u.includes("trello.com"))
    return "work-tracker";
  if (u.includes("web.whatsapp.com") || u.includes("web.telegram.org")) return "messaging-web";
  if (u.includes("uber.com") || u.includes("lyft.com") || u.includes("bolt.eu")) return "rideshare";
  if (u.includes("booking.com") || u.includes("airbnb.") || u.includes("expedia.") || u.includes("kayak."))
    return "travel-book";
  if (u.includes("x.com/") || u.includes("twitter.com") || u.includes("news.ycombinator.com") || u.includes("reddit.com"))
    return "read-later";
  return null;
}

function enrichCapture({ title, url, selection }) {
  const kind = classifyWeb(url, title);
  const sel = (selection || "").trim();
  if (!kind && !sel) {
    return { text: "", source: "browser", kind: null };
  }

  if (kind === "youtube") {
    const body = [
      sel || `Watch this video: ${title || "YouTube"}`,
      url ? `URL: ${url}` : "",
      "Should I block watch time or save watch-later?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "youtube", kind };
  }

  if (kind === "gmail") {
    const body = [
      sel || title || "Gmail thread",
      url ? `Gmail: ${url}` : "",
      sel ? "" : "Looks like email — check for meeting invite / RSVP.",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "gmail", kind };
  }

  if (kind === "gcal") {
    const body = [
      sel || `Google Calendar: ${title || "event"}`,
      url || "",
      "Sync this into Residence Calendar?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "gcal", kind };
  }

  if (kind === "meeting") {
    const body = [
      sel || `Join meeting: ${title || "call"}`,
      url || "",
      "Add this meeting to Calendar?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "meeting-link", kind };
  }

  if (kind === "shopping") {
    const body = [
      sel || `Shopping: ${title || "product"}`,
      url || "",
      "Check budget / allergy before buying? Save to shopping list?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "shopping", kind };
  }

  if (kind === "maps") {
    const body = [
      sel || `Place: ${title || "location"}`,
      url || "",
      "Save this place for later / dinner / trip?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "maps", kind };
  }

  if (kind === "linkedin") {
    const body = [
      sel || `LinkedIn: ${title || "profile / message"}`,
      url || "",
      "Schedule a follow-up or save a networking note?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "linkedin", kind };
  }

  if (kind === "github") {
    const body = [
      sel || `Code thread: ${title || "PR / issue"}`,
      url || "",
      "Remind me to review this later?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "github", kind };
  }

  if (kind === "music") {
    const body = [
      sel || `Music: ${title || "track"}`,
      url || "",
      "Save for focus later or add a listen reminder?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "music", kind };
  }

  if (kind === "notion") {
    const body = [
      sel || `Notion: ${title || "page"}`,
      url || "",
      "Capture this into Residence Notes / Commitment?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "notion", kind };
  }

  if (kind === "ai-chat") {
    const body = [
      sel || `AI chat: ${title || "conversation"}`,
      url || "",
      "Save commitments or health notes from this chat?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "ai-chat", kind };
  }

  if (kind === "work-tracker") {
    const body = [
      sel || `Task: ${title || "ticket"}`,
      url || "",
      "Block focus time or remind me before the deadline?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "work-tracker", kind };
  }

  if (kind === "messaging-web") {
    const body = [
      sel || title || "Message thread",
      url || "",
      "Turn this into a Calendar commitment or reminder?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "messaging-web", kind };
  }

  if (kind === "rideshare") {
    const body = [
      sel || `Ride: ${title || "trip"}`,
      url || "",
      "Does this ride conflict with a Calendar commitment?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "rideshare", kind };
  }

  if (kind === "travel-book") {
    const body = [
      sel || `Travel booking: ${title || "trip"}`,
      url || "",
      "Check budget and add trip Commitment?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "travel-book", kind };
  }

  if (kind === "read-later") {
    const body = [
      sel || `Read later: ${title || "article"}`,
      url || "",
      "Save a read-later reminder when the day is free?",
    ]
      .filter(Boolean)
      .join("\n");
    return { text: body, source: "read-later", kind };
  }

  const body = [sel || title, url].filter(Boolean).join("\n");
  return { text: body, source: "browser", kind: null };
}

module.exports = { parseTabContext, classifyWeb, enrichCapture };
