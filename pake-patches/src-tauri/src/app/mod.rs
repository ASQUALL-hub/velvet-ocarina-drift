#[cfg(target_os = "macos")]
pub mod auth;
#[cfg(any(target_os = "linux", test))]
pub mod color_scheme;
pub mod config;
pub mod invoke;
#[cfg(target_os = "macos")]
pub mod menu;
pub mod navigation;
pub mod extensions; // local patch: uBlock Origin Lite
pub mod notification;
pub mod passthrough; // local patch: miniplayer Caps Lock peek
pub mod setup;
#[cfg(target_os = "macos")]
pub mod tab_bar;
pub mod window;
