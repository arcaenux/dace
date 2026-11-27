use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use uuid::Uuid;

use super::models::StoredFileInfo;

pub const CHUNK_BUFFER_SIZE: usize = 64 * 1024; // 64 KB memory chunk buffer

#[derive(Clone, Debug)]
pub struct AttachmentStorage {
    pub base_dir: PathBuf,
    pub staging_dir: PathBuf,
}

impl AttachmentStorage {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> io::Result<Self> {
        let base_dir = base_dir.as_ref().to_path_buf();
        let staging_dir = base_dir.join(".staging");

        fs::create_dir_all(&base_dir)?;
        fs::create_dir_all(&staging_dir)?;

        Ok(Self {
            base_dir,
            staging_dir,
        })
    }

    /// Two-phase staged ingestion protocol:
    /// Phase 1: Stream bytes into quarantine file in .staging/<uuid>.tmp while hashing
    /// Phase 2: Compute CAS sharded location and atomically move (or deduplicate)
    pub fn stage_and_store<R: Read>(
        &self,
        reader: &mut R,
        original_name: &str,
    ) -> Result<StoredFileInfo, String> {
        let staging_uuid = Uuid::new_v4().to_string();
        let staging_path = self.staging_dir.join(format!("{}.tmp", staging_uuid));

        let mut staging_file = File::create(&staging_path)
            .map_err(|e| format!("Failed to create staging file {:?}: {}", staging_path, e))?;

        let mut hasher = Sha256::new();
        let mut buffer = [0u8; CHUNK_BUFFER_SIZE];
        let mut total_bytes: u64 = 0;

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    hasher.update(&buffer[..n]);
                    staging_file
                        .write_all(&buffer[..n])
                        .map_err(|e| {
                            let _ = fs::remove_file(&staging_path);
                            format!("Failed writing to staging file: {}", e)
                        })?;
                    total_bytes += n as u64;
                }
                Err(ref e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    let _ = fs::remove_file(&staging_path);
                    return Err(format!("Error reading input stream: {}", e));
                }
            }
        }

        staging_file
            .flush()
            .map_err(|e| {
                let _ = fs::remove_file(&staging_path);
                format!("Failed flushing staging file: {}", e)
            })?;
        drop(staging_file);

        let hash_bytes = hasher.finalize();
        let hash = hash_bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();

        // Normalize extension: Option A (Extension-bearing CAS for OS file association)
        let ext = Path::new(original_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        let ext_suffix = if ext.is_empty() {
            String::new()
        } else {
            format!(".{}", ext)
        };

        // 2-level directory sharding: first 2 hex chars
        let shard = &hash[0..2];
        let file_name = format!("{}{}", hash, ext_suffix);
        let relative_path = format!("{}/{}", shard, file_name);

        let target_dir = self.base_dir.join(shard);
        let target_file = self.base_dir.join(&relative_path);

        // Check for deduplication
        if target_file.exists() {
            // Identical file already exists in CAS: delete staging copy immediately!
            let _ = fs::remove_file(&staging_path);
            return Ok(StoredFileInfo {
                relative_path,
                sha256_hash: hash,
                file_size: total_bytes,
                was_deduplicated: true,
            });
        }

        // Target does not exist: ensure shard directory exists
        fs::create_dir_all(&target_dir).map_err(|e| {
            let _ = fs::remove_file(&staging_path);
            format!("Failed creating shard directory {:?}: {}", target_dir, e)
        })?;

        // Phase 2: Atomic rename (or fallback copy if across volumes)
        if let Err(rename_err) = fs::rename(&staging_path, &target_file) {
            // Attempt fallback copy if rename across filesystem boundaries fails
            if let Err(copy_err) = fs::copy(&staging_path, &target_file) {
                let _ = fs::remove_file(&staging_path);
                return Err(format!(
                    "Failed to commit file from staging to CAS ({:?} -> {:?}): rename err: {}, copy err: {}",
                    staging_path, target_file, rename_err, copy_err
                ));
            }
            let _ = fs::remove_file(&staging_path);
        }

        Ok(StoredFileInfo {
            relative_path,
            sha256_hash: hash,
            file_size: total_bytes,
            was_deduplicated: false,
        })
    }

    /// Verifies that a relative path is valid and strictly contained within base_dir
    pub fn resolve_path(&self, relative_path: &str) -> Result<PathBuf, String> {
        // Normalize backslashes so traversal checks work on all platforms
        let normalized = relative_path.replace('\\', "/");
        let rel = Path::new(&normalized);
        for comp in rel.components() {
            match comp {
                std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                    return Err(format!("Path traversal forbidden: {}", relative_path));
                }
                _ => {}
            }
        }

        let full = self.base_dir.join(rel);
        Ok(full)
    }

    /// Verifies physical presence and SHA-256 hash integrity
    pub fn verify_integrity(&self, relative_path: &str, expected_hash: &str) -> (bool, bool) {
        let Ok(full_path) = self.resolve_path(relative_path) else {
            return (false, false);
        };

        if !full_path.exists() {
            return (false, false);
        }

        let Ok(mut file) = File::open(&full_path) else {
            return (true, false);
        };

        let mut hasher = Sha256::new();
        let mut buffer = [0u8; CHUNK_BUFFER_SIZE];
        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buffer[..n]),
                Err(ref e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return (true, false),
            }
        }

        let computed_hash = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect::<String>();
        let hash_matches = computed_hash.eq_ignore_ascii_case(expected_hash);

        (true, hash_matches)
    }

    /// Reads text file content up to a safe maximum size (e.g. 2 MB)
    pub fn read_text(&self, relative_path: &str, max_bytes: usize) -> Result<String, String> {
        let full_path = self.resolve_path(relative_path)?;
        if !full_path.exists() {
            return Err(format!("Managed file does not exist on disk: {}", relative_path));
        }

        let file = File::open(&full_path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        let mut handle = file.take(max_bytes as u64);
        let mut content = String::new();
        handle
            .read_to_string(&mut content)
            .map_err(|e| format!("Failed reading text: {}", e))?;

        Ok(content)
    }

    /// Reads raw bytes up to a safe maximum limit (e.g. 15 MB) for in-app data URL preview
    pub fn read_bytes(&self, relative_path: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
        let full_path = self.resolve_path(relative_path)?;
        if !full_path.exists() {
            return Err(format!("Managed file does not exist on disk: {}", relative_path));
        }

        let file = File::open(&full_path)
            .map_err(|e| format!("Failed to open file: {}", e))?;

        let mut handle = file.take(max_bytes as u64);
        let mut content = Vec::new();
        handle
            .read_to_end(&mut content)
            .map_err(|e| format!("Failed reading file bytes: {}", e))?;

        Ok(content)
    }

    /// Deletes the managed physical file from disk
    pub fn delete_file(&self, relative_path: &str) -> Result<(), String> {
        let full_path = self.resolve_path(relative_path)?;
        if full_path.exists() {
            fs::remove_file(&full_path)
                .map_err(|e| format!("Failed deleting file {:?}: {}", full_path, e))?;
        }
        Ok(())
    }

    /// Startup reconciliation sweep: cleans up any orphaned staging files
    pub fn run_reconciliation(&self) -> usize {
        let mut purged = 0;
        let Ok(entries) = fs::read_dir(&self.staging_dir) else {
            return 0;
        };

        let now = SystemTime::now();
        let max_age = Duration::from_secs(30 * 60); // 30 minutes

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("tmp") {
                if let Ok(metadata) = entry.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(age) = now.duration_since(modified) {
                            if age > max_age {
                                if fs::remove_file(&path).is_ok() {
                                    purged += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        purged
    }
}

/// Helper function to detect MIME type from filename and optional sample bytes
pub fn infer_mime_type(file_name: &str, sample: Option<&[u8]>) -> &'static str {
    // Check magic bytes first if provided
    if let Some(bytes) = sample {
        if bytes.starts_with(b"%PDF-") {
            return "application/pdf";
        }
        if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return "image/png";
        }
        if bytes.starts_with(b"\xFF\xD8\xFF") {
            return "image/jpeg";
        }
        if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
            return "image/gif";
        }
        if bytes.starts_with(b"RIFF") && bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
            return "image/webp";
        }
    }

    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "pdf" => "application/pdf",
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}
