use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let repo_dir = manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(manifest_dir);

    println!(
        "cargo:rerun-if-changed={}",
        repo_dir.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_dir.join("src-tauri/Cargo.toml").display()
    );
    println!("cargo:rerun-if-env-changed=CCSWITCH_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=CCSWITCH_PRODUCT_VERSION");

    let product_version = env::var("CCSWITCH_PRODUCT_VERSION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| read_manifest_version(&repo_dir.join("src-tauri/Cargo.toml")))
        .or_else(|| read_package_json_version(&repo_dir.join("package.json")))
        .unwrap_or_else(|| env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.1.0".to_string()));

    let build_version = env::var("CCSWITCH_BUILD_VERSION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| git_describe(&repo_dir))
        .unwrap_or_else(|| format!("v{}", product_version.trim_start_matches('v')));

    println!("cargo:rustc-env=CCSWITCH_PRODUCT_VERSION={product_version}");
    println!("cargo:rustc-env=CCSWITCH_BUILD_VERSION={build_version}");
}

fn read_manifest_version(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;

    content.lines().find_map(|line| {
        let trimmed = line.trim();

        if !trimmed.starts_with("version = ") {
            return None;
        }

        let value = trimmed
            .trim_start_matches("version = ")
            .trim_matches('"')
            .trim();

        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn read_package_json_version(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;

    content.lines().find_map(|line| {
        let trimmed = line.trim();

        if !trimmed.starts_with("\"version\"") {
            return None;
        }

        let (_, raw_value) = trimmed.split_once(':')?;
        let value = raw_value
            .trim()
            .trim_end_matches(',')
            .trim_matches('"')
            .trim();

        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn git_describe(repo_dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_dir)
        .args(["describe", "--tags", "--always", "--dirty"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8(output.stdout).ok()?;
    let value = value.trim();

    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
