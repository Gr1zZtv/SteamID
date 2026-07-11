"use strict";

const form = document.getElementById("lookupForm");
const input = document.getElementById("profileInput");
const clearButton = document.getElementById("clearButton");
const lookupButton = document.getElementById("lookupButton");
const buttonIcon = document.getElementById("buttonIcon");
const buttonText = document.getElementById("buttonText");
const statusBox = document.getElementById("status");
const results = document.getElementById("results");
const profileAvatar = document.getElementById("profileAvatar");
const presenceDot = document.getElementById("presenceDot");
const profileName = document.getElementById("profileName");
const profileState = document.getElementById("profileState");
const profileBadges = document.getElementById("profileBadges");
const openProfileButton = document.getElementById("openProfileButton");
const copyProfileButton = document.getElementById("copyProfileButton");
const steamIdValue = document.getElementById("steamIdValue");
const copyIdButton = document.getElementById("copyIdButton");
const toolGrid = document.getElementById("toolGrid");
const detailGrid = document.getElementById("detailGrid");
const gamesSection = document.getElementById("gamesSection");
const gamesCount = document.getElementById("gamesCount");
const gamesList = document.getElementById("gamesList");
const profileSummary = document.getElementById("profileSummary");
const groupsCount = document.getElementById("groupsCount");
const groupsList = document.getElementById("groupsList");
const rawXml = document.getElementById("rawXml");
const toast = document.getElementById("toast");
const toastText = document.getElementById("toastText");

const STEAM_ID_64_PATTERN = /^\d{17}$/;
const VANITY_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;
const PROXY_ATTEMPT_TIMEOUT_MS = 10000;
const PROXY_HEDGE_DELAY_MS = 1200;
const CORS_PROXIES = [
  {
    name: "AllOrigins",
    makeUrl: target => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
  },
  {
    name: "CorsProxy.io",
    makeUrl: target => `https://corsproxy.io/?url=${encodeURIComponent(target)}`
  },
  {
    name: "CodeTabs",
    makeUrl: target => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`
  }
];

let activeProfileUrl = "";
let activeSteamId64 = "";
let toastTimer = null;

const icons = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>',
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="m9 9 6 6M15 9l-6 6"></path></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"></path></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 2.8 19h18.4L12 3Z"></path><path d="M12 9v4M12 16h.01"></path></svg>'
};

function setStatus(message, type = "info") {
  statusBox.className = `status-box show ${type}`;
  statusBox.innerHTML = `${icons[type] || icons.info}<span></span>`;
  statusBox.querySelector("span").textContent = message;
}

function clearStatus() {
  statusBox.className = "status-box";
  statusBox.replaceChildren();
}

function setLoading(isLoading) {
  lookupButton.disabled = isLoading;
  buttonText.textContent = isLoading ? "Searching…" : "Search Steam";
  buttonIcon.innerHTML = isLoading
    ? '<span class="spinner" aria-hidden="true"></span>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';
}

function updateClearButton() {
  clearButton.classList.toggle("show", input.value.trim().length > 0);
}

function normalizeProfileInput(rawValue) {
  const value = rawValue.trim();

  if (!value) {
    throw new Error("Enter a Steam username, ID, or profile URL.");
  }

  if (STEAM_ID_64_PATTERN.test(value)) {
    return {
      type: "profiles",
      value,
      steamId64: value,
      profileUrl: `https://steamcommunity.com/profiles/${value}/`
    };
  }

  let candidate = value;

  if (candidate.includes("steamcommunity.com") && !/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  if (/^https?:\/\//i.test(candidate)) {
    let url;

    try {
      url = new URL(candidate);
    } catch {
      throw new Error("That does not appear to be a valid URL.");
    }

    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== "steamcommunity.com") {
      throw new Error("Use a profile URL from steamcommunity.com.");
    }

    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(part => decodeURIComponent(part));

    if (parts.length < 2) {
      throw new Error("The Steam profile URL is missing its account identifier.");
    }

    const profileType = parts[0].toLowerCase();
    const identifier = parts[1];

    if (profileType === "profiles" && STEAM_ID_64_PATTERN.test(identifier)) {
      return {
        type: "profiles",
        value: identifier,
        steamId64: identifier,
        profileUrl: `https://steamcommunity.com/profiles/${identifier}/`
      };
    }

    if (profileType === "id" && identifier) {
      return {
        type: "id",
        value: identifier,
        steamId64: "",
        profileUrl: `https://steamcommunity.com/id/${encodeURIComponent(identifier)}/`
      };
    }

    throw new Error("Use a Steam profile URL containing /id/ or /profiles/.");
  }

  if (VANITY_PATTERN.test(value)) {
    return {
      type: "id",
      value,
      steamId64: "",
      profileUrl: `https://steamcommunity.com/id/${encodeURIComponent(value)}/`
    };
  }

  throw new Error("That Steam profile value is not recognized.");
}

function makeXmlUrl(profile) {
  return `https://steamcommunity.com/${profile.type}/${encodeURIComponent(profile.value)}/?xml=1`;
}

function convertSteamId64(steamId64) {
  if (!STEAM_ID_64_PATTERN.test(steamId64)) return null;

  const accountId = BigInt(steamId64) - 76561197960265728n;
  if (accountId < 0n) return null;

  const authenticationServer = accountId % 2n;
  const accountNumber = accountId / 2n;

  return {
    accountId: accountId.toString(),
    steamId2: `STEAM_0:${authenticationServer}:${accountNumber}`,
    steamId3: `[U:1:${accountId}]`,
    profilePath: `/profiles/${steamId64}`
  };
}

async function fetchWithTimeout(url, timeoutMs, controller) {
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Lookup service returned HTTP ${response.status}.`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isSteamXml(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  return !xml.querySelector("parsererror") && Boolean(xml.querySelector("profile, error, privacyMessage"));
}

async function fetchSteamXml(xmlUrl) {
  const controllers = CORS_PROXIES.map(() => new AbortController());
  let complete = false;

  const attempts = CORS_PROXIES.map(async (proxy, index) => {
    if (index > 0) {
      await delay(index * PROXY_HEDGE_DELAY_MS);
    }

    if (complete) {
      throw new DOMException("A faster proxy already responded.", "AbortError");
    }

    const xmlText = await fetchWithTimeout(
      proxy.makeUrl(xmlUrl),
      PROXY_ATTEMPT_TIMEOUT_MS,
      controllers[index]
    );

    if (!isSteamXml(xmlText)) {
      throw new Error(`${proxy.name} returned an invalid response.`);
    }

    return xmlText;
  });

  try {
    const xmlText = await Promise.any(attempts);
    complete = true;
    controllers.forEach(controller => controller.abort());
    return xmlText;
  } catch {
    throw new Error("All lookup services are currently unavailable. Try again shortly.");
  }
}

function directChildText(parent, tagName) {
  const element = Array.from(parent.children).find(child => child.tagName === tagName);
  return element ? element.textContent.trim() : "";
}

function parseProfileXml(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");

  if (xml.querySelector("parsererror")) {
    throw new Error("Steam returned a response that could not be read.");
  }

  const profile = xml.querySelector("profile");
  if (!profile) {
    const message = xml.querySelector("error, privacyMessage")?.textContent.trim();
    throw new Error(message || "Steam did not return a public profile.");
  }

  const data = {
    steamID64: directChildText(profile, "steamID64"),
    steamID: directChildText(profile, "steamID"),
    onlineState: directChildText(profile, "onlineState"),
    stateMessage: directChildText(profile, "stateMessage"),
    privacyState: directChildText(profile, "privacyState"),
    visibilityState: directChildText(profile, "visibilityState"),
    avatarIcon: directChildText(profile, "avatarIcon"),
    avatarMedium: directChildText(profile, "avatarMedium"),
    avatarFull: directChildText(profile, "avatarFull"),
    vacBanned: directChildText(profile, "vacBanned"),
    tradeBanState: directChildText(profile, "tradeBanState"),
    isLimitedAccount: directChildText(profile, "isLimitedAccount"),
    customURL: directChildText(profile, "customURL"),
    memberSince: directChildText(profile, "memberSince"),
    steamRating: directChildText(profile, "steamRating"),
    hoursPlayed2Wk: directChildText(profile, "hoursPlayed2Wk"),
    headline: directChildText(profile, "headline"),
    location: directChildText(profile, "location"),
    realname: directChildText(profile, "realname"),
    summary: directChildText(profile, "summary"),
    games: [],
    groups: []
  };

  profile.querySelectorAll(":scope > mostPlayedGames > mostPlayedGame").forEach(game => {
    data.games.push({
      gameName: directChildText(game, "gameName"),
      gameLink: directChildText(game, "gameLink"),
      gameIcon: directChildText(game, "gameIcon"),
      gameLogo: directChildText(game, "gameLogo"),
      gameLogoSmall: directChildText(game, "gameLogoSmall"),
      hoursPlayed: directChildText(game, "hoursPlayed"),
      hoursOnRecord: directChildText(game, "hoursOnRecord"),
      statsName: directChildText(game, "statsName")
    });
  });

  profile.querySelectorAll(":scope > groups > group").forEach(group => {
    data.groups.push({
      isPrimary: group.getAttribute("isPrimary") === "1",
      groupID64: directChildText(group, "groupID64"),
      groupName: directChildText(group, "groupName"),
      groupURL: directChildText(group, "groupURL"),
      headline: directChildText(group, "headline"),
      summary: directChildText(group, "summary"),
      avatarFull: directChildText(group, "avatarFull"),
      memberCount: directChildText(group, "memberCount"),
      membersOnline: directChildText(group, "membersOnline"),
      membersInGame: directChildText(group, "membersInGame")
    });
  });

  return data;
}

function stripBasicHtml(value) {
  const doc = new DOMParser().parseFromString(value || "", "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function stateLabel(value) {
  const normalized = (value || "").toLowerCase();
  if (normalized === "in-game") return "In game";
  if (normalized === "online") return "Online";
  if (normalized === "offline") return "Offline";
  return value || "Status unavailable";
}

function safeNumber(value) {
  const parsed = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
  const number = safeNumber(value);
  return number === null ? value : new Intl.NumberFormat().format(number);
}

function fallbackAvatar(label = "Steam") {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#17304a"/><stop offset="1" stop-color="#0d1a29"/></linearGradient></defs><rect width="160" height="160" rx="28" fill="url(#g)"/><text x="50%" y="54%" text-anchor="middle" fill="#8db4ce" font-family="Arial" font-size="18">${label.slice(0, 10)}</text></svg>`
  );
}

function addBadge(text, variant = "") {
  if (!text) return;
  const badge = document.createElement("span");
  badge.className = `badge ${variant}`.trim();
  badge.innerHTML = variant === "bad" ? icons.warning : icons.check;
  const label = document.createElement("span");
  label.textContent = text;
  badge.appendChild(label);
  profileBadges.appendChild(badge);
}

function addDetail(label, value) {
  if (!value) return;
  const detail = document.createElement("div");
  detail.className = "detail";

  const detailLabel = document.createElement("div");
  detailLabel.className = "detail-label";
  detailLabel.textContent = label;

  const detailValue = document.createElement("div");
  detailValue.className = "detail-value";
  detailValue.textContent = value;

  detail.append(detailLabel, detailValue);
  detailGrid.appendChild(detail);
}

function renderSummary(html) {
  profileSummary.replaceChildren();
  if (!html) return;

  const source = new DOMParser().parseFromString(html, "text/html").body;
  const fragment = document.createDocumentFragment();

  function appendNodes(node, target) {
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(child.textContent));
        return;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = child.tagName.toLowerCase();

      if (tag === "br") {
        target.appendChild(document.createElement("br"));
        return;
      }

      if (tag === "a") {
        const link = document.createElement("a");
        let href = child.getAttribute("href") || "";

        try {
          const parsed = new URL(href, "https://steamcommunity.com");
          if (parsed.hostname === "steamcommunity.com" && parsed.pathname === "/linkfilter/") {
            const destination = parsed.searchParams.get("url") || parsed.searchParams.get("u");
            if (destination) href = destination;
          }
          const safe = new URL(href, "https://steamcommunity.com");
          if (safe.protocol === "http:" || safe.protocol === "https:") {
            link.href = safe.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer nofollow";
          }
        } catch {
          link.removeAttribute("href");
        }

        appendNodes(child, link);
        target.appendChild(link);
        return;
      }

      appendNodes(child, target);
    });
  }

  appendNodes(source, fragment);
  profileSummary.appendChild(fragment);
}

function renderGames(games) {
  gamesList.replaceChildren();
  const usefulGames = games.filter(game => game.gameName);
  gamesSection.hidden = usefulGames.length === 0;
  gamesCount.textContent = usefulGames.length ? `${usefulGames.length} shown` : "";

  usefulGames.forEach(game => {
    const card = document.createElement("article");
    card.className = "game-card";

    const image = document.createElement("img");
    image.className = "game-image";
    image.src = game.gameLogoSmall || game.gameLogo || game.gameIcon || fallbackAvatar("Game");
    image.alt = "";
    image.loading = "lazy";

    const content = document.createElement("div");
    const name = document.createElement("h3");
    name.className = "game-name";
    name.textContent = game.gameName;

    const meta = document.createElement("div");
    meta.className = "game-meta";

    if (game.hoursPlayed) {
      const recent = document.createElement("span");
      recent.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>';
      recent.append(document.createTextNode(`${game.hoursPlayed} hours recently`));
      meta.appendChild(recent);
    }

    if (game.hoursOnRecord) {
      const total = document.createElement("span");
      total.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 19h16M6 16V8M12 16V5M18 16v-5"></path></svg>';
      total.append(document.createTextNode(`${game.hoursOnRecord} hours total`));
      meta.appendChild(total);
    }

    content.append(name, meta);
    card.append(image, content);
    gamesList.appendChild(card);
  });
}

function renderGroups(groups) {
  groupsList.replaceChildren();
  const namedGroups = groups
    .filter(group => group.groupName)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .slice(0, 8);

  const hiddenCount = Math.max(0, groups.length - namedGroups.length);
  groupsCount.textContent = namedGroups.length
    ? `${namedGroups.length}${hiddenCount ? ` of ${groups.length}` : ""}`
    : "None shown";

  if (!namedGroups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = groups.length
      ? "Steam returned group IDs but no public group details."
      : "No public groups were returned for this profile.";
    groupsList.appendChild(empty);
    return;
  }

  namedGroups.forEach(group => {
    const item = document.createElement("article");
    item.className = "group-item";

    const image = document.createElement("img");
    image.className = "group-avatar";
    image.src = group.avatarFull || fallbackAvatar("Group");
    image.alt = "";
    image.loading = "lazy";

    const info = document.createElement("div");
    info.className = "group-info";

    const name = document.createElement("div");
    name.className = "group-name";
    name.textContent = group.groupName;

    const meta = document.createElement("div");
    meta.className = "group-meta";
    const metaParts = [];
    if (group.memberCount) metaParts.push(`${formatNumber(group.memberCount)} members`);
    if (group.membersOnline) metaParts.push(`${formatNumber(group.membersOnline)} online`);
    if (!metaParts.length && group.headline) metaParts.push(stripBasicHtml(group.headline));
    meta.textContent = metaParts.join(" • ") || group.groupID64;

    info.append(name, meta);
    item.append(image, info);

    if (group.isPrimary) {
      const tag = document.createElement("span");
      tag.className = "primary-tag";
      tag.textContent = "Primary";
      item.appendChild(tag);
    }

    groupsList.appendChild(item);
  });

  if (hiddenCount > 0) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = `${hiddenCount} group ${hiddenCount === 1 ? "entry was" : "entries were"} hidden because Steam returned no public name or details.`;
    groupsList.appendChild(note);
  }
}

function renderToolLinks(steamId64) {
  toolGrid.replaceChildren();

  if (!steamId64) return;

  const encodedId = encodeURIComponent(steamId64);
  const tools = [
    {
      name: "Steam profile",
      mark: "S",
      description: "Main community profile",
      url: `https://steamcommunity.com/profiles/${encodedId}/`
    },
    {
      name: "CS2 inventory",
      mark: "C2",
      description: "Open the player's Steam CS2 items",
      url: `https://steamcommunity.com/profiles/${encodedId}/inventory/#730`
    },
    {
      name: "SteamDB",
      mark: "DB",
      description: "Account value and Steam statistics",
      url: `https://steamdb.info/calculator/${encodedId}/`
    },
    {
      name: "Leetify",
      mark: "L",
      description: "CS2 performance analytics",
      url: `https://leetify.com/app/profile/${encodedId}`
    },
    {
      name: "CSStats",
      mark: "CS",
      description: "Competitive matches and player stats",
      url: `https://csstats.gg/player/${encodedId}`
    },
    {
      name: "CSGO Exchange",
      mark: "EX",
      description: "Inventory and historical item records",
      url: `https://csgo.exchange/profiles/${encodedId}`
    },
    {
      name: "SteamID.io",
      mark: "ID",
      description: "Convert to SteamID2 and SteamID3",
      url: `https://steamid.io/lookup/${encodedId}`
    },
    {
      name: "SteamRep",
      mark: "SR",
      description: "Community reputation profile",
      url: `https://steamrep.com/profiles/${encodedId}`
    },
    {
      name: "FACEIT Finder",
      mark: "F",
      description: "ID copied — paste to find FACEIT",
      url: "https://faceitfinder.com/",
      copyFirst: true
    },
    {
      name: "CSFloat FloatDB",
      mark: "CF",
      description: "ID copied — paste into owner search",
      url: "https://csfloat.com/db",
      copyFirst: true
    }
  ];

  const arrowSvg = '<svg class="tool-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 5h5v5"></path><path d="m10 14 9-9"></path><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path></svg>';

  tools.forEach(tool => {
    const link = document.createElement("a");
    link.className = `tool-link${tool.copyFirst ? " tool-copy" : ""}`;
    link.href = tool.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${tool.name}: ${tool.description}`);

    const logo = document.createElement("span");
    logo.className = "tool-logo";
    logo.textContent = tool.mark;

    const info = document.createElement("span");
    info.className = "tool-info";

    const nameRow = document.createElement("span");
    nameRow.className = "tool-name-row";

    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = tool.name;

    const mode = document.createElement("span");
    mode.className = "tool-mode";
    mode.textContent = tool.copyFirst ? "Copy + open" : "Direct";

    const description = document.createElement("span");
    description.className = "tool-description";
    description.textContent = tool.description;

    nameRow.append(name, mode);
    info.append(nameRow, description);
    link.append(logo, info);
    link.insertAdjacentHTML("beforeend", arrowSvg);

    if (tool.copyFirst) {
      link.addEventListener("click", () => {
        copyText(steamId64, `Steam ID copied for ${tool.name}`);
      });
    }

    toolGrid.appendChild(link);
  });
}

function renderProfile(data, submittedProfile, xmlText) {
  const resolvedId = data.steamID64 || submittedProfile.steamId64;
  const resolvedUrl = resolvedId
    ? `https://steamcommunity.com/profiles/${resolvedId}/`
    : submittedProfile.profileUrl;

  activeSteamId64 = resolvedId;
  activeProfileUrl = resolvedUrl;

  profileAvatar.src = data.avatarFull || data.avatarMedium || data.avatarIcon || fallbackAvatar(data.steamID || "Steam");
  profileAvatar.alt = data.steamID ? `${data.steamID} Steam avatar` : "Steam profile avatar";
  profileName.textContent = data.steamID || resolvedId || submittedProfile.value;

  const cleanStateMessage = stripBasicHtml(data.stateMessage);
  profileState.textContent = cleanStateMessage || stateLabel(data.onlineState);

  const stateClass = (data.onlineState || "").toLowerCase();
  presenceDot.className = "presence-dot";
  if (stateClass === "online") presenceDot.classList.add("online");
  if (stateClass === "in-game") presenceDot.classList.add("in-game");
  presenceDot.title = stateLabel(data.onlineState);

  profileBadges.replaceChildren();
  addBadge(data.privacyState === "public" ? "Public profile" : data.privacyState || "Privacy unknown", data.privacyState === "public" ? "good" : "");
  addBadge(data.vacBanned === "1" ? "VAC banned" : data.vacBanned === "0" ? "No VAC ban shown" : "", data.vacBanned === "1" ? "bad" : "good");
  addBadge(
    data.tradeBanState && data.tradeBanState !== "None" ? `Trade ban: ${data.tradeBanState}` : data.tradeBanState === "None" ? "No trade ban shown" : "",
    data.tradeBanState && data.tradeBanState !== "None" ? "bad" : "good"
  );

  openProfileButton.href = resolvedUrl;
  steamIdValue.textContent = resolvedId || "Not returned";
  renderToolLinks(resolvedId);

  detailGrid.replaceChildren();
  const convertedIds = convertSteamId64(resolvedId);
  if (convertedIds) {
    addDetail("SteamID2", convertedIds.steamId2);
    addDetail("SteamID3", convertedIds.steamId3);
    addDetail("AccountID", convertedIds.accountId);
    addDetail("Profile path", convertedIds.profilePath);
  }
  addDetail("Custom URL", data.customURL ? `/id/${data.customURL}` : "Not set");
  addDetail("Member since", data.memberSince || "Not public");
  addDetail("Location", data.location || "Not public");
  addDetail("Account type", data.isLimitedAccount === "1" ? "Limited" : data.isLimitedAccount === "0" ? "Not limited" : "Unknown");
  addDetail("Visibility", data.visibilityState || "Unknown");
  addDetail("Real name", data.realname || "Not public");

  renderGames(data.games);
  renderSummary(data.summary);
  renderGroups(data.groups);
  rawXml.textContent = xmlText;

  results.classList.add("show");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyText(value, successMessage) {
  if (!value) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Clipboard unavailable");
    }
    showToast(successMessage);
  } catch {
    setStatus("Your browser blocked clipboard access. Select the value and copy it manually.", "error");
  }
}

function showToast(message) {
  toastText.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function updateQueryParameter(value) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("profile", value);
    history.replaceState(null, "", url);
  } catch {
    // Local file URLs or restrictive browsers may reject history changes.
  }
}

async function runLookup(rawValue) {
  clearStatus();
  results.classList.remove("show");
  setLoading(true);

  try {
    const submittedProfile = normalizeProfileInput(rawValue);
    updateQueryParameter(rawValue.trim());

    if (submittedProfile.steamId64) {
      setStatus(`Steam ID detected. Loading the public profile…`, "info");
    } else {
      setStatus(`Resolving the custom profile “${submittedProfile.value}”…`, "info");
    }

    const xmlUrl = makeXmlUrl(submittedProfile);
    const xmlText = await fetchSteamXml(xmlUrl);
    const data = parseProfileXml(xmlText);

    renderProfile(data, submittedProfile, xmlText);
    setStatus("Steam profile found.", "success");
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "The lookup timed out. Try again in a moment."
      : error instanceof Error
        ? error.message
        : "The Steam profile could not be loaded.";

    setStatus(message, "error");
  } finally {
    setLoading(false);
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  runLookup(input.value);
});

input.addEventListener("input", updateClearButton);

clearButton.addEventListener("click", () => {
  input.value = "";
  updateClearButton();
  input.focus();
});

document.querySelectorAll("[data-example]").forEach(button => {
  button.addEventListener("click", () => {
    input.value = button.dataset.example || "";
    updateClearButton();
    runLookup(input.value);
  });
});

copyIdButton.addEventListener("click", () => copyText(activeSteamId64, "Steam ID copied"));
copyProfileButton.addEventListener("click", () => copyText(activeProfileUrl, "Profile URL copied"));

const initialProfile = new URLSearchParams(window.location.search).get("profile");
if (initialProfile) {
  input.value = initialProfile;
  updateClearButton();
  runLookup(initialProfile);
}
