//! Unsupported Hermes shim for proxy-daemon.
//!
//! The router daemon must compile against shared provider code that now knows
//! about Hermes, but OpenWrt does not manage Hermes providers. Keep this shim
//! isolated from any real desktop Hermes config and fail explicitly if a write
//! path is reached.

use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::config::get_app_config_dir;
use crate::error::AppError;

fn unsupported_error() -> AppError {
    AppError::localized(
        "hermes.unsupported.proxy_daemon",
        "proxy-daemon 不支持 Hermes",
        "Hermes is not supported in proxy-daemon",
    )
}

pub fn get_hermes_dir() -> PathBuf {
    get_app_config_dir().join("unsupported-hermes")
}

pub fn get_hermes_config_path() -> PathBuf {
    get_hermes_dir().join("config.yaml")
}

pub fn get_providers() -> Result<Map<String, Value>, AppError> {
    Ok(Map::new())
}

pub fn set_provider(_name: &str, _provider_config: Value) -> Result<(), AppError> {
    Err(unsupported_error())
}

pub fn read_hermes_config() -> Result<serde_yaml::Value, AppError> {
    Err(unsupported_error())
}

pub fn yaml_to_json(_yaml: &serde_yaml::Value) -> Result<Value, AppError> {
    Err(unsupported_error())
}

pub fn remove_provider(_name: &str) -> Result<(), AppError> {
    Err(unsupported_error())
}

pub fn apply_switch_defaults(_provider_id: &str, _settings_config: &Value) -> Result<(), AppError> {
    Err(unsupported_error())
}
