//! Stub for webdav_auto_sync — WebDAV auto-sync is a desktop-only feature
//! that requires a Tauri AppHandle to emit events.  The proxy daemon only
//! uses notify_db_changed() (called from the SQLite update hook), so we
//! provide a no-op implementation.

/// Called from the database update hook when a row is changed.
/// On the desktop this debounces and triggers a WebDAV sync;
/// here it does nothing.
pub fn notify_db_changed(_table: &str) {}
