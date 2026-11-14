use rusqlite::{params, Connection, Result};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
    pub has_fts5: bool,
}

impl Database {
    /// Initializes a database connection at the specified file path,
    /// applies necessary PRAGMAs (WAL mode, foreign keys), and runs migrations.
    pub fn init<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("Failed to open SQLite database: {}", e))?;

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
        })
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

        Ok(has_fts5)
    }
}
