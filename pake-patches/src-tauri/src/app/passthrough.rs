//! Local patch: miniplayer "peek" mode. While the miniplayer is open
//! (armed), holding Caps Lock makes the window see-through and click-through
//! so the app underneath can be used; releasing Caps Lock restores it.
//! A low-level keyboard hook claims Caps Lock while armed, so the key never
//! reaches other apps and never toggles the caps state.
//!
//! The hook runs on its own thread with its own message loop: Windows only
//! calls a low-level hook while its thread is pumping messages, and silently
//! skips (and eventually drops) hooks that answer slowly, so it must not
//! share the busy UI thread. The hook itself only posts a message; the
//! window changes happen afterwards in the same loop.

use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering::SeqCst};
    use std::sync::mpsc;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{GetLastError, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, GetWindowLongPtrW, PostThreadMessageW,
        SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowsHookExW, UnhookWindowsHookEx,
        GWLP_HINSTANCE, GWL_EXSTYLE, KBDLLHOOKSTRUCT, LWA_ALPHA, MSG, WH_KEYBOARD_LL, WM_APP,
        WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP, WS_EX_LAYERED,
        WS_EX_TRANSPARENT,
    };

    const VK_CAPITAL: u32 = 0x14;
    /// Opacity while peeking (0-255): about 30%.
    const PEEK_ALPHA: u8 = 77;
    /// Posted from the hook to the hook thread; wParam 1 = start, 0 = stop.
    const WM_PEEK: u32 = WM_APP + 1;

    static WINDOW: AtomicIsize = AtomicIsize::new(0);
    static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
    static PEEKING: AtomicBool = AtomicBool::new(false);
    static SAVED_EX_STYLE: AtomicIsize = AtomicIsize::new(0);
    // Diagnostics, reported when disarming.
    static CAPS_EVENTS: AtomicU32 = AtomicU32::new(0);
    static PEEK_CHANGES: AtomicU32 = AtomicU32::new(0);

    pub fn set_peek(on: bool) {
        let hwnd = WINDOW.load(SeqCst) as HWND;
        if hwnd.is_null() || PEEKING.swap(on, SeqCst) == on {
            return;
        }
        PEEK_CHANGES.fetch_add(1, SeqCst);
        unsafe {
            if on {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SAVED_EX_STYLE.store(ex, SeqCst);
                let peek = ex | (WS_EX_LAYERED | WS_EX_TRANSPARENT) as isize;
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, peek);
                SetLayeredWindowAttributes(hwnd, 0, PEEK_ALPHA, LWA_ALPHA);
            } else {
                SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, SAVED_EX_STYLE.load(SeqCst));
            }
        }
    }

    // Must answer fast: it only claims the key and posts to the hook thread.
    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = &*(lparam as *const KBDLLHOOKSTRUCT);
            if info.vkCode == VK_CAPITAL {
                CAPS_EVENTS.fetch_add(1, SeqCst);
                let start = match wparam as u32 {
                    WM_KEYDOWN | WM_SYSKEYDOWN => Some(1),
                    WM_KEYUP | WM_SYSKEYUP => Some(0),
                    _ => None,
                };
                if let Some(start) = start {
                    PostThreadMessageW(HOOK_THREAD.load(SeqCst), WM_PEEK, start, 0);
                }
                return 1; // claimed: never reaches other apps, never toggles caps
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    /// Page path: when YouTube itself is in front, the hook isn't called and
    /// the page sees Caps Lock instead, so it starts/stops the peek here. The
    /// key then also toggled caps; on start, send key-up + key-down to toggle
    /// it straight back while leaving the key logically held (the page
    /// ignores those two events), so the real key-up later toggles nothing.
    pub fn peek_from_page(on: bool) {
        if HOOK_THREAD.load(SeqCst) == 0 {
            return; // not armed (miniplayer closed)
        }
        set_peek(on);
        if on {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP};
            unsafe {
                keybd_event(VK_CAPITAL as u8, 0x3A, KEYEVENTF_KEYUP, 0);
                keybd_event(VK_CAPITAL as u8, 0x3A, 0, 0);
            }
        }
    }

    pub fn arm(hwnd: isize) -> Result<String, String> {
        WINDOW.store(hwnd, SeqCst);
        if HOOK_THREAD.load(SeqCst) != 0 {
            return Ok("hook already running".into());
        }
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::spawn(move || unsafe {
            let module = GetWindowLongPtrW(hwnd as HWND, GWLP_HINSTANCE) as HINSTANCE;
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0);
            if hook.is_null() {
                let _ = ready_tx.send(Err(GetLastError()));
                return;
            }
            HOOK_THREAD.store(GetCurrentThreadId(), SeqCst);
            let _ = ready_tx.send(Ok(()));
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                if msg.message == WM_PEEK {
                    set_peek(msg.wParam != 0);
                }
            }
            UnhookWindowsHookEx(hook);
            HOOK_THREAD.store(0, SeqCst);
        });
        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => Ok("hook installed".into()),
            Ok(Err(code)) => Err(format!("SetWindowsHookExW failed (error {code})")),
            Err(_) => Err("hook thread did not start".into()),
        }
    }

    pub fn disarm() -> Result<String, String> {
        set_peek(false);
        let thread = HOOK_THREAD.load(SeqCst);
        if thread != 0 {
            unsafe {
                PostThreadMessageW(thread, WM_QUIT, 0, 0);
            }
            // Wait briefly so an immediate re-arm starts a fresh hook thread.
            for _ in 0..50 {
                if HOOK_THREAD.load(SeqCst) == 0 {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        Ok(format!(
            "hook removed (caps events seen: {}, peek changes: {})",
            CAPS_EVENTS.swap(0, SeqCst),
            PEEK_CHANGES.swap(0, SeqCst)
        ))
    }
}

/// Start/stop peeking from the page (YouTube itself in front; see
/// `peek_from_page`). Only acts while armed.
#[tauri::command]
pub fn mini_peek_from_page(on: bool) {
    #[cfg(target_os = "windows")]
    imp::peek_from_page(on);
    #[cfg(not(target_os = "windows"))]
    let _ = on;
}

/// Arm (miniplayer opened) or disarm (miniplayer closed) Caps Lock peeking.
/// Returns what happened, for diagnostics.
#[tauri::command]
pub fn set_mini_peek_armed<R: Runtime>(
    window: WebviewWindow<R>,
    armed: bool,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        if armed {
            imp::arm(hwnd)
        } else {
            imp::disarm()
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, armed);
        Ok("not supported on this platform".into())
    }
}
