// Custom title bar with browser-style tabs for the Pake-built YouTube app.
// The active tab is always the page on screen. Middle-click a video to open it
// in a new tab; click a tab to switch (it resumes where you left off);
// middle-click it or press its x to close it; + opens Home in a new tab.
// Tabs persist across restarts (Pake reopens the last page, i.e. the active tab).
// Replaces the native Windows title bar (build with --hide-window-decorations).
// Injected by Pake inside a DOMContentLoaded handler.
(function () {
  if (window.__PAKE_TABS__) return;
  window.__PAKE_TABS__ = true;

  const tauri = window.__TAURI__;
  if (!tauri || !tauri.window) return;
  const appWindow = tauri.window.getCurrentWindow();
  window.__PAKE_CUSTOM_TITLEBAR__ = true;

  const BAR_HEIGHT = 34;
  const STORE_KEY = "pake-tabs-v2";
  const OLD_STORE_KEY = "pake-video-tabs"; // saved-videos list from v1, migrated
  const MAX_TABS = 40;

  appWindow.setDecorations(false).catch(() => {});
  appWindow.setShadow(true).catch(() => {});

  const css = `
    #pake-top-dom { display: none !important; }

    #pake-titlebar {
      --tb-bg: #f9f9f9;
      --tb-fg: #0f0f0f;
      --tb-muted: rgba(0,0,0,.6);
      --tb-hover: rgba(0,0,0,.07);
      --tb-tab: rgba(0,0,0,.05);
      --tb-tab-active: rgba(0,0,0,.13);
      --tb-flash: rgba(255,0,0,.35);
      position: fixed;
      top: 0;
      left: 0;
      /* 100vw also covers the page scrollbar, so the buttons reach the corner. */
      width: 100vw;
      height: ${BAR_HEIGHT}px;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      background: var(--tb-bg);
      color: var(--tb-fg);
      font: 12px/1 "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif;
      user-select: none;
      -webkit-user-select: none;
    }
    html[dark] #pake-titlebar {
      --tb-bg: #0f0f0f;
      --tb-fg: #f1f1f1;
      --tb-muted: rgba(255,255,255,.65);
      --tb-hover: rgba(255,255,255,.1);
      --tb-tab: rgba(255,255,255,.06);
      --tb-tab-active: rgba(255,255,255,.17);
    }
    html.pake-mini #pake-titlebar,
    html.pake-tb-fullscreen #pake-titlebar { display: none !important; }

    /* Google sign-in pages (the only non-YouTube pages the app shows): keep the
       window controls, drop the tabs, and push the page below the bar. */
    html.pake-tb-foreign body { margin-top: ${BAR_HEIGHT}px !important; }
    html.pake-tb-foreign #pake-tabs,
    html.pake-tb-foreign .pake-tb-newtab { display: none !important; }
    /* Google's pages follow the system theme, so the bar does too there. */
    @media (prefers-color-scheme: dark) {
      html.pake-tb-foreign #pake-titlebar {
        --tb-bg: #1f1f1f;
        --tb-fg: #e3e3e3;
        --tb-muted: rgba(255,255,255,.65);
        --tb-hover: rgba(255,255,255,.1);
      }
    }

    /* Push YouTube's fixed header and page content below the bar. */
    html.pake-tb:not(.pake-mini):not(.pake-tb-fullscreen) #masthead-container {
      top: ${BAR_HEIGHT}px !important;
    }
    html.pake-tb:not(.pake-mini):not(.pake-tb-fullscreen) ytd-app #page-manager {
      margin-top: calc(var(--ytd-masthead-height, 56px) + ${BAR_HEIGHT}px) !important;
    }
    html.pake-tb:not(.pake-mini):not(.pake-tb-fullscreen) tp-yt-app-drawer#guide #contentContainer,
    html.pake-tb:not(.pake-mini):not(.pake-tb-fullscreen) ytd-mini-guide-renderer {
      margin-top: ${BAR_HEIGHT}px !important;
    }

    .pake-tb-logo {
      flex: none;
      width: 40px;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #pake-tabs {
      flex: 0 1 auto;
      min-width: 0;
      overflow-y: hidden;
      height: 100%;
      display: flex;
      align-items: center;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    #pake-tabs::-webkit-scrollbar { display: none; }
    .pake-tb-drag {
      flex: 1 1 0;
      min-width: 48px;
      height: 100%;
    }
    /* Tabs shrink to fit like a browser's, so every tab (the first one
       included) stays visible; the strip only scrolls past the minimum. */
    .pake-tab {
      flex: 0 1 196px;
      min-width: 76px;
      height: 26px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 3px 0 4px;
      border-radius: 6px;
      background: var(--tb-tab);
      transition: background .12s;
    }
    .pake-tab:hover { background: var(--tb-hover); }
    .pake-tab.active { background: var(--tb-tab-active); }
    .pake-tab.flash { animation: pake-tab-flash .9s ease-out; }
    @keyframes pake-tab-flash {
      from { background: var(--tb-flash); }
    }
    .pake-tab img {
      flex: none;
      width: 32px;
      height: 18px;
      object-fit: cover;
      border-radius: 3px;
      background: #000;
    }
    .pake-tab-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      line-height: 16px;
    }
    .pake-tab-close {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--tb-muted);
      font: 9px/1 "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
    }
    .pake-tab-close:hover { background: var(--tb-hover); color: var(--tb-fg); }
    .pake-tab img.page { object-fit: contain; background: transparent; }
    .pake-tb-newtab {
      flex: none;
      width: 28px;
      height: 26px;
      margin-left: 4px;
      border: 0;
      border-radius: 6px;
      padding: 0;
      background: transparent;
      color: var(--tb-fg);
      font: 10px/1 "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
    }
    .pake-tb-newtab:hover { background: var(--tb-hover); }
    .pake-tb-update {
      flex: none;
      height: 24px;
      margin: 0 6px;
      padding: 0 10px;
      border: 0;
      border-radius: 12px;
      background: #3ea6ff;
      color: #0f0f0f;
      font: 600 12px/1 "Segoe UI Variable Text", "Segoe UI", sans-serif;
      white-space: nowrap;
      cursor: pointer;
    }
    .pake-tb-update[hidden] { display: none; }
    .pake-tb-update:hover { background: #65b8ff; }

    /* Right-click menu on the tab area, matching the other app menus. */
    #pake-tab-menu {
      display: none;
      position: fixed;
      z-index: 2147483647;
      min-width: 170px;
      padding: 4px;
      box-sizing: border-box;
      background: #2c2c2c;
      border: 1px solid #464646;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.45);
      font: 13px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      color: #fff;
      user-select: none;
      cursor: default;
    }
    #pake-tab-menu.open { display: block; }
    .pake-tm-item {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 30px;
      padding: 0 14px 0 10px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .pake-tm-item:hover { background: #3b3b3b; }
    .pake-tm-icon {
      width: 16px;
      text-align: center;
      font: 12px/1 "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
    }
    .pake-tm-sep { height: 1px; margin: 4px 2px; background: #464646; }

    .pake-tb-controls {
      flex: none;
      display: flex;
      height: 100%;
    }
    .pake-tb-controls button {
      width: 46px;
      height: 100%;
      border: 0;
      padding: 0;
      background: transparent;
      color: var(--tb-fg);
      font: 10px/1 "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
    }
    .pake-tb-controls button:hover { background: var(--tb-hover); }
    .pake-tb-controls button.close:hover,
    .pake-tb-controls button.close.corner-hover { background: #c42b1c; color: #fff; }
  `;
  const style = document.createElement("style");
  style.id = "pake-tabs-style";
  style.textContent = css;
  document.head.appendChild(style);
  document.documentElement.classList.add("pake-tb");

  // --- DOM (YouTube enforces Trusted Types, so no innerHTML) ---
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const bar = el("div");
  bar.id = "pake-titlebar";

  const logo = el("div", "pake-tb-logo");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 28 20");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "14");
  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("fill", "#ff0033");
  body.setAttribute(
    "d",
    "M27.4 3.1A3.5 3.5 0 0 0 25 .6C22.8 0 14 0 14 0S5.2 0 3 .6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9A3.5 3.5 0 0 0 3 19.4c2.2.6 11 .6 11 .6s8.8 0 11-.6a3.5 3.5 0 0 0 2.4-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9z",
  );
  const play = document.createElementNS(SVG_NS, "path");
  play.setAttribute("fill", "#fff");
  play.setAttribute("d", "M11.2 14.3 18.5 10l-7.3-4.3z");
  svg.append(body, play);
  logo.appendChild(svg);

  const tabStrip = el("div");
  tabStrip.id = "pake-tabs";
  const newTabBtn = el("button", "pake-tb-newtab", ""); // +
  newTabBtn.title = "New tab";
  const drag = el("div", "pake-tb-drag");

  const controls = el("div", "pake-tb-controls");
  const minBtn = el("button", "min", "");
  minBtn.title = "Minimise";
  const maxBtn = el("button", "max", "");
  maxBtn.title = "Maximise";
  const closeBtn = el("button", "close", "");
  closeBtn.title = "Close";
  controls.append(minBtn, maxBtn, closeBtn);

  bar.append(logo, tabStrip, newTabBtn, drag, controls);
  document.body.appendChild(bar);

  // --- Window controls and dragging ---
  minBtn.addEventListener("click", () => appWindow.minimize().catch(() => {}));
  maxBtn.addEventListener("click", () => appWindow.toggleMaximize().catch(() => {}));
  closeBtn.addEventListener("click", () => appWindow.close().catch(() => {}));

  async function updateMaxButton() {
    const maximized = await appWindow.isMaximized().catch(() => false);
    maxBtn.textContent = maximized ? "" : "";
    maxBtn.title = maximized ? "Restore Down" : "Maximise";
  }
  window.addEventListener("resize", updateMaxButton);
  updateMaxButton();

  // The page scrollbar sits under the right edge of the close button and
  // swallows clicks there; treat that strip as part of the close button so
  // flinging the mouse into the top-right corner still closes.
  function inCornerStrip(e) {
    const root = document.documentElement;
    return (
      root.classList.contains("pake-tb") &&
      !root.classList.contains("pake-mini") &&
      !root.classList.contains("pake-tb-fullscreen") &&
      e.clientY < BAR_HEIGHT &&
      e.clientX >= root.clientWidth
    );
  }
  let cornerPressed = false;
  window.addEventListener(
    "mousedown",
    (e) => {
      cornerPressed = e.button === 0 && inCornerStrip(e);
      if (cornerPressed) e.preventDefault();
    },
    true,
  );
  window.addEventListener(
    "mouseup",
    (e) => {
      if (cornerPressed && e.button === 0 && inCornerStrip(e)) {
        appWindow.close().catch(() => {});
      }
      cornerPressed = false;
    },
    true,
  );
  window.addEventListener(
    "mousemove",
    (e) => closeBtn.classList.toggle("corner-hover", inCornerStrip(e)),
    true,
  );
  document.documentElement.addEventListener("mouseleave", () =>
    closeBtn.classList.remove("corner-hover"),
  );

  // Empty bar space (logo, gaps, spacer) drags the window like a title bar.
  bar.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target.closest(".pake-tab, button")) return;
    e.preventDefault();
    if (e.detail === 2) appWindow.toggleMaximize().catch(() => {});
    else appWindow.startDragging().catch(() => {});
  });

  // Scroll the tab strip sideways with the mouse wheel.
  tabStrip.addEventListener(
    "wheel",
    (e) => {
      if (tabStrip.scrollWidth <= tabStrip.clientWidth) return;
      e.preventDefault();
      tabStrip.scrollLeft += e.deltaY || e.deltaX;
    },
    { passive: false },
  );

  // YouTube's own fullscreen covers the whole window; get out of its way.
  document.addEventListener("fullscreenchange", () => {
    document.documentElement.classList.toggle(
      "pake-tb-fullscreen",
      !!document.fullscreenElement,
    );
  });

  // Off YouTube (Google sign-in) there are no tabs: just the bar and controls.
  if (!/^((www|m)\.)?youtube\.com$/i.test(location.hostname)) {
    document.documentElement.classList.add("pake-tb-foreign");
    return;
  }

  // --- Tabs ---
  // Browser-style: every tab is a page, and the active tab always mirrors the
  // page on screen (it follows navigation). Others keep their page, plus the
  // playback position for videos, until you switch back to them.
  let tabs = []; // { key, url, title, vid, t }
  let activeKey = null;
  let keySeq = 0;
  let pendingNav = null; // { key, until } while switching to another tab

  function newKey() {
    keySeq += 1;
    return `t${Date.now().toString(36)}${keySeq.toString(36)}`;
  }

  function loadTabs() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (stored && Array.isArray(stored.tabs)) {
        tabs = stored.tabs.filter(
          (t) => t && typeof t.key === "string" && typeof t.url === "string" && t.url.startsWith("/"),
        );
        activeKey = stored.active;
        return;
      }
      const old = JSON.parse(localStorage.getItem(OLD_STORE_KEY) || "[]");
      if (Array.isArray(old)) {
        tabs = old
          .filter((t) => t && /^[\w-]{11}$/.test(t.id))
          .map((t) => ({ key: newKey(), url: `/watch?v=${t.id}`, vid: t.id, title: t.title || "" }));
      }
    } catch (error) {}
  }

  function saveTabs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ tabs, active: activeKey }));
    } catch (error) {}
  }

  function activeTab() {
    return tabs.find((t) => t.key === activeKey) || null;
  }

  // What the page on screen is right now.
  function pageInfo() {
    const url = location.pathname + location.search;
    const vid = videoIdFrom(location.href);
    let title = "";
    const player = document.querySelector("#movie_player");
    const data = vid && player && player.getVideoData ? player.getVideoData() : null;
    if (data && data.video_id === vid && data.title) title = data.title;
    if (!title) {
      title = document.title
        .replace(/^\(\d+\)\s*/, "")
        .replace(/\s*-\s*YouTube$/, "")
        .trim();
    }
    if (!title || title === "YouTube") title = location.pathname === "/" ? "Home" : "YouTube";
    return { url, vid: vid || null, title };
  }

  function samePage(tab, info) {
    return tab.vid ? tab.vid === info.vid : tab.url === info.url;
  }

  // Point the active tab at the page on screen.
  function syncActive() {
    const info = pageInfo();
    if (pendingNav) {
      const target = tabs.find((t) => t.key === pendingNav.key);
      const arrived = target && samePage(target, info);
      // Until the switch lands, the old page must not overwrite the new tab.
      if (!arrived && Date.now() < pendingNav.until) return;
      pendingNav = null;
    }
    let tab = activeTab();
    if (!tab) {
      tab = { key: newKey(), ...info };
      tabs.unshift(tab);
      activeKey = tab.key;
    } else {
      if (!samePage(tab, info)) {
        // Navigated somewhere new in this tab: start that page fresh.
        tab.t = 0;
        tab.paused = false;
      }
      Object.assign(tab, info);
    }
    saveTabs();
    render();
  }

  let syncTimer = null;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncActive, 150);
  }

  function render() {
    const nodes = tabs.map((tab) => {
      const node = el("div", "pake-tab");
      node.dataset.key = tab.key;
      if (tab.key === activeKey) node.classList.add("active");
      node.title = tab.title || "";
      const img = el("img");
      if (tab.vid) {
        img.src = `https://i.ytimg.com/vi/${tab.vid}/mqdefault.jpg`;
      } else {
        img.src = "https://www.youtube.com/favicon.ico";
        img.className = "page";
      }
      img.alt = "";
      img.draggable = false;
      const title = el("span", "pake-tab-title", tab.title || "Loading…");
      const close = el("span", "pake-tab-close", "");
      close.title = "Close tab";
      node.append(img, title, close);
      return node;
    });
    tabStrip.replaceChildren(...nodes);
  }

  function tabNode(key) {
    return tabStrip.querySelector(`.pake-tab[data-key="${key}"]`);
  }

  function flash(key) {
    const node = tabNode(key);
    if (!node) return;
    node.classList.remove("flash");
    void node.offsetWidth; // restart the animation
    node.classList.add("flash");
    node.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  async function fetchTitle(key) {
    const tab = tabs.find((t) => t.key === key);
    if (!tab || !tab.vid) return;
    try {
      const url = encodeURIComponent(`https://www.youtube.com/watch?v=${tab.vid}`);
      const res = await fetch(`/oembed?url=${url}&format=json`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.title || tab.title) return;
      tab.title = data.title;
      saveTabs();
      render();
    } catch (error) {}
  }

  // Middle-clicked video: open it in a new background tab (or flash its tab).
  function addTab(vid, title) {
    const existing = tabs.find((t) => t.vid === vid);
    if (existing) {
      flash(existing.key);
      return;
    }
    const tab = { key: newKey(), url: `/watch?v=${vid}`, vid, title: title || "" };
    tabs.push(tab);
    while (tabs.length > MAX_TABS) {
      const oldest = tabs.findIndex((t) => t.key !== activeKey);
      tabs.splice(oldest, 1);
    }
    saveTabs();
    render();
    flash(tab.key);
    if (!title) fetchTitle(tab.key);
  }

  // Show a tab's page: YouTube's in-page navigation for videos (resuming at
  // the saved time), a normal page load for everything else.
  function navigateTo(tab) {
    // Load near the saved spot; applyPendingSeek then lands on it exactly.
    const start = Math.floor(tab.t || 0);
    const target = tab.vid ? `/watch?v=${tab.vid}${start ? `&t=${start}s` : ""}` : tab.url;
    const app = document.querySelector("ytd-app");
    if (tab.vid && app) {
      app.dispatchEvent(
        new CustomEvent("yt-navigate", {
          bubbles: true,
          composed: true,
          detail: {
            endpoint: {
              commandMetadata: {
                webCommandMetadata: {
                  url: target,
                  webPageType: "WEB_PAGE_TYPE_WATCH",
                  rootVe: 3832,
                },
              },
              watchEndpoint: { videoId: tab.vid, startTimeSeconds: start },
            },
          },
        }),
      );
      setTimeout(() => {
        if (activeKey === tab.key && !samePage(tab, pageInfo())) location.href = target;
      }, 1500);
    } else {
      location.href = target;
    }
  }

  function activate(tab) {
    if (!tab || tab.key === activeKey) return;
    // Remember exactly where the current video was (unless it's still waiting
    // to be restored itself), to resume it later.
    const current = activeTab();
    if (current && current.vid && !(pendingSeek && pendingSeek.vid === current.vid)) {
      const hit = contentVideo(current.vid);
      if (hit) {
        current.t = hit.video.currentTime || 0;
        current.paused = hit.video.paused;
      }
    }
    activeKey = tab.key;
    pendingNav = { key: tab.key, until: Date.now() + 8000 };
    pendingSeek = tab.vid && tab.t > 0.5 ? seekFor(tab) : null;
    saveTabs();
    render();
    navigateTo(tab);
  }

  function closeTab(key) {
    const index = tabs.findIndex((t) => t.key === key);
    if (index < 0) return;
    const wasActive = key === activeKey;
    tabs.splice(index, 1);
    if (!tabs.length) {
      // Like a browser window with its last tab closed: start over at Home.
      const home = { key: newKey(), url: "/", vid: null, title: "Home" };
      tabs.push(home);
      activeKey = null;
      activate(home);
      return;
    }
    if (wasActive) {
      activeKey = null;
      activate(tabs[Math.min(index, tabs.length - 1)]);
    } else {
      saveTabs();
      render();
    }
  }

  function newTab() {
    const home = { key: newKey(), url: "/", vid: null, title: "Home" };
    tabs.push(home);
    activate(home);
  }

  function clearAll() {
    const home = { key: newKey(), url: "/", vid: null, title: "Home" };
    tabs = [home];
    activeKey = null;
    pendingSeek = null;
    activate(home);
  }

  // --- Exact resume ---
  // The active tab's video position is saved continuously while you watch
  // (ads excluded), so switching back to it, or reopening the app, lands on
  // the exact moment, still paused if it was paused.
  let pendingSeek = null; // { vid, t, paused, until }
  let lastPositionSave = 0;

  function seekFor(tab) {
    return { vid: tab.vid, t: tab.t, paused: !!tab.paused, until: Date.now() + 30000 };
  }

  // The player and <video> if they're showing this video's content (not an ad).
  function contentVideo(vid) {
    const player = document.querySelector("#movie_player");
    const video = player && player.querySelector("video");
    if (!player || !video || !vid || player.classList.contains("ad-showing")) return null;
    const data = player.getVideoData ? player.getVideoData() : null;
    if (!data || data.video_id !== vid || videoIdFrom(location.href) !== vid) return null;
    return { player, video };
  }

  function recordPosition(force) {
    const tab = activeTab();
    if (!tab || !tab.vid || pendingNav || pendingSeek) return;
    const hit = contentVideo(tab.vid);
    if (!hit) return;
    tab.t = hit.video.currentTime || 0;
    tab.paused = hit.video.paused;
    const now = Date.now();
    if (force || now - lastPositionSave > 2000) {
      lastPositionSave = now;
      saveTabs();
    }
  }

  function applyPendingSeek(type) {
    const seek = pendingSeek;
    if (!seek) return;
    if (Date.now() > seek.until) {
      pendingSeek = null;
      return;
    }
    const hit = contentVideo(seek.vid);
    if (!hit || hit.video.readyState < 1) return; // still loading, or an ad
    if (!seek.loadedAt) seek.loadedAt = Date.now();
    // Act once YouTube has started playback: by then its own start position
    // and autoplay have run, so they can't undo the seek or the pause.
    if (type !== "playing" && type !== "timeupdate") return;
    if (Math.abs(hit.video.currentTime - seek.t) > 0.1) {
      if (hit.player.seekTo) hit.player.seekTo(seek.t, true);
      else hit.video.currentTime = seek.t;
    }
    // Only the autoplay right after loading gets paused, never a later
    // play you started yourself.
    if (seek.paused && Date.now() - seek.loadedAt < 10000) {
      if (hit.player.pauseVideo) hit.player.pauseVideo();
      else hit.video.pause();
    }
    pendingSeek = null;
  }

  // Media events don't bubble, so listen in the capture phase.
  for (const type of ["timeupdate", "pause", "seeked", "playing", "canplay", "loadedmetadata"]) {
    document.addEventListener(
      type,
      (e) => {
        if (e.target.tagName !== "VIDEO") return;
        if (pendingSeek) applyPendingSeek(type);
        else if (type === "timeupdate") recordPosition(false);
        else if (type === "pause" || type === "seeked") recordPosition(true);
      },
      true,
    );
  }
  window.addEventListener("pagehide", () => recordPosition(true));

  // --- Right-click menu on the tab area ---
  const tabMenu = el("div");
  tabMenu.id = "pake-tab-menu";
  document.body.appendChild(tabMenu);

  function tabMenuItem(icon, label, action) {
    const item = el("div", "pake-tm-item");
    item.append(el("span", "pake-tm-icon", icon), el("span", "", label));
    item.addEventListener("click", () => {
      closeTabMenu();
      action();
    });
    return item;
  }

  function openTabMenu(x, y, key) {
    const items = [];
    if (key) items.push(tabMenuItem("", "Close tab", () => closeTab(key)));
    items.push(tabMenuItem("", "New tab", newTab));
    items.push(el("div", "pake-tm-sep"));
    items.push(tabMenuItem("", "Clear all tabs", clearAll));
    tabMenu.replaceChildren(...items);
    tabMenu.classList.add("open");
    const rect = tabMenu.getBoundingClientRect();
    tabMenu.style.left = `${Math.max(2, Math.min(x, window.innerWidth - rect.width - 2))}px`;
    tabMenu.style.top = `${Math.max(2, Math.min(y, window.innerHeight - rect.height - 2))}px`;
  }

  function closeTabMenu() {
    tabMenu.classList.remove("open");
  }

  // Window capture runs before Pake's own menu (which would offer "Download
  // Image" for tab thumbnails). Downloads and window buttons keep theirs.
  window.addEventListener(
    "contextmenu",
    (e) => {
      if (!e.target.closest || !e.target.closest("#pake-titlebar")) return;
      if (e.target.closest("#pake-dl-list, .pake-tb-controls")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const node = e.target.closest(".pake-tab");
      openTabMenu(e.clientX, e.clientY, node && node.dataset.key);
    },
    true,
  );
  document.addEventListener(
    "mousedown",
    (e) => {
      if (tabMenu.classList.contains("open") && !tabMenu.contains(e.target)) closeTabMenu();
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTabMenu();
  });
  window.addEventListener("blur", closeTabMenu);

  tabStrip.addEventListener("click", (e) => {
    const node = e.target.closest(".pake-tab");
    if (!node) return;
    if (e.target.closest(".pake-tab-close")) closeTab(node.dataset.key);
    else activate(tabs.find((t) => t.key === node.dataset.key));
  });
  tabStrip.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll
  });
  tabStrip.addEventListener("auxclick", (e) => {
    const node = e.target.closest(".pake-tab");
    if (e.button === 1 && node) closeTab(node.dataset.key);
  });
  newTabBtn.addEventListener("click", newTab);

  // Follow navigation in the active tab: page changes and title updates.
  document.addEventListener("yt-navigate-finish", scheduleSync);
  window.addEventListener("popstate", scheduleSync);
  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(scheduleSync).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  // --- Middle-click a video link to save it ---
  function videoIdFrom(href) {
    try {
      const url = new URL(href, location.href);
      if (/(^|\.)youtube\.com$/.test(url.hostname)) {
        if (url.pathname === "/watch") return url.searchParams.get("v");
        const shorts = url.pathname.match(/^\/shorts\/([\w-]{11})/);
        if (shorts) return shorts[1];
      }
      if (url.hostname === "youtu.be") return url.pathname.slice(1, 12);
    } catch (error) {}
    return null;
  }

  function videoLink(e) {
    if (e.button !== 1 || !e.target.closest) return null;
    const link = e.target.closest("a[href]");
    if (!link || link.closest("#pake-titlebar")) return null;
    const id = videoIdFrom(link.href);
    return id && /^[\w-]{11}$/.test(id) ? { link, id } : null;
  }

  function titleFromLink(link) {
    const renderer = link.closest(
      "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model",
    );
    const candidates = [
      link.getAttribute("title"),
      renderer && renderer.querySelector("#video-title")?.textContent,
      renderer && renderer.querySelector("h3")?.textContent,
    ];
    const found = candidates.find((t) => t && t.trim());
    return found ? found.trim() : "";
  }

  window.addEventListener(
    "mousedown",
    (e) => {
      if (videoLink(e)) e.preventDefault(); // stop the autoscroll cursor
    },
    true,
  );
  window.addEventListener(
    "auxclick",
    (e) => {
      const hit = videoLink(e);
      if (!hit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      addTab(hit.id, titleFromLink(hit.link));
    },
    true,
  );

  // --- Updates ---
  // On launch, ask the updater (GitHub Releases, signature-checked) whether a
  // newer version exists; if so, show a small Update pill beside the window
  // buttons. Nothing happens until it's clicked: then it downloads, Windows
  // asks for admin, and the installer restarts the app on the new version.
  const updateBtn = el("button", "pake-tb-update");
  updateBtn.hidden = true;
  controls.parentNode.insertBefore(updateBtn, controls);
  let pendingUpdate = null; // { rid, version, currentVersion }
  let updating = false;

  function showUpdate(label, title) {
    updateBtn.textContent = label;
    updateBtn.title = title;
    updateBtn.hidden = false;
  }

  async function checkForUpdate() {
    try {
      const update = await invokeTauri("plugin:updater|check", {});
      if (!update || !update.version) return;
      pendingUpdate = update;
      showUpdate(
        "↓ Update",
        `Version ${update.version} is available (you have ${update.currentVersion}).\nClick to update: YouTube will restart.`,
      );
    } catch (error) {
      console.warn("[pake-update] check failed", error);
    }
  }

  updateBtn.addEventListener("click", async () => {
    if (!pendingUpdate || updating) return;
    updating = true;
    let total = 0;
    let done = 0;
    const channel = new tauri.core.Channel();
    channel.onmessage = (event) => {
      if (event.event === "Started") total = event.data.contentLength || 0;
      if (event.event === "Progress") done += event.data.chunkLength || 0;
      if (event.event === "Finished") showUpdate("Installing…", "Approve the Windows prompt to finish.");
      else if (total) showUpdate(`${Math.floor((done / total) * 100)}%`, "Downloading the update…");
    };
    showUpdate("0%", "Downloading the update…");
    try {
      await invokeTauri("plugin:updater|download_and_install", {
        onEvent: channel,
        rid: pendingUpdate.rid,
      });
    } catch (error) {
      updating = false;
      showUpdate("Update failed", `${error}\nClick to try again.`);
      pendingUpdate = null;
      checkForUpdate();
    }
  });

  function invokeTauri(cmd, args) {
    return tauri.core.invoke(cmd, args);
  }
  setTimeout(checkForUpdate, 4000);

  // Show saved tabs straight away, then make the active one this page.
  loadTabs();
  render();
  const startTab = activeTab();
  const startPage = pageInfo();
  if (startTab && startTab.vid && startPage.url === "/" && !samePage(startTab, startPage)) {
    // The app came up on Home but the active tab is a video (the app wasn't
    // closed normally, so Pake didn't save the last page): reopen that video
    // rather than overwriting the tab with Home.
    pendingNav = { key: startTab.key, until: Date.now() + 8000 };
    if (startTab.t > 0.5) pendingSeek = seekFor(startTab);
    navigateTo(startTab);
  } else {
    syncActive();
    // Reopened the app on a video: pick up exactly where it was left.
    if (startTab && startTab.vid && startTab.t > 0.5 && startTab.vid === videoIdFrom(location.href)) {
      pendingSeek = seekFor(startTab);
    }
  }
  // Fill in any titles that are still missing from earlier sessions.
  tabs.filter((t) => !t.title).forEach((t) => fetchTitle(t.key));
})();
