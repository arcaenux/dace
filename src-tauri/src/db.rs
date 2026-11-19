use rusqlite::{params, Connection, Result};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Highest schema migration version this build knows how to open.
pub const SCHEMA_VERSION: i64 = 4;

pub struct Database {
    pub conn: Mutex<Connection>,
    pub has_fts5: bool,
    pub path: Option<PathBuf>,
}

impl Database {
    /// Initializes a database connection at the specified file path,
    /// applies necessary PRAGMAs (WAL mode, foreign keys), and runs migrations.
    pub fn init<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let path_ref = path.as_ref();
        let conn = Connection::open(path_ref).map_err(|e| format!("Failed to open SQLite database: {}", e))?;

        // 1. Enforce Foreign Keys
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;"
        ).map_err(|e| format!("Failed to set SQLite PRAGMAs: {}", e))?;

        // 2. Run schema migrations
        let has_fts5 = Self::run_migrations(&conn).map_err(|e| format!("Migration error: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
            has_fts5,
            path: Some(path_ref.to_path_buf()),
        })
    }

    /// Creates an in-memory database instance (primarily for automated testing).
    #[allow(dead_code)]
    pub fn init_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| format!("Failed to open in-memory DB: {}", e))?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;"
        ).map_err(|e| format!("Failed to set in-memory PRAGMAs: {}", e))?;

        let has_fts5 = Self::run_migrations(&conn).map_err(|e| format!("Migration error: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
            has_fts5,
            path: None,
        })
    }

    pub fn schema_version(conn: &Connection) -> Result<i64, rusqlite::Error> {
        conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
    }

    fn run_migrations(conn: &Connection) -> Result<bool, rusqlite::Error> {
        // Migration version tracking table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
            [],
        )?;

        // Check current version
        let current_version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let mut has_fts5 = false;

        // Migration 1: Initial Knowledge Schema
        if current_version < 1 {
            let tx = conn.unchecked_transaction()?;

            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS records (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tags (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS record_tags (
                    record_id TEXT NOT NULL,
                    tag_id TEXT NOT NULL,
                    PRIMARY KEY (record_id, tag_id),
                    FOREIGN KEY (record_id) REFERENCES records (id) ON DELETE CASCADE,
                    FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_records_updated_at ON records(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
                CREATE INDEX IF NOT EXISTS idx_record_tags_tag_id ON record_tags(tag_id);"
            )?;

            // Probe FTS5 support gracefully
            let fts_result = tx.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
                    record_id UNINDEXED,
                    title,
                    content,
                    tokenize = 'porter unicode61'
                );",
                [],
            );

            if fts_result.is_ok() {
                has_fts5 = true;
            }

            let now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![1, now],
            )?;

            tx.commit()?;
        } else {
            // Check if records_fts exists in schema
            let fts_check: Result<i64, _> = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='records_fts'",
                [],
                |row| row.get(0),
            );
            if let Ok(count) = fts_check {
                has_fts5 = count > 0;
            }
        }

        // Migration 2: Knowledge Relationships Schema
        if current_version < 2 {
            let tx = conn.unchecked_transaction()?;

            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS record_relationships (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    relation_type TEXT NOT NULL,
                    description TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (source_id) REFERENCES records (id) ON DELETE CASCADE,
                    FOREIGN KEY (target_id) REFERENCES records (id) ON DELETE CASCADE,
                    CHECK (source_id != target_id),
                    UNIQUE (source_id, target_id, relation_type)
                );

                CREATE INDEX IF NOT EXISTS idx_relationships_source ON record_relationships(source_id);
                CREATE INDEX IF NOT EXISTS idx_relationships_target ON record_relationships(target_id);
                CREATE INDEX IF NOT EXISTS idx_relationships_type ON record_relationships(relation_type);"
            )?;

            let now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![2, now],
            )?;

            tx.commit()?;
        }

        // Migration 3: Managed Attachments & Content-Addressed Storage Schema
        if current_version < 3 {
            let tx = conn.unchecked_transaction()?;

            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS attachments (
                    id TEXT PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    sha256_hash TEXT NOT NULL,
                    storage_path TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(sha256_hash);
                CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at DESC);

                CREATE TABLE IF NOT EXISTS record_attachments (
                    record_id TEXT NOT NULL,
                    attachment_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (record_id, attachment_id),
                    FOREIGN KEY (record_id) REFERENCES records (id) ON DELETE CASCADE,
                    FOREIGN KEY (attachment_id) REFERENCES attachments (id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_record_attachments_rec ON record_attachments(record_id);
                CREATE INDEX IF NOT EXISTS idx_record_attachments_att ON record_attachments(attachment_id);"
            )?;

            let now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![3, now],
            )?;

            tx.commit()?;
        }

        // Migration 4: Research Reader, Highlights, Annotations & Knowledge Excerpt Links
        if current_version < 4 {
            let tx = conn.unchecked_transaction()?;

            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS highlights (
                    id TEXT PRIMARY KEY,
                    attachment_id TEXT NOT NULL,
                    doc_sha256 TEXT NOT NULL,
                    page_number INTEGER NOT NULL,
                    selected_text TEXT NOT NULL,
                    anchor_data TEXT NOT NULL,
                    highlight_type TEXT NOT NULL,
                    color TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (attachment_id) REFERENCES attachments (id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_highlights_att ON highlights(attachment_id);
                CREATE INDEX IF NOT EXISTS idx_highlights_page ON highlights(attachment_id, page_number);
                CREATE INDEX IF NOT EXISTS idx_highlights_type ON highlights(highlight_type);

                CREATE TABLE IF NOT EXISTS annotations (
                    id TEXT PRIMARY KEY,
                    highlight_id TEXT NOT NULL UNIQUE,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (highlight_id) REFERENCES highlights (id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_annotations_hl ON annotations(highlight_id);

                CREATE TABLE IF NOT EXISTS highlight_records (
                    highlight_id TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    commentary TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (highlight_id, record_id),
                    FOREIGN KEY (highlight_id) REFERENCES highlights (id) ON DELETE CASCADE,
                    FOREIGN KEY (record_id) REFERENCES records (id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_hl_rec_hl ON highlight_records(highlight_id);
                CREATE INDEX IF NOT EXISTS idx_hl_rec_rec ON highlight_records(record_id);"
            )?;

            let now = chrono::Utc::now().to_rfc3339();
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![4, now],
            )?;

            tx.commit()?;
        }

        Ok(has_fts5)
    }
}
