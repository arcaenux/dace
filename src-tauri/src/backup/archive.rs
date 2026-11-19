use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

pub const NDARCHIVE_MAGIC: &[u8; 14] = b"DACE_NDARCHIVE";
pub const NDARCHIVE_FORMAT_VERSION: u32 = 1;
pub const NDARCHIVE_DATABASE_PATH: &str = "database/dace.db";
pub const NDARCHIVE_ATTACHMENTS_PREFIX: &str = "attachments/";

// Defensive resource limits for hostile or corrupt archives.
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub database: DatabaseEntry,
    pub attachments: Vec<AttachmentEntry>,
    pub totals: BackupTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseEntry {
    pub archive_path: String,
    pub source_name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentEntry {
    pub archive_path: String,
    pub relative_path: String,
    pub file_name: String,
    pub mime_type: String,
    pub db_file_size: i64,
    pub sha256: String,
    pub size: u64,
    pub attachment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupTotals {
    pub attachment_count: usize,
    pub attachment_bytes: u64,
    pub database_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct ArchiveFile {
    pub archive_path: String,
    pub source_path: std::path::PathBuf,
    pub sha256_hex: String,
    pub size: u64,
}

#[derive(Debug, Clone)]
struct ExpectedEntry {
    size: u64,
    sha256: [u8; 32],
}

pub fn sanitize_archive_path(path: &str) -> Result<String, String> {
    let normalized = path.replace('\\', "/");
    if normalized.is_empty() {
        return Err("Archive path cannot be empty".to_string());
    }
    let p = Path::new(&normalized);
    if p.is_absolute() {
        return Err(format!("Absolute archive paths are not allowed: {}", path));
    }
    for comp in p.components() {
        match comp {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return Err(format!("Unsafe archive path component in: {}", path)),
        }
    }
    Ok(normalized.trim_start_matches("./").to_string())
}

/// Joins a sanitized archive/extraction-relative path onto a trusted root directory.
/// The relative path is re-validated here so callers can never escape the root.
pub fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = sanitize_archive_path(relative)?;
    let rel = Path::new(&normalized);
    let mut joined = root.to_path_buf();
    for comp in rel.components() {
        match comp {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            _ => return Err(format!("Unsafe relative path: {}", relative)),
        }
    }
    Ok(joined)
}

pub fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open {:?}: {}", path, e))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                hasher.update(&buf[..n]);
                total += n as u64;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(format!("Failed to read {:?}: {}", path, e)),
        }
    }
    let hash = hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    Ok((hash, total))
}

fn hex_to_bytes(hex: &str) -> Result<[u8; 32], String> {
    if hex.len() != 64 {
        return Err("Invalid SHA-256 hex length".to_string());
    }
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid SHA-256 hex".to_string());
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        let byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|_| "Invalid SHA-256 hex".to_string())?;
        out[i] = byte;
    }
    Ok(out)
}

pub fn write_ndarchive(
    dest_path: &Path,
    manifest: &BackupManifest,
    files: &[ArchiveFile],
) -> Result<u64, String> {
    let mut file = File::create(dest_path)
        .map_err(|e| format!("Failed to create archive {:?}: {}", dest_path, e))?;

    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;

    file.write_all(NDARCHIVE_MAGIC)
        .map_err(|e| format!("Failed to write archive magic: {}", e))?;
    file.write_all(&NDARCHIVE_FORMAT_VERSION.to_le_bytes())
        .map_err(|e| format!("Failed to write format version: {}", e))?;
    file.write_all(&(manifest_json.len() as u64).to_le_bytes())
        .map_err(|e| format!("Failed to write manifest length: {}", e))?;
    file.write_all(&manifest_json)
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    for entry in files {
        let path = sanitize_archive_path(&entry.archive_path)?;
        let path_bytes = path.as_bytes();
        if path_bytes.len() > u32::MAX as usize {
            return Err("Archive path too long".to_string());
        }
        let sha = hex_to_bytes(&entry.sha256_hex)?;
        file.write_all(&(path_bytes.len() as u32).to_le_bytes())
            .map_err(|e| format!("Failed to write entry path length: {}", e))?;
        file.write_all(path_bytes)
            .map_err(|e| format!("Failed to write entry path: {}", e))?;
        file.write_all(&sha)
            .map_err(|e| format!("Failed to write entry hash: {}", e))?;
        file.write_all(&entry.size.to_le_bytes())
            .map_err(|e| format!("Failed to write entry size: {}", e))?;

        let mut src = File::open(&entry.source_path)
            .map_err(|e| format!("Failed to open source {:?}: {}", entry.source_path, e))?;
        let mut buf = [0u8; 64 * 1024];
        let mut copied: u64 = 0;
        loop {
            match src.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    file.write_all(&buf[..n])
                        .map_err(|e| format!("Failed to write archive data: {}", e))?;
                    copied += n as u64;
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(format!("Failed to read source {:?}: {}", entry.source_path, e)),
            }
        }
        if copied != entry.size {
            return Err(format!(
                "Size changed while archiving {} (expected {}, wrote {})",
                path, entry.size, copied
            ));
        }
    }

    file.flush()
        .map_err(|e| format!("Failed to flush archive: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync archive: {}", e))?;

    let metadata = std::fs::metadata(dest_path)
        .map_err(|e| format!("Failed to stat archive {:?}: {}", dest_path, e))?;
    Ok(metadata.len())
}

fn read_manifest(
    file: &mut File,
) -> Result<(BackupManifest, HashMap<String, ExpectedEntry>), String> {
    let mut magic = [0u8; 14];
    file.read_exact(&mut magic)
        .map_err(|e| format!("Failed to read archive magic: {}", e))?;
    if &magic != NDARCHIVE_MAGIC {
        return Err("Invalid archive magic/header".to_string());
    }

    let mut ver_buf = [0u8; 4];
    file.read_exact(&mut ver_buf)
        .map_err(|e| format!("Failed to read format version: {}", e))?;
    let version = u32::from_le_bytes(ver_buf);
    if version != NDARCHIVE_FORMAT_VERSION {
        return Err(format!("Unsupported archive format version: {}", version));
    }

    let mut len_buf = [0u8; 8];
    file.read_exact(&mut len_buf)
        .map_err(|e| format!("Failed to read manifest length: {}", e))?;
    let manifest_len = u64::from_le_bytes(len_buf);
    // Guard against corrupt/hostile manifest lengths before allocating.
    if manifest_len == 0 || manifest_len > MAX_MANIFEST_BYTES {
        return Err(format!("Invalid manifest length: {}", manifest_len));
    }
    let mut manifest_bytes = vec![0u8; manifest_len as usize];
    file.read_exact(&mut manifest_bytes)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    let manifest: BackupManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    let expected = validate_manifest(&manifest)?;
    Ok((manifest, expected))
}

fn validate_manifest(
    manifest: &BackupManifest,
) -> Result<HashMap<String, ExpectedEntry>, String> {
    if manifest.format != "dace-ndarchive" || manifest.format_version != NDARCHIVE_FORMAT_VERSION {
        return Err("Manifest format metadata mismatch".to_string());
    }
    if manifest.app_version.trim().is_empty() {
        return Err("Manifest is missing an application version".to_string());
    }
    if manifest.schema_version < 1 {
        return Err("Manifest contains an invalid schema version".to_string());
    }
    if manifest.created_at.trim().is_empty() {
        return Err("Manifest is missing a creation timestamp".to_string());
    }

    let db_path = sanitize_archive_path(&manifest.database.archive_path)?;
    if db_path != manifest.database.archive_path {
        return Err("Manifest database path is not normalized".to_string());
    }
    if db_path != NDARCHIVE_DATABASE_PATH {
        return Err(format!(
            "Archive is missing the required database entry (expected {})",
            NDARCHIVE_DATABASE_PATH
        ));
    }
    let db_sha = hex_to_bytes(&manifest.database.sha256)?;
    if manifest.database.size == 0 {
        return Err("Archive database entry is empty".to_string());
    }

    let mut expected: HashMap<String, ExpectedEntry> = HashMap::new();
    expected.insert(
        db_path,
        ExpectedEntry {
            size: manifest.database.size,
            sha256: db_sha,
        },
    );

    let mut attachment_ids: HashSet<String> = HashSet::new();
    let mut attachment_bytes: u64 = 0;

    for attachment in &manifest.attachments {
        let archive_path = sanitize_archive_path(&attachment.archive_path)?;
        if archive_path != attachment.archive_path {
            return Err(format!(
                "Manifest attachment path is not normalized: {}",
                attachment.archive_path
            ));
        }
        let relative_path = sanitize_archive_path(&attachment.relative_path)?;
        if relative_path != attachment.relative_path {
            return Err(format!(
                "Manifest attachment relative path is not normalized: {}",
                attachment.relative_path
            ));
        }
        let canonical = format!("{}{}", NDARCHIVE_ATTACHMENTS_PREFIX, relative_path);
        if canonical != archive_path {
            return Err(format!(
                "Manifest attachment path '{}' does not match its relative path '{}'",
                archive_path, relative_path
            ));
        }
        if attachment.attachment_id.trim().is_empty() {
            return Err("Manifest attachment is missing its attachment id".to_string());
        }
        if !attachment_ids.insert(attachment.attachment_id.clone()) {
            return Err(format!(
                "Archive contains duplicate attachment id: {}",
                attachment.attachment_id
            ));
        }
        if attachment.db_file_size < 0 || attachment.db_file_size as u64 != attachment.size {
            return Err(format!(
                "Manifest attachment size is inconsistent for {}",
                attachment.relative_path
            ));
        }
        let sha = hex_to_bytes(&attachment.sha256)?;
        if expected
            .insert(
                archive_path.clone(),
                ExpectedEntry {
                    size: attachment.size,
                    sha256: sha,
                },
            )
            .is_some()
        {
            return Err(format!("Archive contains duplicate path: {}", archive_path));
        }
        attachment_bytes = attachment_bytes
            .checked_add(attachment.size)
            .ok_or_else(|| "Attachment byte total overflowed".to_string())?;
    }

    if manifest.totals.attachment_count != manifest.attachments.len() {
        return Err("Manifest attachment count does not match its inventory".to_string());
    }
    if manifest.totals.database_bytes != manifest.database.size {
        return Err("Manifest database byte total is inconsistent".to_string());
    }
    if manifest.totals.attachment_bytes != attachment_bytes {
        return Err("Manifest attachment byte total is inconsistent".to_string());
    }
    let expected_total = manifest
        .database
        .size
        .checked_add(attachment_bytes)
        .ok_or_else(|| "Manifest total byte count overflowed".to_string())?;
    if manifest.totals.total_bytes != expected_total {
        return Err("Manifest total byte count is inconsistent".to_string());
    }
    if expected.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "Archive declares too many entries ({}; limit {})",
            expected.len(),
            MAX_ARCHIVE_ENTRIES
        ));
    }

    Ok(expected)
}

fn scan_archive(
    archive_path: &Path,
    extract_to: Option<&Path>,
) -> Result<BackupManifest, String> {
    let mut file = File::open(archive_path)
        .map_err(|e| format!("Failed to open archive {:?}: {}", archive_path, e))?;
    let (manifest, expected) = read_manifest(&mut file)?;

    let archive_len = file
        .metadata()
        .map_err(|e| format!("Failed to stat archive {:?}: {}", archive_path, e))?
        .len();
    if manifest.totals.total_bytes > archive_len {
        return Err(format!(
            "Archive manifest declares {} payload bytes but the archive is only {} bytes",
            manifest.totals.total_bytes, archive_len
        ));
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut seen_count: usize = 0;
    let mut buf = [0u8; 64 * 1024];

    loop {
        let mut path_len_buf = [0u8; 4];
        match file.read_exact(&mut path_len_buf) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("Failed to read entry path length: {}", e)),
        }
        let path_len = u32::from_le_bytes(path_len_buf) as usize;
        // Sanity bound: no legitimate archive path is anywhere near this.
        if path_len == 0 || path_len > 16 * 1024 {
            return Err(format!("Invalid archive entry path length: {}", path_len));
        }
        let mut path_bytes = vec![0u8; path_len];
        file.read_exact(&mut path_bytes)
            .map_err(|e| format!("Failed to read entry path: {}", e))?;
        let raw_path = String::from_utf8(path_bytes)
            .map_err(|_| "Archive contains invalid UTF-8 path".to_string())?;
        let path = sanitize_archive_path(&raw_path)?;

        let expected_entry = expected
            .get(&path)
            .ok_or_else(|| format!("Archive contains unexpected entry not in manifest: {}", path))?;
        if !seen.insert(path.clone()) {
            return Err(format!("Archive contains duplicate entry: {}", path));
        }

        let mut sha = [0u8; 32];
        file.read_exact(&mut sha)
            .map_err(|e| format!("Failed to read entry hash: {}", e))?;
        let mut size_buf = [0u8; 8];
        file.read_exact(&mut size_buf)
            .map_err(|e| format!("Failed to read entry size: {}", e))?;
        let size = u64::from_le_bytes(size_buf);

        if size != expected_entry.size {
            return Err(format!("Size mismatch for archive entry {}", path));
        }
        if sha != expected_entry.sha256 {
            return Err(format!("Manifest checksum mismatch for {}", path));
        }

        let mut writer = match extract_to {
            Some(root) => {
                let dest = safe_join(root, &path)?;
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        format!("Failed to create extraction directory {:?}: {}", parent, e)
                    })?;
                }
                Some(
                    File::create(&dest)
                        .map_err(|e| format!("Failed to create extracted file {:?}: {}", dest, e))?,
                )
            }
            None => None,
        };

        let mut hasher = Sha256::new();
        let mut remaining = size;
        while remaining > 0 {
            let to_read = std::cmp::min(remaining as usize, buf.len());
            let n = file
                .read(&mut buf[..to_read])
                .map_err(|e| format!("Failed to read entry data for {}: {}", path, e))?;
            if n == 0 {
                return Err(format!("Unexpected EOF in entry {}", path));
            }
            hasher.update(&buf[..n]);
            if let Some(ref mut out) = writer {
                out.write_all(&buf[..n])
                    .map_err(|e| format!("Failed to write extracted entry {}: {}", path, e))?;
            }
            remaining -= n as u64;
        }

        let computed = hasher.finalize();
        if computed[..] != sha[..] {
            if let Some(ref mut out) = writer {
                let _ = out.flush();
            }
            return Err(format!("Checksum mismatch for {}", path));
        }
        if let Some(mut out) = writer {
            out.flush()
                .map_err(|e| format!("Failed to flush extracted entry {}: {}", path, e))?;
            out.sync_all()
                .map_err(|e| format!("Failed to sync extracted entry {}: {}", path, e))?;
        }
        seen_count += 1;
    }

    if seen_count != expected.len() {
        return Err(format!(
            "Archive is missing {} file(s) listed in the manifest",
            expected.len().saturating_sub(seen_count)
        ));
    }

    Ok(manifest)
}

/// Fully validates an archive (magic, version, manifest, per-entry size and SHA-256,
/// duplicate/traversal paths, inventory completeness) without writing files.
pub fn validate_ndarchive(path: &Path) -> Result<BackupManifest, String> {
    scan_archive(path, None)
}

/// Fully validates an archive and extracts every entry into `dest_dir`, preserving
/// archive-relative paths. The destination is created if necessary. On failure the
/// caller is responsible for removing any partially extracted staging directory.
pub fn extract_ndarchive(path: &Path, dest_dir: &Path) -> Result<BackupManifest, String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create extraction directory {:?}: {}", dest_dir, e))?;
    scan_archive(path, Some(dest_dir))
}

#[cfg(test)]
mod tests {
    use super::hex_to_bytes;

    #[test]
    fn hex_to_bytes_rejects_non_ascii_hex() {
        // 62 ASCII bytes + one 2-byte UTF-8 character = 64 bytes, but the byte
        // slices used by hex_to_bytes would otherwise land inside the character.
        let malformed = format!("{}é", "0".repeat(62));
        assert_eq!(malformed.len(), 64);
        assert!(hex_to_bytes(&malformed).is_err());
    }
}
