//! Local patch: bundled uBlock Origin Lite, kept up to date from its official
//! GitHub releases, plus a small window for its panel.
//!
//! Extensions load from %APPDATA%\<app id>\extensions (WebView2 loads every
//! folder there). The installer ships a copy that seeds it on first run. A
//! background check downloads newer releases into a staging folder, which is
//! swapped in on the next launch (files can't be replaced while in use).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const EXT_DIR: &str = "ublock";
const RELEASES_API: &str = "https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest";
const DOWNLOAD_PREFIX: &str = "https://github.com/uBlockOrigin/uBOL-home/releases/download/";
const FIRST_CHECK: Duration = Duration::from_secs(20);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const PANEL_LABEL: &str = "ublock";

/// The main webview's profile folder and engine arguments: the panel window
/// must match them to share the profile the extension is installed in.
static PROFILE: OnceLock<(PathBuf, String)> = OnceLock::new();

pub fn remember_profile(data_dir: PathBuf, browser_args: String) {
    let _ = PROFILE.set((data_dir, browser_args));
}

fn base_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

fn read_version(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("manifest.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("version")?.as_str().map(str::to_owned)
}

fn version_parts(v: &str) -> Vec<u64> {
    v.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Version last registered with WebView2 (kept outside the extensions folder:
/// WebView2 tries to load every entry in that folder as an extension).
fn installed_marker(base: &Path) -> PathBuf {
    base.join("ublock-registered.txt")
}

/// Before the main window is created: apply a staged update, or seed from the
/// bundled copy. Returns the extensions folder and whether it must be
/// (re)registered with WebView2. Registering is only done when needed:
/// registering while the first page loads stalls that page, and an
/// installed extension stays in the profile across launches anyway.
pub fn prepare(app: &AppHandle) -> Option<(PathBuf, bool)> {
    let root = prepare_files(app)?;
    let base = base_dir(app)?;
    let active = read_version(&root.join(EXT_DIR))?;
    let registered = std::fs::read_to_string(installed_marker(&base)).unwrap_or_default();
    Some((root, registered.trim() != active))
}

/// After the main window exists. If we registered the extension, record it
/// and reload the first page should it stall; otherwise make sure the
/// extension really is in the profile, and register it now if not.
pub fn after_main_window(app: &AppHandle, window: &WebviewWindow, registered_now: bool) {
    let Some(base) = base_dir(app) else { return };
    let active_dir = base.join("extensions").join(EXT_DIR);
    let Some(version) = read_version(&active_dir) else { return };
    let window = window.clone();
    std::thread::spawn(move || {
        let mut registered = registered_now;
        if !registered {
            std::thread::sleep(Duration::from_secs(3));
            if extension_id(&window).is_err() {
                registered = register_now(&window, &active_dir).is_ok();
            }
        }
        if registered {
            let _ = std::fs::write(installed_marker(&base), &version);
            std::thread::sleep(Duration::from_secs(12));
            let _ = window.eval("if (document.readyState === 'loading') location.reload();");
        }
    });
}

#[cfg(target_os = "windows")]
fn register_now(window: &WebviewWindow, dir: &Path) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile7, ICoreWebView2_13};
    use webview2_com::ProfileAddBrowserExtensionCompletedHandler;
    use windows_core::{Interface, HSTRING};

    let path = HSTRING::from(dir.as_os_str());
    window
        .with_webview(move |webview| unsafe {
            let result = (|| -> windows_core::Result<()> {
                let profile = webview
                    .controller()
                    .CoreWebView2()?
                    .cast::<ICoreWebView2_13>()?
                    .Profile()?
                    .cast::<ICoreWebView2Profile7>()?;
                let handler =
                    ProfileAddBrowserExtensionCompletedHandler::create(Box::new(|_, _| Ok(())));
                profile.AddBrowserExtension(&path, &handler)
            })();
            if let Err(error) = result {
                eprintln!("[Pake] Could not register uBlock Origin Lite: {error}");
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn register_now(_window: &WebviewWindow, _dir: &Path) -> Result<(), String> {
    Err("not supported on this platform".into())
}

fn prepare_files(app: &AppHandle) -> Option<PathBuf> {
    let base = base_dir(app)?;
    let root = base.join("extensions");
    let active = root.join(EXT_DIR);
    let staged = base.join("extensions-staged").join(EXT_DIR);

    if read_version(&staged).is_some() {
        let _ = std::fs::remove_dir_all(&active);
        let _ = std::fs::create_dir_all(&root);
        if std::fs::rename(&staged, &active).is_err() {
            let _ = copy_dir(&staged, &active);
            let _ = std::fs::remove_dir_all(&staged);
        }
    }
    if read_version(&active).is_none() {
        if let Ok(resources) = app.path().resource_dir() {
            let bundled = resources.join("extensions").join(EXT_DIR);
            if read_version(&bundled).is_some() {
                let _ = std::fs::remove_dir_all(&active);
                let _ = copy_dir(&bundled, &active);
            }
        }
    }
    read_version(&active).map(|_| root)
}

/// Run a Windows tool without flashing a console window.
fn run(program: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command.output().map_err(|e| format!("{program}: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

fn system_tool(name: &str) -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    format!("{root}\\System32\\{name}")
}

/// One update check: stage a newer release if there is one.
fn check_for_update(app: &AppHandle) -> Result<String, String> {
    let base = base_dir(app).ok_or("no app data folder")?;
    let installed = read_version(&base.join("extensions").join(EXT_DIR)).unwrap_or_default();
    let staged_root = base.join("extensions-staged");
    if let Some(staged) = read_version(&staged_root.join(EXT_DIR)) {
        return Ok(format!("{staged} downloaded, applies on next launch"));
    }

    let curl = system_tool("curl.exe");
    let body = run(
        &curl,
        &["-sSL", "--max-time", "30", "-H", "User-Agent: youtube-desktop-app", RELEASES_API],
    )?;
    let release: serde_json::Value =
        serde_json::from_slice(&body).map_err(|e| format!("bad release info: {e}"))?;
    let latest = release["tag_name"].as_str().ok_or("no tag_name")?.to_owned();
    if !installed.is_empty() && version_parts(&latest) <= version_parts(&installed) {
        return Ok(format!("{installed} is up to date"));
    }
    let url = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find_map(|a| {
                let name = a["name"].as_str()?;
                let url = a["browser_download_url"].as_str()?;
                (name.ends_with(".edge.zip") && url.starts_with(DOWNLOAD_PREFIX)).then(|| url.to_owned())
            })
        })
        .ok_or("no Edge build in the latest release")?;

    let zip = base.join("ublock-download.zip");
    let unpacked = base.join("ublock-download");
    let _ = std::fs::remove_dir_all(&unpacked);
    std::fs::create_dir_all(&unpacked).map_err(|e| e.to_string())?;
    let zip_str = zip.to_string_lossy().to_string();
    let unpacked_str = unpacked.to_string_lossy().to_string();
    run(&curl, &["-sSL", "--max-time", "300", "-o", &zip_str, &url])?;
    run(&system_tool("tar.exe"), &["-xf", &zip_str, "-C", &unpacked_str])?;
    let _ = std::fs::remove_file(&zip);

    if read_version(&unpacked).as_deref() != Some(latest.as_str()) {
        let _ = std::fs::remove_dir_all(&unpacked);
        return Err("downloaded package doesn't match the release".into());
    }
    let _ = std::fs::remove_dir_all(&staged_root);
    std::fs::create_dir_all(&staged_root).map_err(|e| e.to_string())?;
    std::fs::rename(&unpacked, staged_root.join(EXT_DIR)).map_err(|e| e.to_string())?;
    Ok(format!("{latest} downloaded, applies on next launch"))
}

static LAST_CHECK: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

pub fn spawn_updater(app: AppHandle) {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK);
        loop {
            let result = check_for_update(&app).unwrap_or_else(|e| format!("check failed: {e}"));
            if let Ok(mut last) = LAST_CHECK.lock() {
                *last = result;
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

/// Installed version and the last update check, for the button's tooltip.
#[tauri::command]
pub fn ublock_status(app: AppHandle) -> String {
    let installed = base_dir(&app)
        .and_then(|b| read_version(&b.join("extensions").join(EXT_DIR)))
        .unwrap_or_else(|| "not installed".into());
    let last = LAST_CHECK.lock().map(|l| l.clone()).unwrap_or_default();
    if last.is_empty() {
        format!("uBlock Origin Lite {installed}")
    } else {
        format!("uBlock Origin Lite {installed} ({last})")
    }
}

/// The extension's ID in the main webview's profile.
#[cfg(target_os = "windows")]
fn extension_id(window: &WebviewWindow) -> Result<String, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile7, ICoreWebView2_13};
    use webview2_com::{take_pwstr, ProfileGetBrowserExtensionsCompletedHandler};
    use windows_core::{Interface, PWSTR};

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    window
        .with_webview(move |webview| unsafe {
            let reply = tx.clone();
            let started = (|| -> windows_core::Result<()> {
                let profile = webview
                    .controller()
                    .CoreWebView2()?
                    .cast::<ICoreWebView2_13>()?
                    .Profile()?
                    .cast::<ICoreWebView2Profile7>()?;
                let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
                    move |result, list| {
                        let mut found = Err("uBlock Origin Lite isn't loaded".to_string());
                        if result.is_ok() {
                            if let Some(list) = list {
                                let mut count = 0u32;
                                list.Count(&mut count)?;
                                for i in 0..count {
                                    let ext = list.GetValueAtIndex(i)?;
                                    let mut id = PWSTR::null();
                                    let mut name = PWSTR::null();
                                    ext.Id(&mut id)?;
                                    ext.Name(&mut name)?;
                                    let (id, name) = (take_pwstr(id), take_pwstr(name));
                                    if name.to_lowercase().contains("ublock") {
                                        found = Ok(id);
                                        break;
                                    }
                                }
                            }
                        }
                        let _ = reply.send(found);
                        Ok(())
                    },
                ));
                profile.GetBrowserExtensions(&handler)
            })();
            if let Err(error) = started {
                let _ = tx.send(Err(error.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "timed out looking up the extension".to_string())?
}

#[cfg(not(target_os = "windows"))]
fn extension_id(_window: &WebviewWindow) -> Result<String, String> {
    Err("not supported on this platform".into())
}

/// Open (or focus) the uBlock Origin Lite panel in a small window.
#[tauri::command]
pub async fn open_ublock_panel(app: AppHandle) -> Result<(), String> {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.unminimize();
        let _ = panel.show();
        let _ = panel.set_focus();
        return Ok(());
    }
    let main = app.get_webview_window("pake").ok_or("main window not found")?;
    let id = extension_id(&main)?;
    let (data_dir, browser_args) = PROFILE.get().cloned().ok_or("profile not ready")?;
    let url = Url::parse(&format!("chrome-extension://{id}/dashboard.html")).map_err(|e| e.to_string())?;
    let on_top = main.is_always_on_top().unwrap_or(false);
    // Frameless: inject/ublock_panel.js puts the window buttons into uBlock's
    // own tab row. Built hidden, then given a dark border and placed as a
    // drop-down under the U button, at the main window's top-right.
    let panel = WebviewWindowBuilder::new(&app, PANEL_LABEL, WebviewUrl::External(url))
        .title("uBlock Origin Lite")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .min_inner_size(420.0, 400.0)
        .visible(false)
        .decorations(false)
        .shadow(true)
        .resizable(true)
        .always_on_top(on_top)
        .theme(Some(tauri::Theme::Dark)) // uBlock's dashboard follows it
        .initialization_script(include_str!("../inject/ublock_panel.js"))
        .data_directory(data_dir)
        .additional_browser_args(&browser_args)
        .browser_extensions_enabled(true)
        .build()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        dark_title_bar(&panel);
        listen_to_panel(&panel);
    }
    place_under_button(&main, &panel);
    let _ = panel.show();
    let _ = panel.set_focus();
    Ok(())
}

const PANEL_WIDTH: f64 = 600.0;
const PANEL_HEIGHT: f64 = 640.0;

/// Window controls for the frameless panel. Tauri's permission patterns
/// can't match chrome-extension:// pages, so uBlock's page can't use Tauri's
/// window API; instead ublock_panel.js sends plain WebView2 messages
/// ("pake-panel:<action>") on this window only, handled here. Anything else
/// is ignored (Tauri's own IPC messages on the same channel are left alone).
#[cfg(target_os = "windows")]
fn listen_to_panel(panel: &WebviewWindow) {
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows_core::PWSTR;

    let window = panel.clone();
    let _ = panel.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut message = PWSTR::null();
                if args.TryGetWebMessageAsString(&mut message).is_ok() {
                    let message = take_pwstr(message);
                    if let Some(action) = message.strip_prefix("pake-panel:") {
                        let (window, action) = (window.clone(), action.to_owned());
                        // Off the UI thread: window calls may wait on it.
                        std::thread::spawn(move || panel_action(&window, &action));
                    }
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}

#[cfg(target_os = "windows")]
fn panel_action(window: &WebviewWindow, action: &str) {
    match action {
        "minimize" => {
            let _ = window.minimize();
        }
        "maximize" => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
        }
        "close" => {
            let _ = window.close();
        }
        "drag" => {
            if let Ok(hwnd) = window.hwnd() {
                eased_drag::start(hwnd.0 as isize);
            }
            return;
        }
        "state" => {}
        _ => return,
    }
    // Tell the page whether the window is maximised (for the button icon).
    std::thread::sleep(Duration::from_millis(120));
    let maximized = window.is_maximized().unwrap_or(false);
    let _ = window.eval(format!(
        "window.__pakePanelMaximized && window.__pakePanelMaximized({maximized})"
    ));
}

/// Right-aligned to the main window, just below its title bar; kept on the
/// main window's monitor.
fn place_under_button(main: &WebviewWindow, panel: &WebviewWindow) {
    use tauri::PhysicalPosition;
    let (Ok(pos), Ok(size), Ok(scale), Ok(panel_size)) = (
        main.outer_position(),
        main.outer_size(),
        main.scale_factor(),
        panel.outer_size(),
    ) else {
        return;
    };
    let margin = (8.0 * scale) as i32;
    let mut x = pos.x + size.width as i32 - panel_size.width as i32 - margin;
    let mut y = pos.y + (40.0 * scale) as i32;
    if let Ok(Some(monitor)) = main.current_monitor() {
        let area = monitor.work_area();
        let (left, top) = (area.position.x, area.position.y);
        let right = left + area.size.width as i32 - panel_size.width as i32;
        let bottom = top + area.size.height as i32 - panel_size.height as i32;
        x = x.clamp(left, right.max(left));
        y = y.clamp(top, bottom.max(top));
    }
    let _ = panel.set_position(PhysicalPosition::new(x, y));
}

/// Eased dragging for the panel, like the miniplayer's: started from its tab
/// row, the window glides after the cursor (instead of Windows' instant move)
/// and settles once the mouse button is released.
#[cfg(target_os = "windows")]
mod eased_drag {
    use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetSystemMetrics, GetWindowRect, SetWindowPos, SM_SWAPBUTTON,
        SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    };

    /// Smoothing time constant; matches DRAG_EASE_MS in miniplayer.js.
    const EASE_MS: f64 = 70.0;
    static DRAGGING: AtomicBool = AtomicBool::new(false);

    pub fn start(handle: isize) {
        if DRAGGING.swap(true, SeqCst) {
            return;
        }
        std::thread::spawn(move || glide(handle));
    }

    fn glide(handle: isize) {
        let hwnd = handle as HWND;
        unsafe {
            let button = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
            let mut cursor = POINT { x: 0, y: 0 };
            let mut rect: RECT = std::mem::zeroed();
            GetCursorPos(&mut cursor);
            GetWindowRect(hwnd, &mut rect);
            let (grab_x, grab_y) = (cursor.x - rect.left, cursor.y - rect.top);
            let (mut x, mut y) = (rect.left as f64, rect.top as f64);
            let (mut target_x, mut target_y) = (x, y);
            let (mut sent_x, mut sent_y) = (rect.left, rect.top);
            let mut held = true;
            let mut last = Instant::now();
            loop {
                std::thread::sleep(Duration::from_millis(7));
                let now = Instant::now();
                let dt = (now - last).as_secs_f64().min(0.1) * 1000.0;
                last = now;
                if held {
                    GetCursorPos(&mut cursor);
                    target_x = (cursor.x - grab_x) as f64;
                    target_y = (cursor.y - grab_y) as f64;
                    held = (GetAsyncKeyState(button as i32) as u16 & 0x8000) != 0;
                }
                let k = 1.0 - (-dt / EASE_MS).exp();
                x += (target_x - x) * k;
                y += (target_y - y) * k;
                let settled = !held && (target_x - x).abs() < 0.5 && (target_y - y).abs() < 0.5;
                if settled {
                    x = target_x;
                    y = target_y;
                }
                let (rx, ry) = (x.round() as i32, y.round() as i32);
                if (rx, ry) != (sent_x, sent_y) {
                    SetWindowPos(
                        hwnd,
                        std::ptr::null_mut(),
                        rx,
                        ry,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                    sent_x = rx;
                    sent_y = ry;
                }
                if settled {
                    break;
                }
            }
        }
        DRAGGING.store(false, SeqCst);
    }
}

/// Dark frame for the (frameless) panel: a subtle border matching uBlock's
/// dark dashboard instead of the Windows accent colour.
#[cfg(target_os = "windows")]
fn dark_title_bar(window: &WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0 as HWND;
    // COLORREF is 0x00BBGGRR.
    let settings: [(i32, u32); 2] = [
        (DWMWA_USE_IMMERSIVE_DARK_MODE, 1),
        (DWMWA_BORDER_COLOR, 0x0036_2A2A), // rgb(42, 42, 54)
    ];
    for (attribute, value) in settings {
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute as u32,
                &value as *const u32 as *const core::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}
