use serde::Serialize;
use std::collections::BTreeSet;
use std::path::PathBuf;

/// A font family installed on the current device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SystemFont {
    pub family: String,
    pub style: Option<String>,
    pub source: String,
    pub path: Option<String>,
}

fn clean_family(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    // Windows registry names look like "Aptos (TrueType)". Keep the family.
    let family = raw.rsplit_once(" (").map(|(name, _)| name).unwrap_or(raw).trim();
    (!family.is_empty()).then(|| family.to_string())
}

fn finalize(mut fonts: Vec<SystemFont>) -> Vec<SystemFont> {
    fonts.sort_by(|a, b| {
        a.family
            .to_lowercase()
            .cmp(&b.family.to_lowercase())
            .then_with(|| a.family.cmp(&b.family))
    });
    let mut seen = BTreeSet::new();
    fonts.retain(|font| seen.insert(font.family.to_ascii_lowercase()));
    fonts
}

#[allow(dead_code)] // Used by the macOS and Linux collectors.
fn from_directories(dirs: &[PathBuf]) -> Vec<SystemFont> {
    let mut fonts = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
                fonts.push(SystemFont {
                    family: stem.to_string(),
                    style: None,
                    source: "font-directory".to_string(),
                    path: Some(path.to_string_lossy().into_owned()),
                });
            }
        }
    }
    fonts
}

#[cfg(windows)]
fn collect() -> Result<Vec<SystemFont>, String> {
    use std::io::ErrorKind;
    use winreg::{HKCU, HKLM};

    let mut fonts = Vec::new();
    let path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
    for root in [HKLM, HKCU] {
        let key = match root.open_subkey(path) {
            Ok(key) => key,
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Failed to open Windows font registry: {error}")),
        };
        for entry in key.enum_values() {
            let (name, _) =
                entry.map_err(|error| format!("Failed to enumerate Windows fonts: {error}"))?;
            if let Some(family) = clean_family(&name) {
                fonts.push(SystemFont {
                    family,
                    style: None,
                    source: "windows-registry".to_string(),
                    path: None,
                });
            }
        }
    }
    Ok(fonts)
}

#[cfg(target_os = "macos")]
fn collect() -> Result<Vec<SystemFont>, String> {
    let mut fonts = Vec::new();
    let profiler = std::process::Command::new("system_profiler")
        .args(["SPFontsDataType", "-json"])
        .output();

    if let Ok(output) = profiler {
        if output.status.success() {
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                if let Some(entries) = json.get("SPFontsDataType").and_then(|value| value.as_array())
                {
                    for entry in entries {
                        let family = entry
                            .get("family")
                            .or_else(|| entry.get("_name"))
                            .or_else(|| entry.get("name"))
                            .and_then(|value| value.as_str());
                        if let Some(family) = family.and_then(clean_family) {
                            fonts.push(SystemFont {
                                family,
                                style: entry
                                    .get("style")
                                    .and_then(|value| value.as_str())
                                    .map(str::to_string),
                                source: "system_profiler".to_string(),
                                path: entry
                                    .get("path")
                                    .and_then(|value| value.as_str())
                                    .map(str::to_string),
                            });
                        }
                    }
                }
            }
        }
    }

    if fonts.is_empty() {
        let mut dirs = vec![
            PathBuf::from("/System/Library/Fonts"),
            PathBuf::from("/Library/Fonts"),
        ];
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Library/Fonts"));
        }
        fonts = from_directories(&dirs);
    }
    Ok(fonts)
}

#[cfg(target_os = "linux")]
fn collect() -> Result<Vec<SystemFont>, String> {
    let mut fonts = Vec::new();
    let output = std::process::Command::new("fc-list")
        .args(["-f", "%{family}\n"])
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Some(family) = line.split(',').next().and_then(clean_family) {
                    fonts.push(SystemFont {
                        family,
                        style: None,
                        source: "fc-list".to_string(),
                        path: None,
                    });
                }
            }
        }
    }

    if fonts.is_empty() {
        let mut dirs = vec![
            PathBuf::from("/usr/share/fonts"),
            PathBuf::from("/usr/local/share/fonts"),
        ];
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(".fonts"));
            dirs.push(home.join(".local/share/fonts"));
        }
        fonts = from_directories(&dirs);
    }
    Ok(fonts)
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn collect() -> Result<Vec<SystemFont>, String> {
    Ok(Vec::new())
}

fn collect_blocking() -> Result<Vec<SystemFont>, String> {
    Ok(finalize(collect()?))
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    let fonts = tauri::async_runtime::spawn_blocking(collect_blocking)
        .await
        .map_err(|error| format!("Font enumeration task failed: {error}"))??;
    Ok(fonts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_platform_family_names() {
        assert_eq!(clean_family("Aptos (TrueType)").as_deref(), Some("Aptos"));
        assert_eq!(clean_family("  Segoe UI  ").as_deref(), Some("Segoe UI"));
        assert_eq!(clean_family("   "), None);
    }

    #[test]
    fn deduplicates_and_sorts_fonts_case_insensitively() {
        let fonts = vec![
            SystemFont {
                family: "Calibri".into(),
                style: None,
                source: "test".into(),
                path: None,
            },
            SystemFont {
                family: "aptos".into(),
                style: None,
                source: "test".into(),
                path: None,
            },
            SystemFont {
                family: "Aptos".into(),
                style: None,
                source: "test".into(),
                path: None,
            },
        ];
        let fonts = finalize(fonts);
        assert_eq!(fonts.len(), 2);
        assert_eq!(fonts[0].family, "Aptos");
        assert_eq!(fonts[1].family, "Calibri");
    }
}
