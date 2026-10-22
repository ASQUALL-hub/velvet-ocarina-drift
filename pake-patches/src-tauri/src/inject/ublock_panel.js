// Local patch: chrome for the frameless uBlock Origin Lite window. Puts the
// window buttons at the end of uBlock's own tab row, so the tabs sit on the
// same line as minimise / maximise / close, and makes the row's empty space
// drag the window (with the miniplayer's easing) and maximise on double-click.
(function () {
  if (window.__UBLOCK_PANEL_CHROME__) return;
  window.__UBLOCK_PANEL_CHROME__ = true;

  // Tauri's permission system can't cover chrome-extension:// pages, so the
  // window actions go over WebView2's own message channel instead; the app
  // handles "pake-panel:<action>" for this window only (app::extensions).
  function send(action) {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(`pake-panel:${action}`);
    }
  }

  function setup() {
    const nav = document.getElementById("dashboard-nav");
    if (!nav) return;

    const style = document.createElement("style");
    style.textContent = `
      #dashboard-nav { flex-wrap: nowrap; align-items: stretch; user-select: none; }
      .panel-controls { display: flex; margin-left: auto; flex: none; }
      .panel-controls button {
        width: 46px;
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--dashboard-tab-ink, #e8e8e8);
        font: 10px/1 "Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif;
        cursor: default;
      }
      .panel-controls button:focus { outline: none; }
      .panel-controls button:hover { background: rgba(255, 255, 255, 0.1); }
      .panel-controls button.close:hover { background: #c42b1c; color: #fff; }
    `;
    document.head.appendChild(style);

    const controls = document.createElement("div");
    controls.className = "panel-controls";
    const make = (cls, glyph, title, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = cls;
      button.textContent = glyph;
      button.title = title;
      button.addEventListener("click", action);
      controls.appendChild(button);
      return button;
    };
    make("min", "", "Minimise", () => send("minimize"));
    const max = make("max", "", "Maximise", () => send("maximize"));
    make("close", "", "Close", () => send("close"));
    nav.appendChild(controls);

    // The app reports the maximised state back after any change.
    window.__pakePanelMaximized = (maximized) => {
      max.textContent = maximized ? "" : "";
      max.title = maximized ? "Restore Down" : "Maximise";
    };
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => send("state"), 150);
    });

    // Empty space in the row (not a tab or a window button) moves the window.
    nav.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".tabButton, .panel-controls")) return;
      e.preventDefault();
      send(e.detail === 2 ? "maximize" : "drag");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
