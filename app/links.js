// Sends non-YouTube links to the default browser for the Pake-built YouTube app.
// YouTube wraps outside links as youtube.com/redirect?q=<url>, which Pake's own
// policy treats as internal; unwrap those and open anything that isn't YouTube
// externally. Google sign-in pages stay in the app so logging in still works.
// Injected by Pake inside a DOMContentLoaded handler.
(function () {
  if (window.__PAKE_LINKS__) return;
  window.__PAKE_LINKS__ = true;

  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core) return;
  const { invoke } = tauri.core;

  // Only YouTube itself (not Studio, Music, etc.) and Google sign-in stay in the
  // app; this matches is_allowed_in_app in the patched pake-cli window.rs, which
  // also blocks any other top-level navigation that gets past these handlers.
  const YOUTUBE_HOST = /^((www|m)\.)?youtube\.com$|^youtu\.be$/i;
  const SIGN_IN_HOST = /^(accounts\.google\.com|accounts\.youtube\.com|consent\.google\.com|consent\.youtube\.com|gds\.google\.com)$/i;

  function isYouTube(url) {
    return YOUTUBE_HOST.test(url.hostname) || SIGN_IN_HOST.test(url.hostname);
  }

  // The URL to open in the browser, or null to leave the link alone.
  function externalUrl(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch (error) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (YOUTUBE_HOST.test(url.hostname) && url.pathname === "/redirect") {
      const target = url.searchParams.get("q");
      if (!target) return null;
      try {
        url = new URL(target);
      } catch (error) {
        return null;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    }
    return isYouTube(url) ? null : url.href;
  }

  function openExternally(href) {
    invoke("plugin:shell|open", { path: href }).catch((error) =>
      console.error("[pake-links]", error),
    );
  }

  function onLinkActivate(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const link = e.target.closest && e.target.closest("a[href]");
    if (!link || link.hasAttribute("download")) return;
    const href = externalUrl(link.href);
    if (!href) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openExternally(href);
  }
  window.addEventListener("click", onLinkActivate, true);
  window.addEventListener("auxclick", onLinkActivate, true);
  // Middle-click: stop the autoscroll cursor on external links too.
  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 1) return;
      const link = e.target.closest && e.target.closest("a[href]");
      if (link && externalUrl(link.href)) e.preventDefault();
    },
    true,
  );

  // Pop-ups (share buttons and the like) go through window.open.
  const previousOpen = window.open;
  window.open = function (url, ...rest) {
    const href = url ? externalUrl(String(url)) : null;
    if (href) {
      openExternally(href);
      return null;
    }
    return previousOpen.call(this, url, ...rest);
  };
})();
