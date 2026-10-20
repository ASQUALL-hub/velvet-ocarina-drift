// YouTube always-on-top miniplayer for the Pake-built YouTube app.
// Toggle with the player button (next to fullscreen) or Ctrl+Shift+M.
// The mini window is kept at the video's aspect ratio, so it never letterboxes.
// Injected by Pake inside a DOMContentLoaded handler.
(function () {
  if (window.__PAKE_MINIPLAYER__) return;
  window.__PAKE_MINIPLAYER__ = true;

  const tauri = window.__TAURI__;
  if (!tauri || !tauri.window) return;
  const appWindow = tauri.window.getCurrentWindow();
  const dpi = tauri.dpi || tauri.window;

  const MINI_WIDTH = 480;
  const MINI_HEIGHT = 270;
  const MIN_WIDTH = 160;
  const MIN_HEIGHT = 90;
  const MARGIN = 16;
  const SNAP_DELAY = 250;

  let active = false;
  let busy = false;
  let saved = null;
  let player = null;
  let lastViewport = null;
  let snapTimer = null;
  let fitting = Promise.resolve();

  const css = `
    html.pake-mini, html.pake-mini body {
      overflow: hidden !important;
      background: #000 !important;
    }
    html.pake-mini #masthead-container,
    html.pake-mini ytd-masthead,
    html.pake-mini tp-yt-app-drawer,
    html.pake-mini ytd-miniplayer,
    html.pake-mini tp-yt-iron-overlay-backdrop,
    html.pake-mini ytd-popup-container {
      display: none !important;
    }
    /* Hide the rest of the page; it can stack above the player at large sizes. */
    html.pake-mini body *:not(.pake-mini-player):not(.pake-mini-player *):not(#pake-mini-bar):not(#pake-mini-bar *):not(#pake-mini-grip):not(#pake-mini-menu):not(#pake-mini-menu *) {
      visibility: hidden !important;
    }
    html.pake-mini .pake-mini-player {
      visibility: visible !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      z-index: 2147483640 !important;
      background: #000 !important;
    }
    html.pake-mini .pake-mini-player .html5-video-container,
    html.pake-mini .pake-mini-player video {
      width: 100% !important;
      height: 100% !important;
      top: 0 !important;
      left: 0 !important;
    }
    /* Crop rather than letterbox while the window is mid-resize; once it
       snaps to the video's aspect ratio nothing is cropped. */
    html.pake-mini .pake-mini-player video {
      object-fit: cover !important;
    }
    /* Videos with black bars burned into the picture: scale the frame up so
       only the real picture is visible. */
    html.pake-mini .pake-mini-player .html5-video-container {
      overflow: hidden !important;
    }
    html.pake-mini .pake-mini-player.pake-mini-cropped video {
      object-fit: fill !important;
      width: var(--pake-mini-w) !important;
      height: var(--pake-mini-h) !important;
      left: var(--pake-mini-x) !important;
      top: var(--pake-mini-y) !important;
    }
    #pake-mini-bar {
      display: none;
    }
    html.pake-mini #pake-mini-bar {
      display: flex;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      z-index: 2147483647;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
      padding: 0 6px;
      box-sizing: border-box;
      background: linear-gradient(rgba(0,0,0,.75), rgba(0,0,0,0));
      cursor: move;
      opacity: 0;
      transition: opacity .15s;
    }
    html.pake-mini:hover #pake-mini-bar { opacity: 1; }
    #pake-mini-bar button {
      width: 26px;
      height: 26px;
      border: 0;
      border-radius: 4px;
      background: rgba(0,0,0,.4);
      color: #fff;
      font: 15px/26px sans-serif;
      cursor: pointer;
      padding: 0;
    }
    #pake-mini-bar button:hover { background: rgba(255,255,255,.25); }
    #pake-mini-grip {
      display: none;
    }
    html.pake-mini #pake-mini-grip {
      display: block;
      position: fixed;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      z-index: 2147483647;
      cursor: se-resize;
    }
    /* With a corner locked, the grip sits in the opposite (free) corner. */
    html.pake-mini[data-pake-grip="SouthWest"] #pake-mini-grip {
      right: auto; left: 0; cursor: sw-resize;
    }
    html.pake-mini[data-pake-grip="NorthEast"] #pake-mini-grip {
      bottom: auto; top: 0; cursor: ne-resize;
    }
    html.pake-mini[data-pake-grip="NorthWest"] #pake-mini-grip {
      right: auto; bottom: auto; left: 0; top: 0; cursor: nw-resize;
    }
    html.pake-mini[data-pake-grip="NorthEast"] #pake-mini-bar { padding-right: 22px; }
    html.pake-mini.pake-mini-locked #pake-mini-bar { cursor: default; }
    .pake-mini-button svg { pointer-events: none; }

    /* Right-click menu, styled like the Windows 11 dark window menu. */
    #pake-mini-menu {
      display: none;
      position: fixed;
      z-index: 2147483647;
      min-width: 190px;
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
    #pake-mini-menu.open { display: block; }
    .pake-mini-item {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 30px;
      padding: 0 14px 0 10px;
      border-radius: 4px;
      white-space: nowrap;
    }
    .pake-mini-item:hover { background: #3b3b3b; }
    .pake-mini-icon {
      width: 16px;
      text-align: center;
      font-size: 14px;
    }
    .pake-mini-sep {
      height: 1px;
      margin: 4px 2px;
      background: #464646;
    }
  `;
  const style = document.createElement("style");
  style.id = "pake-mini-style";
  style.textContent = css;
  document.head.appendChild(style);

  // Drag bar and resize grip shown while in mini mode.
  const bar = document.createElement("div");
  bar.id = "pake-mini-bar";
  // YouTube enforces Trusted Types, so build DOM nodes instead of innerHTML.
  const restoreBtn = document.createElement("button");
  restoreBtn.dataset.act = "restore";
  restoreBtn.title = "Back to full window (Ctrl+Shift+M)";
  restoreBtn.textContent = "⤢";
  bar.appendChild(restoreBtn);
  // Eased dragging: the cursor sets a target and the window glides after it
  // (native window dragging can't be eased).
  const DRAG_EASE_MS = 70; // smoothing time constant; higher is floatier
  let drag = null;

  // The page's screenX/Y don't track the real cursor once the window moves,
  // so read the cursor's position from the OS instead.
  function pollCursor() {
    const d = drag;
    if (!d || d.cursorInFlight) return;
    d.cursorInFlight = true;
    tauri.window
      .cursorPosition()
      .then((c) => {
        d.targetX = c.x - d.grabX;
        d.targetY = c.y - d.grabY;
      })
      .catch(() => {})
      .finally(() => {
        d.cursorInFlight = false;
      });
  }

  function stepDrag(now) {
    if (!drag) return;
    if (drag.held) pollCursor();
    const dt = Math.min(now - drag.last, 100);
    drag.last = now;
    const k = 1 - Math.exp(-dt / DRAG_EASE_MS);
    drag.x += (drag.targetX - drag.x) * k;
    drag.y += (drag.targetY - drag.y) * k;
    const settled =
      !drag.held &&
      !drag.finalPending &&
      Math.abs(drag.targetX - drag.x) < 0.5 &&
      Math.abs(drag.targetY - drag.y) < 0.5;
    if (settled) {
      drag.x = drag.targetX;
      drag.y = drag.targetY;
      drag.done = true;
    } else {
      drag.raf = requestAnimationFrame(stepDrag);
    }
    sendDragPosition();
  }

  // One setPosition in flight at a time; frames in between just update the
  // position that gets sent next.
  function sendDragPosition() {
    const d = drag;
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    if (d.inFlight || (x === d.sentX && y === d.sentY)) {
      if (d.done && !d.inFlight) drag = null;
      return;
    }
    d.inFlight = true;
    d.sentX = x;
    d.sentY = y;
    appWindow
      .setPosition(new dpi.PhysicalPosition(x, y))
      .catch(() => {})
      .finally(() => {
        d.inFlight = false;
        if (drag === d) sendDragPosition();
      });
  }

  bar.addEventListener("pointerdown", async (e) => {
    if (e.target.closest("button") || e.button !== 0 || e.detail > 1) return;
    if (lockedCorner) return; // locked windows don't move
    if (drag && drag.held) return;
    e.preventDefault();
    cancelDrag(); // grabbed again while still gliding
    bar.setPointerCapture(e.pointerId);
    const pending = { held: true };
    drag = pending;
    const [pos, cursor] = await Promise.all([
      appWindow.outerPosition(),
      tauri.window.cursorPosition(),
    ]);
    if (drag !== pending) return;
    Object.assign(pending, {
      grabX: cursor.x - pos.x,
      grabY: cursor.y - pos.y,
      x: pos.x,
      y: pos.y,
      sentX: pos.x,
      sentY: pos.y,
      targetX: pos.x,
      targetY: pos.y,
      last: performance.now(),
    });
    // Released before the positions came back: glide to where it was let go.
    if (!pending.held) readFinalCursor(pending);
    pending.raf = requestAnimationFrame(stepDrag);
  });
  bar.addEventListener("pointermove", (e) => {
    if (drag && drag.held === true && e.buttons === 0) endDrag();
  });
  // One last read so it settles exactly where the cursor was released.
  function readFinalCursor(d) {
    d.finalPending = true;
    tauri.window
      .cursorPosition()
      .then((c) => {
        d.targetX = c.x - d.grabX;
        d.targetY = c.y - d.grabY;
      })
      .catch(() => {})
      .finally(() => {
        d.finalPending = false;
      });
  }
  const endDrag = () => {
    const d = drag;
    if (!d || !d.held) return;
    d.held = false;
    if (d.grabX !== undefined) readFinalCursor(d);
  };
  function cancelDrag() {
    if (drag) cancelAnimationFrame(drag.raf);
    drag = null;
  }
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);
  bar.addEventListener("lostpointercapture", endDrag);
  bar.addEventListener("dblclick", (e) => {
    if (!e.target.closest("button")) toggle();
  });
  bar.addEventListener("click", (e) => {
    if (e.target.closest('[data-act="restore"]')) toggle();
  });
  document.body.appendChild(bar);

  const grip = document.createElement("div");
  grip.id = "pake-mini-grip";
  grip.addEventListener("mousedown", (e) => {
    if (e.buttons !== 1) return;
    e.preventDefault();
    const direction = document.documentElement.dataset.pakeGrip || "SouthEast";
    appWindow.startResizeDragging(direction).catch(() => {});
  });
  document.body.appendChild(grip);

  function findPlayer() {
    const el = document.querySelector("#movie_player");
    return el && el.querySelector("video") ? el : null;
  }

  function nudgeLayout() {
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.dispatchEvent(new Event("resize")), 150);
  }

  // Aspect ratio of the visible picture (the frame minus burned-in bars).
  function videoAspect() {
    const video = player && player.querySelector("video");
    if (video && video.videoWidth && video.videoHeight) {
      let ratio = video.videoWidth / video.videoHeight;
      if (crop) ratio *= (1 - 2 * crop.h) / (1 - 2 * crop.v);
      return ratio;
    }
    return 16 / 9;
  }

  // Burned-in letterbox/pillarbox detection. Frames are sampled into a small
  // canvas and fully black rows/columns at the edges are measured. Bars only
  // count when they're on both sides, and the smallest bars seen across
  // several frames win, so a dark scene doesn't get cropped.
  const SAMPLE_WIDTH = 256;
  const BLACK_LEVEL = 40;
  const MIN_SAMPLES = 3;
  const MIN_BAR = 0.02;
  const MAX_BAR = 0.25;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let crop = null; // { v, h }: fraction cropped from each side
  let cropKey = "";
  let minBars = null;
  let samples = 0;
  let lastSampleTime = -1;

  function measureBars(video) {
    const w = SAMPLE_WIDTH;
    const h = Math.max(8, Math.round((w * video.videoHeight) / video.videoWidth));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const bright = (x, y) => {
      const i = (y * w + x) * 4;
      return Math.max(data[i], data[i + 1], data[i + 2]) > BLACK_LEVEL;
    };
    // Allow a few bright pixels (channel logos, compression noise).
    const rowBlack = (y) => {
      let n = 0;
      for (let x = 0; x < w; x++) if (bright(x, y) && ++n > w * 0.03) return false;
      return true;
    };
    const colBlack = (x) => {
      let n = 0;
      for (let y = 0; y < h; y++) if (bright(x, y) && ++n > h * 0.03) return false;
      return true;
    };

    // Every loop is bounded: a dark frame with a thin bright line can have a
    // non-black row while every column still counts as black.
    let top = 0;
    while (top < h && rowBlack(top)) top++;
    if (top === h) return null; // fade to black: tells us nothing
    let bottom = 0;
    while (bottom < h && rowBlack(h - 1 - bottom)) bottom++;
    let left = 0;
    while (left < w && colBlack(left)) left++;
    let right = 0;
    while (right < w && colBlack(w - 1 - right)) right++;
    if (left === w) left = right = 0; // no column stands out: no side bars
    return { v: Math.min(top, bottom) / h, h: Math.min(left, right) / w };
  }

  function setCrop(next) {
    crop = next;
    if (!player) return;
    player.classList.toggle("pake-mini-cropped", !!crop);
    if (!crop) return;
    const cw = 1 - 2 * crop.h;
    const ch = 1 - 2 * crop.v;
    player.style.setProperty("--pake-mini-w", `${100 / cw}%`);
    player.style.setProperty("--pake-mini-h", `${100 / ch}%`);
    player.style.setProperty("--pake-mini-x", `${(-100 * crop.h) / cw}%`);
    player.style.setProperty("--pake-mini-y", `${(-100 * crop.v) / ch}%`);
  }

  function sameCrop(a, b) {
    if (!a || !b) return a === b;
    return Math.abs(a.v - b.v) < 0.005 && Math.abs(a.h - b.h) < 0.005;
  }

  function sampleBars() {
    const video = player && player.querySelector("video");
    if (!active || busy || !video || !video.videoWidth || video.readyState < 2) return;

    const data = player.getVideoData ? player.getVideoData() : null;
    const key = `${data && data.video_id}|${video.videoWidth}x${video.videoHeight}`;
    if (key !== cropKey) {
      cropKey = key;
      minBars = null;
      samples = 0;
      lastSampleTime = -1;
      if (crop) {
        setCrop(null);
        queueFit("area");
      }
    }
    // Only count distinct frames.
    if (Math.abs(video.currentTime - lastSampleTime) < 0.5) return;
    lastSampleTime = video.currentTime;

    let bars;
    try {
      bars = measureBars(video);
    } catch (error) {
      return;
    }
    if (!bars) return;
    minBars = minBars
      ? { v: Math.min(minBars.v, bars.v), h: Math.min(minBars.h, bars.h) }
      : bars;
    if (++samples < MIN_SAMPLES) return;

    // Trim one extra sample row/column so no dark edge line is left over.
    const v = minBars.v >= MIN_BAR ? Math.min(minBars.v + 1 / canvas.height, MAX_BAR) : 0;
    const h = minBars.h >= MIN_BAR ? Math.min(minBars.h + 1 / canvas.width, MAX_BAR) : 0;
    const next = v || h ? { v, h } : null;
    if (sameCrop(next, crop)) return;
    setCrop(next);
    queueFit("area");
  }
  setInterval(sampleBars, 1000);

  function workAreaOf(monitor) {
    return monitor.workArea || { position: monitor.position, size: monitor.size };
  }

  // Resize the window so its content matches the video's aspect ratio.
  // keep: "width" or "height" holds that side; "area" keeps roughly the
  // same size (used when the video itself changes shape).
  async function fitToVideo(keep) {
    if (!active) return;
    const ratio = videoAspect();
    const inner = await appWindow.innerSize();
    const outer = await appWindow.outerSize();
    const pos = await appWindow.outerPosition();

    let w = inner.width;
    let h = inner.height;
    if (keep === "width") h = w / ratio;
    else if (keep === "height") w = h * ratio;
    else {
      w = Math.sqrt(inner.width * inner.height * ratio);
      h = w / ratio;
    }

    const monitor = await tauri.window.currentMonitor();
    const area = monitor && workAreaOf(monitor);
    const frameW = outer.width - inner.width;
    const frameH = outer.height - inner.height;
    if (area) {
      const k = Math.min(
        1,
        (area.size.width - frameW) / w,
        (area.size.height - frameH) / h,
      );
      w *= k;
      h *= k;
    }
    w = Math.round(w);
    h = Math.round(h);
    const sameSize = Math.abs(w - inner.width) <= 1 && Math.abs(h - inner.height) <= 1;
    if (sameSize) {
      w = inner.width;
      h = inner.height;
    }

    let x = pos.x;
    let y = pos.y;
    if (area && lockedCorner) {
      ({ x, y } = cornerPosition(lockedCorner, area, w, h, frameW, frameH));
    } else if (area && !sameSize) {
      // Keep the edges nearest the screen's corner in place, so a miniplayer
      // parked bottom-right stays there.
      const right = area.position.x + area.size.width;
      const bottom = area.position.y + area.size.height;
      if (pos.x + outer.width / 2 > area.position.x + area.size.width / 2) {
        x = pos.x + inner.width - w;
      }
      if (pos.y + outer.height / 2 > area.position.y + area.size.height / 2) {
        y = pos.y + inner.height - h;
      }
      // Invisible resize borders may hang off-screen, the visible window may not.
      x = Math.min(Math.max(x, area.position.x - frameW / 2), right - w - frameW / 2);
      y = Math.min(Math.max(y, area.position.y), bottom - h - frameH);
      x = Math.round(x);
      y = Math.round(y);
    }

    if (!sameSize) await appWindow.setSize(new dpi.PhysicalSize(w, h));
    if (x !== pos.x || y !== pos.y) {
      await appWindow.setPosition(new dpi.PhysicalPosition(x, y));
    }
  }

  // Corner lock: the window's outer corner stays flush with a screen corner
  // through resizes and video changes.
  const CORNER_KEY = "pake-mini-corner";
  const GRIP_FOR = {
    "top-left": "SouthEast",
    "top-right": "SouthWest",
    "bottom-left": "NorthEast",
    "bottom-right": "NorthWest",
  };
  let lockedCorner = null;
  try {
    lockedCorner = localStorage.getItem(CORNER_KEY);
  } catch (error) {}
  if (!GRIP_FOR[lockedCorner]) lockedCorner = null;

  // Outer position that puts the visible window flush in the corner. The
  // undecorated window has invisible resize borders on the left, right and
  // bottom, and a thin one on top.
  function cornerPosition(corner, area, w, h, frameW, frameH) {
    const side = frameW / 2;
    const top = frameH - side;
    const x = corner.endsWith("left")
      ? area.position.x - side
      : area.position.x + area.size.width - w - side;
    const y = corner.startsWith("top")
      ? area.position.y - top
      : area.position.y + area.size.height - h - top;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function applyLockUi() {
    const root = document.documentElement;
    root.classList.toggle("pake-mini-locked", !!lockedCorner);
    root.dataset.pakeGrip = lockedCorner ? GRIP_FOR[lockedCorner] : "SouthEast";
  }

  function setLockedCorner(corner) {
    lockedCorner = corner;
    try {
      if (corner) localStorage.setItem(CORNER_KEY, corner);
      else localStorage.removeItem(CORNER_KEY);
    } catch (error) {}
    applyLockUi();
  }

  async function nearestCorner() {
    const monitor = await tauri.window.currentMonitor();
    if (!monitor) return "bottom-right";
    const area = workAreaOf(monitor);
    const pos = await appWindow.outerPosition();
    const outer = await appWindow.outerSize();
    const vertical =
      pos.y + outer.height / 2 < area.position.y + area.size.height / 2 ? "top" : "bottom";
    const horizontal =
      pos.x + outer.width / 2 < area.position.x + area.size.width / 2 ? "left" : "right";
    return `${vertical}-${horizontal}`;
  }

  async function lockToNearestCorner() {
    setLockedCorner(await nearestCorner());
    await queueFit("width");
  }
  applyLockUi();

  // Right-click menu (mini mode only; replaces YouTube's player menu there).
  const CORNER_ICON = {
    "top-left": "◰",
    "top-right": "◳",
    "bottom-left": "◱",
    "bottom-right": "◲",
  };
  const menu = document.createElement("div");
  menu.id = "pake-mini-menu";
  document.body.appendChild(menu);

  function menuItem(icon, label, action) {
    const item = document.createElement("div");
    item.className = "pake-mini-item";
    const iconEl = document.createElement("span");
    iconEl.className = "pake-mini-icon";
    iconEl.textContent = icon;
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    item.append(iconEl, labelEl);
    item.addEventListener("click", () => {
      closeMenu();
      action();
    });
    return item;
  }

  function openMenu(clientX, clientY) {
    const separator = document.createElement("div");
    separator.className = "pake-mini-sep";
    const lockItem = lockedCorner
      ? menuItem(
          CORNER_ICON[lockedCorner],
          `Unlock from ${lockedCorner.replace("-", " ")}`,
          () => setLockedCorner(null),
        )
      : menuItem("◲", "Lock to corner", () => {
          lockToNearestCorner().catch((error) =>
            console.error("[pake-miniplayer]", error),
          );
        });
    const items = [lockItem];
    // download.js (yt-dlp) is optional; offer it when it's loaded.
    if (window.__PAKE_DOWNLOAD_CURRENT__) {
      items.push(menuItem("↓", "Download video", window.__PAKE_DOWNLOAD_CURRENT__));
    }
    menu.replaceChildren(
      ...items,
      separator,
      menuItem("❐", "Back to full window", toggle),
    );
    if (!lockedCorner) {
      // Show which corner it would lock to.
      nearestCorner().then((corner) => {
        lockItem.firstChild.textContent = CORNER_ICON[corner];
      });
    }
    menu.classList.add("open");
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(2, Math.min(clientX, window.innerWidth - rect.width - 2))}px`;
    menu.style.top = `${Math.max(2, Math.min(clientY, window.innerHeight - rect.height - 2))}px`;
  }

  function closeMenu() {
    menu.classList.remove("open");
  }

  document.addEventListener(
    "contextmenu",
    (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openMenu(e.clientX, e.clientY);
    },
    true,
  );
  document.addEventListener(
    "mousedown",
    (e) => {
      if (menu.classList.contains("open") && !menu.contains(e.target)) closeMenu();
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
  window.addEventListener("blur", closeMenu);

  function queueFit(keep) {
    fitting = fitting
      .then(() => fitToVideo(keep))
      .catch((error) => console.error("[pake-miniplayer]", error))
      .then(() => {
        lastViewport = { w: window.innerWidth, h: window.innerHeight };
      });
    return fitting;
  }

  // After the user stops resizing, keep whichever side they changed most.
  window.addEventListener("resize", () => {
    if (!active || busy) return;
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      const prev = lastViewport || { w: window.innerWidth, h: window.innerHeight };
      const dw = Math.abs(window.innerWidth - prev.w) / prev.w;
      const dh = Math.abs(window.innerHeight - prev.h) / prev.h;
      queueFit(dw >= dh ? "width" : "height");
    }, SNAP_DELAY);
  });

  // A new video (or one that switches resolution) may have a different shape.
  document.addEventListener(
    "resize",
    (e) => {
      if (!active || busy || !player || e.target.tagName !== "VIDEO") return;
      if (player.contains(e.target)) queueFit("area");
    },
    true,
  );

  async function enter() {
    player = findPlayer();
    if (!player) return;

    const wasMaximized = await appWindow.isMaximized();
    if (wasMaximized) await appWindow.unmaximize();
    saved = {
      wasMaximized,
      position: await appWindow.outerPosition(),
      size: await appWindow.innerSize(),
    };

    document.documentElement.classList.add("pake-mini");
    player.classList.add("pake-mini-player");
    active = true;

    await appWindow.setDecorations(false);
    await appWindow.setShadow(true).catch(() => {});
    await appWindow.setMinSize(new dpi.LogicalSize(MIN_WIDTH, MIN_HEIGHT));
    // Same area as a 480x270 window, shaped like the video.
    const ratio = videoAspect();
    const miniWidth = Math.round(Math.sqrt(MINI_WIDTH * MINI_HEIGHT * ratio));
    await appWindow.setSize(
      new dpi.LogicalSize(miniWidth, Math.round(miniWidth / ratio)),
    );
    await appWindow.setAlwaysOnTop(true);

    // Park it in the locked corner, or just inside the bottom-right one.
    const monitor = await tauri.window.currentMonitor();
    if (monitor) {
      const scale = monitor.scaleFactor || 1;
      const area = workAreaOf(monitor);
      const outer = await appWindow.outerSize();
      const inner = await appWindow.innerSize();
      let x;
      let y;
      if (lockedCorner) {
        ({ x, y } = cornerPosition(
          lockedCorner,
          area,
          inner.width,
          inner.height,
          outer.width - inner.width,
          outer.height - inner.height,
        ));
      } else {
        const margin = Math.round(MARGIN * scale);
        x = area.position.x + area.size.width - outer.width - margin;
        y = area.position.y + area.size.height - outer.height - margin;
      }
      await appWindow.setPosition(new dpi.PhysicalPosition(x, y));
    }
    lastViewport = null;
    nudgeLayout();
    updateButton();
  }

  async function exit() {
    clearTimeout(snapTimer);
    await fitting;
    document.documentElement.classList.remove("pake-mini");
    cancelDrag();
    closeMenu();
    setCrop(null);
    if (player) player.classList.remove("pake-mini-player");
    player = null;
    active = false;

    await appWindow.setAlwaysOnTop(false);
    await appWindow.setMinSize(null);
    // tabs.js draws its own title bar, so the window stays undecorated.
    if (!window.__PAKE_CUSTOM_TITLEBAR__) await appWindow.setDecorations(true);
    if (saved) {
      await appWindow.setSize(
        new dpi.PhysicalSize(saved.size.width, saved.size.height),
      );
      await appWindow.setPosition(
        new dpi.PhysicalPosition(saved.position.x, saved.position.y),
      );
      if (saved.wasMaximized) await appWindow.maximize();
    }
    saved = null;
    appWindow.setFocus().catch(() => {});
    nudgeLayout();
    updateButton();
  }

  async function toggle() {
    if (busy) return;
    busy = true;
    try {
      if (active) await exit();
      else await enter();
    } catch (error) {
      console.error("[pake-miniplayer]", error);
    } finally {
      busy = false;
    }
  }
  window.__PAKE_MINIPLAYER_TOGGLE__ = toggle;

  // Player control bar button, re-added whenever YouTube rebuilds its controls.
  const ICON_MINI =
    "M25 17h-8v6h8v-6zm4 8V11c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H9V10.98h18v14.04z";
  const ICON_RESTORE =
    "M27 9H9c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V11c0-1.1-.9-2-2-2zm0 16H9V11h18v14zM12 14h12v8H12z";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function updateButton() {
    const btn = document.querySelector(".pake-mini-button");
    if (!btn) return;
    let path = btn.querySelector("path");
    if (!path) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 36 36");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("fill", "#fff");
      svg.appendChild(path);
      btn.appendChild(svg);
    }
    path.setAttribute("d", active ? ICON_RESTORE : ICON_MINI);
    const label = active
      ? "Exit always-on-top miniplayer (Ctrl+Shift+M)"
      : "Always-on-top miniplayer (Ctrl+Shift+M)";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function ensureButton() {
    const controls = document.querySelector("#movie_player .ytp-right-controls");
    if (!controls || controls.querySelector(".pake-mini-button")) return;
    const btn = document.createElement("button");
    btn.className = "ytp-button pake-mini-button";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    const fullscreen = controls.querySelector(".ytp-fullscreen-button");
    if (fullscreen) fullscreen.parentNode.insertBefore(btn, fullscreen);
    else controls.appendChild(btn);
    updateButton();
  }

  new MutationObserver(() => {
    ensureButton();
    // Leave mini mode if YouTube navigates somewhere without the player.
    if (active && !document.contains(player)) toggle();
  }).observe(document.body, { childList: true, subtree: true });
  ensureButton();

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyM") {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    },
    true,
  );
})();
