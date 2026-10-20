// yt-dlp downloads for the Pake-built YouTube app.
// "Download Video" in Pake's right-click menu (on the player, or on any video
// link) saves that video with yt-dlp into the user's Downloads folder as MP4.
// Progress shows in the title bar. Right-click a download for Open folder /
// Cancel / Dismiss; left-click cancels a running one or opens a finished one.
// yt-dlp, ffmpeg and deno ship in the installer's tools\ folder; yt-dlp finds
// the other two next to itself.
// The app may only run yt-dlp with exactly ARGS + a youtube.com/watch URL,
// taskkill only against yt-dlp.exe, and explorer only on a Users\*\Downloads
// folder or a file directly in it: the shell:allow-spawn scope in pake-cli's
// capabilities/default.json must match.
// Injected by Pake inside a DOMContentLoaded handler.
(function () {
  if (window.__PAKE_DOWNLOADS__) return;
  window.__PAKE_DOWNLOADS__ = true;

  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || !tauri.core.Channel) return;
  const { invoke, Channel } = tauri.core;

  const SAVE_DIR_LABEL = "your Downloads folder";
  const ARGS = [
    "--ignore-config",
    "--no-playlist",
    "--newline",
    "--encoding",
    "utf-8",
    "-f",
    "bv*+ba/b",
    // Prefer H.264 + AAC: plays in every player (Windows' own can't play the
    // Opus audio or AV1 video YouTube serves as "best"). Caps most at 1080p.
    "-S",
    "vcodec:h264,res,acodec:aac",
    "--merge-output-format",
    "mp4",
    "-P",
    "~\\Downloads",
    "-o",
    "%(title)s [%(id)s].%(ext)s",
  ];
  const MENU_ID = "pake-context-menu";
  const DOWNLOAD_TEXT = "Download Video";
  const DONE_LINGER_MS = 30000;

  const css = `
    #pake-dl-list {
      flex: none;
      display: flex;
      align-items: center;
      gap: 4px;
      height: 100%;
      padding: 0 6px;
    }
    #pake-dl-list:empty { display: none; }
    .pake-dl {
      position: relative;
      display: flex;
      align-items: center;
      gap: 6px;
      height: 24px;
      max-width: 220px;
      padding: 0 8px;
      border-radius: 12px;
      overflow: hidden;
      background: var(--tb-tab, rgba(255,255,255,.06));
      font-size: 12px;
      white-space: nowrap;
      cursor: default;
    }
    .pake-dl-icon { flex: none; font: 11px/1 "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif; }
    .pake-dl-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    /* The percentage shows progress; the pill's tint only shows the outcome. */
    .pake-dl.running:hover { background: rgba(196,43,28,.45); }
    .pake-dl.done { background: rgba(43,166,64,.3); }
    .pake-dl.failed { background: rgba(196,43,28,.4); }
    .pake-dl.fade { opacity: 0; transition: opacity .6s; }

    /* Right-click menu for a download, matching the miniplayer's menu. */
    #pake-dl-menu {
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
    #pake-dl-menu.open { display: block; }
    .pake-dl-mi {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 30px;
      padding: 0 14px 0 10px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .pake-dl-mi:hover { background: #3b3b3b; }
    .pake-dl-mi-icon {
      width: 16px;
      text-align: center;
      font: 12px/1 "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
    }

    /* Fallback when there's no custom title bar (e.g. the miniplayer). */
    #pake-dl-list.floating {
      position: fixed;
      left: 12px;
      bottom: 12px;
      z-index: 2147483647;
      height: auto;
      color: #fff;
      --tb-tab: rgba(0,0,0,.75);
    }
  `;
  const style = document.createElement("style");
  style.id = "pake-dl-style";
  style.textContent = css;
  document.head.appendChild(style);

  // --- Title bar indicator ---
  const list = document.createElement("div");
  list.id = "pake-dl-list";

  function mountList() {
    const controls = document.querySelector("#pake-titlebar .pake-tb-controls");
    const inMini = document.documentElement.classList.contains("pake-mini");
    if (controls && !inMini) {
      list.classList.remove("floating");
      if (list.nextSibling !== controls) controls.parentNode.insertBefore(list, controls);
    } else {
      list.classList.add("floating");
      if (list.parentNode !== document.body) document.body.appendChild(list);
    }
  }

  const downloads = new Map(); // video id -> state

  function span(className, text) {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    return node;
  }

  function createPill(dl) {
    const pill = document.createElement("div");
    pill.className = "pake-dl running";
    const icon = span("pake-dl-icon", "\uE896"); // download arrow
    const text = span("pake-dl-text", "Starting\u2026");
    pill.append(icon, text);
    pill.addEventListener("click", () => {
      if (dl.status === "running") cancel(dl);
      else if (dl.status === "done") openFolder(dl);
      else removePill(dl);
    });
    pill.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPillMenu(dl, e.clientX, e.clientY);
    });
    // Don't fade out while the pointer is on it.
    pill.addEventListener("mouseenter", () => clearTimeout(dl.lingerTimer));
    pill.addEventListener("mouseleave", () => scheduleRemoval(dl));
    dl.pill = pill;
    dl.icon = icon;
    dl.text = text;
    mountList();
    list.appendChild(pill);
    update(dl);
  }

  function removePill(dl) {
    clearTimeout(dl.lingerTimer);
    dl.pill.classList.add("fade");
    setTimeout(() => {
      dl.pill.remove();
      if (downloads.get(dl.id) === dl) downloads.delete(dl.id);
    }, 600);
  }

  function update(dl) {
    const pct = Math.max(0, Math.min(100, dl.percent));
    let label;
    if (dl.status === "done") label = "Saved";
    else if (dl.status === "failed") label = "Failed";
    else if (dl.status === "cancelled") label = "Cancelled";
    else if (dl.merging) label = "Merging\u2026";
    else label = `${pct.toFixed(0)}%`;
    dl.text.textContent = `${label} \u00B7 ${dl.title}`;
    dl.icon.textContent =
      dl.status === "done" ? "\uE73E" : dl.status === "running" ? "\uE896" : "\uE711";
    dl.pill.className = `pake-dl ${dl.status}`;
    const tail =
      dl.status === "running"
        ? "\nClick to cancel · right-click for more"
        : dl.status === "done"
          ? "\nClick to open folder · right-click for more"
          : "\nClick to dismiss";
    const where = dl.status === "done" ? `\nSaved to ${SAVE_DIR_LABEL}` : "";
    const why = dl.status === "failed" && dl.error ? `\n${dl.error}` : "";
    dl.pill.title = `${dl.title}${where}${why}${tail}`;
  }

  function scheduleRemoval(dl) {
    clearTimeout(dl.lingerTimer);
    if (dl.status === "running") return;
    const delay =
      dl.status === "cancelled" ? 4000 : dl.status === "failed" ? 20000 : DONE_LINGER_MS;
    dl.lingerTimer = setTimeout(() => removePill(dl), delay);
  }

  function finish(dl, status) {
    if (dl.status !== "running") return;
    dl.status = status;
    if (status === "done") dl.percent = 100;
    update(dl);
    scheduleRemoval(dl);
  }

  // yt-dlp output: "[info] ...: Downloading 1 format(s): 399+251", then per
  // stream "[download] Destination: ..." followed by "[download]  42.0% of ...".
  function onLine(dl, line) {
    const formats = line.match(/Downloading \d+ format\(s\): (\S+)/);
    if (formats) dl.streams = formats[1].split("+").length;
    if (/^\[download\] Destination:/.test(line)) dl.stream += 1;
    const pct = line.match(/^\[download\]\s+([\d.]+)%/);
    if (pct) {
      const stream = Math.max(1, dl.stream);
      dl.percent = ((stream - 1) * 100 + parseFloat(pct[1])) / Math.max(dl.streams, stream);
    }
    // Remember where the file lands (the merged file wins over the parts).
    const dest = line.match(/^\[download\] Destination: (.+)$/);
    if (dest) dl.file = dest[1].trim();
    const merged = line.match(/^\[Merger\] Merging formats into "(.+)"$/);
    if (merged) dl.file = merged[1];
    const already = line.match(/^\[download\] (.+) has already been downloaded/);
    if (already) dl.file = already[1].trim();
    if (/^\[Merger\]/.test(line)) dl.merging = true;
    if (/has already been downloaded/.test(line)) dl.percent = 100;
    if (/^ERROR:/.test(line)) dl.error = line.slice(0, 300);
    update(dl);
  }

  async function startDownload(id, title) {
    const existing = downloads.get(id);
    if (existing && existing.status === "running") {
      existing.pill.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400 });
      return;
    }
    if (existing) removePill(existing);

    const dl = {
      id,
      title: title || id,
      status: "running",
      percent: 0,
      streams: 1,
      stream: 0,
      merging: false,
      error: "",
      pid: null,
      file: "",
    };
    downloads.set(id, dl);
    createPill(dl);

    const channel = new Channel();
    channel.onmessage = (msg) => {
      if (msg.event === "Stdout" || msg.event === "Stderr") {
        String(msg.payload).split(/\r?\n/).forEach((line) => line && onLine(dl, line));
      } else if (msg.event === "Terminated") {
        finish(dl, msg.payload && msg.payload.code === 0 ? "done" : "failed");
      } else if (msg.event === "Error") {
        dl.error = String(msg.payload).slice(0, 300);
      }
    };
    try {
      dl.pid = await invoke("plugin:shell|spawn", {
        program: "pake-ytdlp",
        args: [...ARGS, `https://www.youtube.com/watch?v=${id}`],
        onEvent: channel,
        options: {},
      });
    } catch (error) {
      dl.error = String(error).slice(0, 300);
      finish(dl, "failed");
    }
  }

  // yt-dlp.exe unpacks itself into a second yt-dlp.exe process (which runs
  // ffmpeg/deno), so killing just the spawned pid leaves it running. Kill the
  // whole tree, restricted to processes named yt-dlp.exe.
  async function cancel(dl) {
    dl.status = "cancelled";
    update(dl);
    if (dl.pid != null) {
      await invoke("plugin:shell|spawn", {
        program: "pake-ytdlp-stop",
        args: ["/F", "/T", "/FI", "IMAGENAME eq yt-dlp.exe", "/FI", `PID eq ${dl.pid}`],
        onEvent: new Channel(),
        options: {},
      }).catch((error) => console.error("[pake-downloads]", error));
    }
    scheduleRemoval(dl);
  }

  // Show the file in Explorer (selected), or just open the Downloads folder
  // if the file isn't known or no longer there.
  async function openFolder(dl) {
    const run = (program, args) =>
      invoke("plugin:shell|spawn", { program, args, onEvent: new Channel(), options: {} });
    const finished = dl.status === "done" && dl.file && !/\.part$|\.f\d+\.\w+$/.test(dl.file);
    if (finished) {
      try {
        await run("pake-show-download", ["/select,", dl.file]);
        return;
      } catch (error) {
        console.error("[pake-downloads]", error);
      }
    }
    try {
      const home = await tauri.path.homeDir();
      await run("pake-open-downloads", [`${home.replace(/[\\/]+$/, "")}\\Downloads`]);
    } catch (error) {
      console.error("[pake-downloads]", error);
    }
  }

  // --- Right-click menu on a download ---
  const pillMenu = document.createElement("div");
  pillMenu.id = "pake-dl-menu";
  document.body.appendChild(pillMenu);

  function pillMenuItem(icon, label, action) {
    const item = document.createElement("div");
    item.className = "pake-dl-mi";
    item.append(span("pake-dl-mi-icon", icon), span("", label));
    item.addEventListener("click", () => {
      closePillMenu();
      action();
    });
    return item;
  }

  function openPillMenu(dl, x, y) {
    const items = [pillMenuItem("", "Open folder", () => openFolder(dl))];
    if (dl.status === "running") {
      items.push(pillMenuItem("", "Cancel download", () => cancel(dl)));
    } else {
      items.push(pillMenuItem("", "Dismiss", () => removePill(dl)));
    }
    pillMenu.replaceChildren(...items);
    pillMenu.classList.add("open");
    const rect = pillMenu.getBoundingClientRect();
    pillMenu.style.left = `${Math.max(2, Math.min(x, window.innerWidth - rect.width - 2))}px`;
    pillMenu.style.top = `${Math.max(2, Math.min(y, window.innerHeight - rect.height - 2))}px`;
  }

  function closePillMenu() {
    pillMenu.classList.remove("open");
  }

  document.addEventListener(
    "mousedown",
    (e) => {
      if (pillMenu.classList.contains("open") && !pillMenu.contains(e.target)) closePillMenu();
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePillMenu();
  });
  window.addEventListener("blur", closePillMenu);

  // --- Which video a right-click refers to ---
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

  function currentVideo() {
    const player = document.querySelector("#movie_player");
    const data = player && player.getVideoData ? player.getVideoData() : null;
    const id =
      (data && data.video_id) ||
      videoIdFrom(location.href) ||
      null;
    const title = (data && data.title) || document.title.replace(/ - YouTube$/, "");
    return id ? { id, title } : null;
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

  // Remember what was right-clicked; Pake builds its menu in the same event.
  let menuTarget = null;
  window.addEventListener(
    "contextmenu",
    (e) => {
      const link = e.target.closest && e.target.closest("a[href]");
      const linkId = link && videoIdFrom(link.href);
      if (linkId && /^[\w-]{11}$/.test(linkId)) {
        menuTarget = { id: linkId, title: titleFromLink(link) };
      } else if (e.target.closest && e.target.closest("#movie_player, video")) {
        menuTarget = currentVideo();
      } else {
        menuTarget = null;
      }
      // Pake's link menu has no download entry: add one for video links.
      if (linkId) setTimeout(addDownloadItem, 0);
    },
    true,
  );

  function addDownloadItem() {
    const menu = document.getElementById(MENU_ID);
    if (!menu || menu.style.display === "none" || !menuTarget) return;
    const items = [...menu.children];
    if (items.some((item) => item.textContent === DOWNLOAD_TEXT) || !items.length) return;
    const template = items[0];
    const item = document.createElement("div");
    item.style.cssText = template.style.cssText;
    item.textContent = DOWNLOAD_TEXT;
    const hoverBg = getComputedStyle(template).backgroundColor;
    item.addEventListener("mouseenter", () => {
      item.style.backgroundColor = "rgba(127,127,127,.2)";
    });
    item.addEventListener("mouseleave", () => {
      item.style.backgroundColor = hoverBg;
    });
    menu.insertBefore(item, template);
  }

  // Take over Pake's "Download Video" (which can't save YouTube's streams).
  window.addEventListener(
    "click",
    (e) => {
      const menu = document.getElementById(MENU_ID);
      if (!menu || !menu.contains(e.target)) return;
      const item = [...menu.children].find((child) => child.contains(e.target));
      if (!item || item.textContent !== DOWNLOAD_TEXT) return;
      const target = menuTarget || currentVideo();
      if (!target) return; // not a YouTube video: leave Pake's behaviour
      e.preventDefault();
      e.stopImmediatePropagation();
      menu.style.display = "none";
      startDownload(target.id, target.title);
    },
    true,
  );

  // Lets the miniplayer's own right-click menu offer a download too.
  window.__PAKE_DOWNLOAD_CURRENT__ = () => {
    const video = currentVideo();
    if (video) startDownload(video.id, video.title);
  };

  // Keep the indicator in the title bar, or floating while in mini mode.
  new MutationObserver(mountList).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
})();
