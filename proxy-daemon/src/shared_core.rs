//! Temporary bridge to shared Rust code that still lives under `src-tauri/src/`.
//!
//! The long-term goal is to replace these path-based re-exports with a real
//! shared crate. Keeping them in one module localizes the coupling and makes
//! the next extraction step smaller.

#[path = "../../src-tauri/src/codex_config.rs"]
pub mod codex_config;

#[path = "../../src-tauri/src/database/mod.rs"]
pub mod database;

#[path = "../../src-tauri/src/gemini_config.rs"]
pub mod gemini_config;

#[path = "../../src-tauri/src/openclaw_config.rs"]
pub mod openclaw_config;

#[path = "../../src-tauri/src/opencode_config.rs"]
pub mod opencode_config;

#[path = "../../src-tauri/src/prompt_files.rs"]
pub mod prompt_files;

#[path = "../../src-tauri/src/proxy/mod.rs"]
pub mod proxy;

#[path = "../../src-tauri/src/usage_script.rs"]
pub mod usage_script;
