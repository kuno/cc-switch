//! Temporary bridge to shared Rust code that still lives under `src-tauri/src/`.
//!
//! The long-term goal is to replace these path-based re-exports with a real
//! shared crate. Keeping them in one module localizes the coupling and makes
//! the next extraction step smaller.

#[path = "../../src-tauri/src/database/mod.rs"]
pub mod database;

#[path = "../../src-tauri/src/proxy/mod.rs"]
pub mod proxy;
