use std::fs;
use std::path::{Path, PathBuf};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MigrationReport {
    pub legacy_dir_found: Option<String>,
    pub db_migrated: bool,
    pub attachments_migrated: usize,
    pub already_migrated: bool,
    pub details: String,
    pub error: Option<String>,
}

pub struct DataMigrator;

impl DataMigrator {
    /// Detects potential legacy application data directories (e.g. com.novadome.app, nova-dome)
    /// and safely migrates the SQLite database and attachments into the new target directory.
    pub fn migrate_if_needed(target_dir: &Path) -> MigrationReport {
        let sentinel = target_dir.join(".dace_migration_done");
        let target_db = target_dir.join("dace.db");

        // 1. If target directory already contains a migrated dace.db and sentinel, skip
        if target_db.exists() && sentinel.exists() {
            return MigrationReport {
                legacy_dir_found: None,
                db_migrated: false,
                attachments_migrated: 0,
                already_migrated: true,
                details: "Target directory already contains verified Dace data".to_string(),
                error: None,
            };
        }

        // 2. Identify candidate legacy directories in parent folder
        let parent = match target_dir.parent() {
            Some(p) => p,
            None => {
                return MigrationReport {
                    legacy_dir_found: None,
                    db_migrated: false,
                    attachments_migrated: 0,
                    already_migrated: false,
                    details: "Target directory has no parent".to_string(),
                    error: None,
                };
            }
        };

        let candidate_names = ["com.novadome.app", "nova-dome", "novadome"];
        let mut legacy_dir: Option<PathBuf> = None;

        for name in &candidate_names {
            let candidate = parent.join(name);
            if candidate.exists() && candidate.is_dir() {
                // Ensure candidate is not target_dir itself
                if candidate != target_dir {
                    let has_db = candidate.join("novadome.db").exists() || candidate.join("dace.db").exists();
                    let has_att = candidate.join("attachments").exists();
                    if has_db || has_att {
                        legacy_dir = Some(candidate);
                        break;
                    }
                }
            }
        }

        let legacy_path = match legacy_dir {
            Some(p) => p,
            None => {
                // Also check if target_dir itself has novadome.db from in-place execution
                if target_dir.join("novadome.db").exists() && !target_db.exists() {
                    return Self::migrate_in_place(target_dir);
                }

                return MigrationReport {
                    legacy_dir_found: None,
                    db_migrated: false,
                    attachments_migrated: 0,
                    already_migrated: false,
                    details: "No legacy data detected; fresh Dace workspace initialized".to_string(),
                    error: None,
                };
            }
        };

        let legacy_str = legacy_path.to_string_lossy().to_string();

        // 3. Ensure target directory exists
        if let Err(e) = fs::create_dir_all(target_dir) {
            return MigrationReport {
                legacy_dir_found: Some(legacy_str),
                db_migrated: false,
                attachments_migrated: 0,
                already_migrated: false,
                details: "Failed to create target directory".to_string(),
                error: Some(e.to_string()),
            };
        }

        let mut db_migrated = false;
        let mut attachments_migrated = 0;

        // 4. Migrate Database safely (Checkpoint WAL first to ensure zero data loss)
        let legacy_db_name = if legacy_path.join("dace.db").exists() {
            "dace.db"
        } else {
            "novadome.db"
        };
        let src_db = legacy_path.join(legacy_db_name);

        if src_db.exists() {
            // Checkpoint WAL if rusqlite can open it
            if let Ok(conn) = Connection::open(&src_db) {
                let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            }

            // Copy to target dace.db
            let tmp_target = target_dir.join("dace.db.tmp");
            if let Err(e) = fs::copy(&src_db, &tmp_target) {
                return MigrationReport {
                    legacy_dir_found: Some(legacy_str),
                    db_migrated: false,
                    attachments_migrated: 0,
                    already_migrated: false,
                    details: "Failed to copy database file".to_string(),
                    error: Some(e.to_string()),
                };
            }

            // Verify integrity by opening copied DB
            match Connection::open(&tmp_target) {
                Ok(conn) => {
                    let quick_check: Result<String, _> = conn.query_row("PRAGMA quick_check;", [], |r| r.get(0));
                    if quick_check.as_deref() != Ok("ok") {
                        let _ = fs::remove_file(&tmp_target);
                        return MigrationReport {
                            legacy_dir_found: Some(legacy_str),
                            db_migrated: false,
                            attachments_migrated: 0,
                            already_migrated: false,
                            details: "Database quick_check failed on copied file".to_string(),
                            error: Some("Corrupted database copy".to_string()),
                        };
                    }
                }
                Err(e) => {
                    let _ = fs::remove_file(&tmp_target);
                    return MigrationReport {
                        legacy_dir_found: Some(legacy_str),
                        db_migrated: false,
                        attachments_migrated: 0,
                        already_migrated: false,
                        details: "Failed to verify copied database".to_string(),
                        error: Some(e.to_string()),
                    };
                }
            }

            // Rename tmp to dace.db
            if let Err(e) = fs::rename(&tmp_target, &target_db) {
                return MigrationReport {
                    legacy_dir_found: Some(legacy_str),
                    db_migrated: false,
                    attachments_migrated: 0,
                    already_migrated: false,
                    details: "Failed to finalize database rename".to_string(),
                    error: Some(e.to_string()),
                };
            }

            db_migrated = true;
        }

        // 5. Migrate Attachments Tree safely
        let src_att = legacy_path.join("attachments");
        let dst_att = target_dir.join("attachments");

        if src_att.exists() && src_att.is_dir() {
            if let Err(e) = fs::create_dir_all(&dst_att) {
                return MigrationReport {
                    legacy_dir_found: Some(legacy_str),
                    db_migrated,
                    attachments_migrated,
                    already_migrated: false,
                    details: "Failed to create target attachments directory".to_string(),
                    error: Some(e.to_string()),
                };
            }

            match Self::copy_dir_recursive(&src_att, &dst_att) {
                Ok(count) => {
                    attachments_migrated = count;
                }
                Err(e) => {
                    return MigrationReport {
                        legacy_dir_found: Some(legacy_str),
                        db_migrated,
                        attachments_migrated,
                        already_migrated: false,
                        details: "Error copying attachment files".to_string(),
                        error: Some(e.to_string()),
                    };
                }
            }
        }

        // 6. Write receipt and sentinel
        let now = chrono::Utc::now().to_rfc3339();
        let receipt_data = format!(
            r#"{{"source":"{}","target":"{}","db_migrated":{},"attachments_migrated":{},"migrated_at":"{}"}}"#,
            legacy_str.replace('\\', "\\\\"),
            target_dir.to_string_lossy().replace('\\', "\\\\"),
            db_migrated,
            attachments_migrated,
            now
        );
        let _ = fs::write(target_dir.join(".dace_migration_receipt.json"), receipt_data);
        let _ = fs::write(&sentinel, now);

        MigrationReport {
            legacy_dir_found: Some(legacy_str),
            db_migrated,
            attachments_migrated,
            already_migrated: false,
            details: "Legacy user data successfully migrated into Dace workspace".to_string(),
            error: None,
        }
    }

    /// Handles in-place rename if running in the same directory (e.g. novadome.db -> dace.db)
    fn migrate_in_place(dir: &Path) -> MigrationReport {
        let old_db = dir.join("novadome.db");
        let new_db = dir.join("dace.db");

        if old_db.exists() && !new_db.exists() {
            if let Ok(conn) = Connection::open(&old_db) {
                let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            }
            if let Err(e) = fs::copy(&old_db, &new_db) {
                return MigrationReport {
                    legacy_dir_found: Some(dir.to_string_lossy().to_string()),
                    db_migrated: false,
                    attachments_migrated: 0,
                    already_migrated: false,
                    details: "Failed to migrate in-place database".to_string(),
                    error: Some(e.to_string()),
                };
            }
            let _ = fs::write(dir.join(".dace_migration_done"), chrono::Utc::now().to_rfc3339());
            return MigrationReport {
                legacy_dir_found: Some(dir.to_string_lossy().to_string()),
                db_migrated: true,
                attachments_migrated: 0,
                already_migrated: false,
                details: "In-place database migrated to dace.db".to_string(),
                error: None,
            };
        }

        MigrationReport {
            legacy_dir_found: None,
            db_migrated: false,
            attachments_migrated: 0,
            already_migrated: true,
            details: "In-place data already migrated".to_string(),
            error: None,
        }
    }

    /// Recursively copies a directory tree and verifies file sizes match
    fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<usize> {
        let mut count = 0;
        if !dst.exists() {
            fs::create_dir_all(dst)?;
        }

        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let path = entry.path();
            let file_name = entry.file_name();
            let dest_path = dst.join(&file_name);

            if path.is_dir() {
                // Skip staging temp files during migration
                if file_name == ".staging" {
                    fs::create_dir_all(&dest_path)?;
                    continue;
                }
                count += Self::copy_dir_recursive(&path, &dest_path)?;
            } else if path.is_file() {
                if !dest_path.exists() {
                    fs::copy(&path, &dest_path)?;
                    // Verify file size matches
                    let src_len = entry.metadata()?.len();
                    let dst_len = fs::metadata(&dest_path)?.len();
                    if src_len != dst_len {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("File size mismatch on {:?}", dest_path),
                        ));
                    }
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    /// Helper to compute SHA-256 for integrity verification
    #[allow(dead_code)]
    pub fn compute_sha256(path: &Path) -> std::io::Result<String> {
        use std::io::Read;
        let mut file = fs::File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        let hash_bytes = hasher.finalize();
        Ok(hash_bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    struct TestHarness {
        root: PathBuf,
        legacy_dir: PathBuf,
        target_dir: PathBuf,
    }

    impl TestHarness {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("dace_migration_test_{}", Uuid::new_v4()));
            let legacy_dir = root.join("com.novadome.app");
            let target_dir = root.join("com.dace.app");
            fs::create_dir_all(&legacy_dir).unwrap();
            Self {
                root,
                legacy_dir,
                target_dir,
            }
        }
    }

    impl Drop for TestHarness {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn test_legacy_data_migration_and_idempotence() {
        let harness = TestHarness::new();

        // 1. Setup simulated legacy SQLite DB
        let legacy_db_path = harness.legacy_dir.join("novadome.db");
        {
            let conn = Connection::open(&legacy_db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE records (id TEXT PRIMARY KEY, title TEXT);
                 INSERT INTO records VALUES ('rec-1', 'Epistemic Note');"
            ).unwrap();
        }

        // 2. Setup simulated legacy attachments
        let legacy_att_dir = harness.legacy_dir.join("attachments").join("ab");
        fs::create_dir_all(&legacy_att_dir).unwrap();
        let sample_pdf_content = b"%PDF-1.7 Simulated Dace migration document";
        fs::write(legacy_att_dir.join("abc12345.pdf"), sample_pdf_content).unwrap();

        // 3. Run migration
        let report = DataMigrator::migrate_if_needed(&harness.target_dir);
        assert!(report.db_migrated, "Database should be migrated");
        assert_eq!(report.attachments_migrated, 1, "Attachment file should be copied");
        assert!(report.error.is_none());

        // 4. Verify migrated database in target dir
        let target_db_path = harness.target_dir.join("dace.db");
        assert!(target_db_path.exists(), "Target dace.db must exist");
        {
            let conn = Connection::open(&target_db_path).unwrap();
            let title: String = conn.query_row("SELECT title FROM records WHERE id = 'rec-1'", [], |r| r.get(0)).unwrap();
            assert_eq!(title, "Epistemic Note");
        }

        // 5. Verify migrated attachment in target dir
        let target_att_path = harness.target_dir.join("attachments").join("ab").join("abc12345.pdf");
        assert!(target_att_path.exists(), "Migrated attachment must exist");
        let content = fs::read(&target_att_path).unwrap();
        assert_eq!(content, sample_pdf_content);

        // 6. Verify legacy files remain preserved (non-destructive)
        assert!(legacy_db_path.exists(), "Original legacy database must remain intact for safety");

        // 7. Test Idempotence: running migration again does nothing and returns already_migrated
        let second_report = DataMigrator::migrate_if_needed(&harness.target_dir);
        assert!(second_report.already_migrated, "Subsequent migration should detect completed state");
        assert!(!second_report.db_migrated);
    }
}
