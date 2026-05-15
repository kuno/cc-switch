//! 数据库备份和恢复
//!
//! 提供 SQL 导出/导入和二进制快照备份功能。

use super::{lock_conn, Database, SCHEMA_VERSION};
use crate::config::get_app_config_dir;
use crate::error::AppError;
use chrono::{Local, Utc};
use rusqlite::backup::Backup;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

const CC_SWITCH_SQL_EXPORT_HEADER: &str = "-- CC Switch SQLite 导出";
const BACKUP_IMPORT_LIMIT_BYTES: usize = 128 * 1024 * 1024;
const CC_SWITCH_BACKUP_SCHEMA_MARKERS: &[(&str, &[&str])] = &[
    (
        "providers",
        &["id", "app_type", "name", "settings_config", "meta"],
    ),
    (
        "mcp_servers",
        &["id", "name", "server_config", "enabled_claude"],
    ),
    ("settings", &["key", "value"]),
];

/// Tables whose data rows are skipped when exporting for WebDAV sync.
const SYNC_SKIP_TABLES: &[&str] = &[
    "proxy_request_logs",
    "stream_check_logs",
    "provider_health",
    "proxy_live_backup",
    "usage_daily_rollups",
];

/// Tables whose local data is preserved (restored from local snapshot) during WebDAV import.
/// Excludes ephemeral tables like provider_health that can safely rebuild at runtime.
const SYNC_PRESERVE_TABLES: &[&str] = &[
    "proxy_request_logs",
    "stream_check_logs",
    "proxy_live_backup",
    "usage_daily_rollups",
];

/// A database backup entry for the UI
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: String, // ISO 8601
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<i32>,
    pub supported_schema_version: i32,
}

impl Database {
    /// 导出为 SQLite 兼容的 SQL 文本（内存字符串，完整导出）
    pub fn export_sql_string(&self) -> Result<String, AppError> {
        let snapshot = self.snapshot_to_memory()?;
        Self::dump_sql(&snapshot, &[])
    }

    /// Export SQL for sync (WebDAV), skipping local-only tables' data
    pub fn export_sql_string_for_sync(&self) -> Result<String, AppError> {
        let snapshot = self.snapshot_to_memory()?;
        Self::dump_sql(&snapshot, SYNC_SKIP_TABLES)
    }

    /// 导出为 SQLite 兼容的 SQL 文本
    pub fn export_sql(&self, target_path: &Path) -> Result<(), AppError> {
        let dump = self.export_sql_string()?;

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
        }

        crate::config::atomic_write(target_path, dump.as_bytes())
    }

    /// 从 SQL 文件导入，返回生成的备份 ID（若无备份则为空字符串）
    pub fn import_sql(&self, source_path: &Path) -> Result<String, AppError> {
        if !source_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "SQL 文件不存在: {}",
                source_path.display()
            )));
        }

        let sql_raw = fs::read_to_string(source_path).map_err(|e| AppError::io(source_path, e))?;
        let sql_content = sql_raw.trim_start_matches('\u{feff}');
        self.import_sql_string(sql_content)
    }

    /// 从 SQL 字符串导入，返回生成的备份 ID（若无备份则为空字符串）
    pub fn import_sql_string(&self, sql_raw: &str) -> Result<String, AppError> {
        self.import_sql_string_inner(sql_raw, &[])
    }

    /// Import SQL generated for sync, then restore local-only tables from the
    /// current device snapshot before replacing the main database.
    pub(crate) fn import_sql_string_for_sync(&self, sql_raw: &str) -> Result<String, AppError> {
        self.import_sql_string_inner(sql_raw, SYNC_PRESERVE_TABLES)
    }

    fn import_sql_string_inner(
        &self,
        sql_raw: &str,
        preserve_tables: &[&str],
    ) -> Result<String, AppError> {
        let sql_content = sql_raw.trim_start_matches('\u{feff}');
        Self::validate_cc_switch_sql_export(sql_content)?;

        // 导入前备份现有数据库
        let backup_path = self.backup_database_file()?;

        let local_snapshot = if preserve_tables.is_empty() {
            None
        } else {
            Some(self.snapshot_to_memory()?)
        };

        // 在临时数据库执行导入，确保失败不会污染主库
        let temp_file = NamedTempFile::new().map_err(|e| AppError::IoContext {
            context: "创建临时数据库文件失败".to_string(),
            source: e,
        })?;
        let temp_path = temp_file.path().to_path_buf();
        let temp_conn =
            Connection::open(&temp_path).map_err(|e| AppError::Database(e.to_string()))?;

        temp_conn
            .execute_batch(sql_content)
            .map_err(|e| AppError::Database(format!("执行 SQL 导入失败: {e}")))?;

        // 补齐缺失表/索引并进行基础校验
        Self::create_tables_on_conn(&temp_conn)?;
        Self::apply_schema_migrations_on_conn(&temp_conn)?;
        Self::validate_basic_state(&temp_conn)?;
        if let Some(local_snapshot) = local_snapshot.as_ref() {
            Self::restore_tables(local_snapshot, &temp_conn, preserve_tables)?;
        }

        // 使用 Backup 将临时库原子写回主库
        {
            let mut main_conn = lock_conn!(self.conn);
            let backup = Backup::new(&temp_conn, &mut main_conn)
                .map_err(|e| AppError::Database(e.to_string()))?;
            backup
                .step(-1)
                .map_err(|e| AppError::Database(e.to_string()))?;
        }

        let backup_id = backup_path
            .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
            .unwrap_or_default();

        Ok(backup_id)
    }

    /// 创建内存快照以避免长时间持有数据库锁
    pub(crate) fn snapshot_to_memory(&self) -> Result<Connection, AppError> {
        let conn = lock_conn!(self.conn);
        let mut snapshot =
            Connection::open_in_memory().map_err(|e| AppError::Database(e.to_string()))?;

        {
            let backup =
                Backup::new(&conn, &mut snapshot).map_err(|e| AppError::Database(e.to_string()))?;
            backup
                .step(-1)
                .map_err(|e| AppError::Database(e.to_string()))?;
        }

        Ok(snapshot)
    }

    fn validate_cc_switch_sql_export(sql: &str) -> Result<(), AppError> {
        let trimmed = sql.trim_start();
        if trimmed.starts_with(CC_SWITCH_SQL_EXPORT_HEADER) {
            return Ok(());
        }

        Err(AppError::localized(
            "backup.sql.invalid_format",
            "仅支持导入由 CC Switch 导出的 SQL 备份文件。",
            "Only SQL backups exported by CC Switch are supported.",
        ))
    }

    fn restore_tables(
        source_conn: &Connection,
        target_conn: &Connection,
        tables: &[&str],
    ) -> Result<(), AppError> {
        for table in tables {
            if !Self::table_exists(source_conn, table)? || !Self::table_exists(target_conn, table)?
            {
                continue;
            }

            let columns = Self::get_table_columns(source_conn, table)?;
            if columns.is_empty() {
                continue;
            }

            target_conn
                .execute(&format!("DELETE FROM \"{table}\""), [])
                .map_err(|e| AppError::Database(format!("清空表 {table} 失败: {e}")))?;

            let placeholders = (1..=columns.len())
                .map(|idx| format!("?{idx}"))
                .collect::<Vec<_>>()
                .join(", ");
            let cols = columns
                .iter()
                .map(|column| format!("\"{column}\""))
                .collect::<Vec<_>>()
                .join(", ");
            let insert_sql = format!("INSERT INTO \"{table}\" ({cols}) VALUES ({placeholders})");

            let mut stmt = source_conn
                .prepare(&format!("SELECT * FROM \"{table}\""))
                .map_err(|e| AppError::Database(format!("读取表 {table} 失败: {e}")))?;
            let mut rows = stmt
                .query([])
                .map_err(|e| AppError::Database(format!("查询表 {table} 数据失败: {e}")))?;

            while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
                let mut values = Vec::with_capacity(columns.len());
                for idx in 0..columns.len() {
                    values.push(
                        row.get::<_, rusqlite::types::Value>(idx)
                            .map_err(|e| AppError::Database(e.to_string()))?,
                    );
                }

                target_conn
                    .execute(&insert_sql, rusqlite::params_from_iter(values.iter()))
                    .map_err(|e| AppError::Database(format!("恢复表 {table} 数据失败: {e}")))?;
            }
        }

        Ok(())
    }

    /// Periodic backup: create a new backup if the latest one is older than the configured interval
    pub(crate) fn periodic_backup_if_needed(&self) -> Result<(), AppError> {
        let interval_hours = crate::settings::effective_backup_interval_hours();
        if interval_hours > 0 {
            let backup_dir = get_app_config_dir().join("backups");
            if !backup_dir.exists() {
                self.backup_database_file()?;
            } else {
                let latest = fs::read_dir(&backup_dir).ok().and_then(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.path().extension().map(|ext| ext == "db").unwrap_or(false))
                        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
                        .max()
                });

                let interval_secs = u64::from(interval_hours) * 3600;
                let needs_backup = match latest {
                    None => true,
                    Some(last_modified) => {
                        last_modified.elapsed().unwrap_or_default()
                            > std::time::Duration::from_secs(interval_secs)
                    }
                };

                if needs_backup {
                    log::info!(
                        "Periodic backup: latest backup is older than {interval_hours} hours, creating new backup"
                    );
                    self.backup_database_file()?;
                }
            }
        }

        // Periodic maintenance is always enabled, regardless of auto-backup settings.
        let mut reclaimed_rows = 0u64;
        match self.cleanup_old_stream_check_logs(7) {
            Ok(deleted) => {
                reclaimed_rows += deleted;
            }
            Err(e) => {
                log::warn!("Periodic stream_check_logs cleanup failed: {e}");
            }
        }
        match self.rollup_and_prune(30) {
            Ok(deleted) => {
                reclaimed_rows += deleted;
            }
            Err(e) => {
                log::warn!("Periodic rollup_and_prune failed: {e}");
            }
        }
        if reclaimed_rows > 0 {
            let conn = lock_conn!(self.conn);
            if let Err(e) = conn.execute_batch("PRAGMA incremental_vacuum;") {
                log::warn!("Periodic incremental vacuum failed: {e}");
            }
        }

        Ok(())
    }

    /// 生成一致性快照备份，返回备份文件路径（不存在主库时返回 None）
    pub(crate) fn backup_database_file(&self) -> Result<Option<PathBuf>, AppError> {
        self.backup_database_file_preserving(&[])
    }

    fn backup_database_file_preserving(
        &self,
        preserve_paths: &[PathBuf],
    ) -> Result<Option<PathBuf>, AppError> {
        let db_path = get_app_config_dir().join("cc-switch.db");
        if !db_path.exists() {
            return Ok(None);
        }

        let backup_dir = db_path
            .parent()
            .ok_or_else(|| AppError::Config("无效的数据库路径".to_string()))?
            .join("backups");

        fs::create_dir_all(&backup_dir).map_err(|e| AppError::io(&backup_dir, e))?;

        let base_id = format!("db_backup_{}", Local::now().format("%Y%m%d_%H%M%S"));
        let mut backup_id = base_id.clone();
        let mut backup_path = backup_dir.join(format!("{backup_id}.db"));
        let mut counter = 1;
        while backup_path.exists() {
            backup_id = format!("{base_id}_{counter}");
            backup_path = backup_dir.join(format!("{backup_id}.db"));
            counter += 1;
        }

        {
            let conn = lock_conn!(self.conn);
            let mut dest_conn =
                Connection::open(&backup_path).map_err(|e| AppError::Database(e.to_string()))?;
            let backup = Backup::new(&conn, &mut dest_conn)
                .map_err(|e| AppError::Database(e.to_string()))?;
            backup
                .step(-1)
                .map_err(|e| AppError::Database(e.to_string()))?;
        }

        let mut cleanup_preserve_paths = preserve_paths.to_vec();
        cleanup_preserve_paths.push(backup_path.clone());
        Self::cleanup_db_backups(&backup_dir, &cleanup_preserve_paths)?;
        Ok(Some(backup_path))
    }

    /// 清理旧的数据库备份，保留最新的 N 个
    fn cleanup_db_backups(dir: &Path, preserve_paths: &[PathBuf]) -> Result<(), AppError> {
        let retain = crate::settings::effective_backup_retain_count();
        let preserve_paths = preserve_paths
            .iter()
            .filter_map(|path| path.canonicalize().ok())
            .collect::<Vec<_>>();
        let entries = match fs::read_dir(dir) {
            Ok(iter) => iter
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .map(|ext| ext == "db")
                        .unwrap_or(false)
                })
                .collect::<Vec<_>>(),
            Err(_) => return Ok(()),
        };

        if entries.len() <= retain {
            return Ok(());
        }

        let mut remaining = entries.len();
        let mut sorted = entries;
        sorted.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());

        for entry in sorted {
            if remaining <= retain {
                break;
            }
            let path = entry.path();
            let canonical_path = path.canonicalize().ok();
            if canonical_path
                .as_ref()
                .is_some_and(|path| preserve_paths.iter().any(|preserve| preserve == path))
            {
                continue;
            }

            if let Err(err) = fs::remove_file(entry.path()) {
                log::warn!("删除旧数据库备份失败 {}: {}", entry.path().display(), err);
            } else {
                remaining = remaining.saturating_sub(1);
            }
        }
        Ok(())
    }

    /// 基础状态校验
    fn validate_basic_state(conn: &Connection) -> Result<(), AppError> {
        let provider_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mcp_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM mcp_servers", [], |row| row.get(0))
            .map_err(|e| AppError::Database(e.to_string()))?;

        if provider_count == 0 && mcp_count == 0 {
            return Err(AppError::Config(
                "导入的 SQL 未包含有效的供应商或 MCP 数据".to_string(),
            ));
        }
        Ok(())
    }

    /// 导出数据库为 SQL 文本
    fn dump_sql(conn: &Connection, skip_tables: &[&str]) -> Result<String, AppError> {
        let mut output = String::new();
        let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let user_version: i64 = conn
            .query_row("PRAGMA user_version;", [], |row| row.get(0))
            .unwrap_or(0);

        output.push_str(&format!(
            "-- CC Switch SQLite 导出\n-- 生成时间: {timestamp}\n-- user_version: {user_version}\n"
        ));
        output.push_str("PRAGMA foreign_keys=OFF;\n");
        output.push_str(&format!("PRAGMA user_version={user_version};\n"));
        output.push_str("BEGIN TRANSACTION;\n");

        // 导出 schema
        let mut stmt = conn
            .prepare(
                "SELECT type, name, tbl_name, sql
                 FROM sqlite_master
                 WHERE sql NOT NULL AND type IN ('table','index','trigger','view')
                 ORDER BY type='table' DESC, name",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut tables = Vec::new();
        let mut rows = stmt
            .query([])
            .map_err(|e| AppError::Database(e.to_string()))?;
        while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            let obj_type: String = row.get(0).map_err(|e| AppError::Database(e.to_string()))?;
            let name: String = row.get(1).map_err(|e| AppError::Database(e.to_string()))?;
            let sql: String = row.get(3).map_err(|e| AppError::Database(e.to_string()))?;

            // 跳过 SQLite 内部对象（如 sqlite_sequence）
            if name.starts_with("sqlite_") {
                continue;
            }

            output.push_str(&sql);
            output.push_str(";\n");

            if obj_type == "table" && !name.starts_with("sqlite_") {
                tables.push(name);
            }
        }

        // 导出数据
        for table in tables {
            if skip_tables.iter().any(|t| *t == table) {
                continue;
            }
            let columns = Self::get_table_columns(conn, &table)?;
            if columns.is_empty() {
                continue;
            }

            let mut stmt = conn
                .prepare(&format!("SELECT * FROM \"{table}\""))
                .map_err(|e| AppError::Database(e.to_string()))?;
            let mut rows = stmt
                .query([])
                .map_err(|e| AppError::Database(e.to_string()))?;

            while let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
                let mut values = Vec::with_capacity(columns.len());
                for idx in 0..columns.len() {
                    let value = row
                        .get_ref(idx)
                        .map_err(|e| AppError::Database(e.to_string()))?;
                    values.push(Self::format_sql_value(value)?);
                }

                let cols = columns
                    .iter()
                    .map(|c| format!("\"{c}\""))
                    .collect::<Vec<_>>()
                    .join(", ");
                output.push_str(&format!(
                    "INSERT INTO \"{table}\" ({cols}) VALUES ({});\n",
                    values.join(", ")
                ));
            }
        }

        output.push_str("COMMIT;\nPRAGMA foreign_keys=ON;\n");
        Ok(output)
    }

    /// 获取表的列名列表
    fn get_table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, AppError> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info(\"{table}\")"))
            .map_err(|e| AppError::Database(e.to_string()))?;
        let iter = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut columns = Vec::new();
        for col in iter {
            columns.push(col.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(columns)
    }

    /// 格式化 SQL 值
    fn format_sql_value(value: ValueRef<'_>) -> Result<String, AppError> {
        match value {
            ValueRef::Null => Ok("NULL".to_string()),
            ValueRef::Integer(i) => Ok(i.to_string()),
            ValueRef::Real(f) => Ok(f.to_string()),
            ValueRef::Text(t) => {
                let text = std::str::from_utf8(t)
                    .map_err(|e| AppError::Database(format!("文本字段不是有效的 UTF-8: {e}")))?;
                let escaped = text.replace('\'', "''");
                Ok(format!("'{escaped}'"))
            }
            ValueRef::Blob(bytes) => {
                let mut s = String::from("X'");
                for b in bytes {
                    use std::fmt::Write;
                    let _ = write!(&mut s, "{b:02X}");
                }
                s.push('\'');
                Ok(s)
            }
        }
    }

    /// List all database backup files, sorted by creation time (newest first)
    pub fn list_backups() -> Result<Vec<BackupEntry>, AppError> {
        let backup_dir = get_app_config_dir().join("backups");
        if !backup_dir.exists() {
            return Ok(vec![]);
        }

        let mut entries: Vec<BackupEntry> = fs::read_dir(&backup_dir)
            .map_err(|e| AppError::io(&backup_dir, e))?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|ext| ext == "db").unwrap_or(false))
            .filter_map(|e| {
                let filename = e.file_name().to_string_lossy().to_string();
                Self::backup_entry_for_filename(&backup_dir, &filename).ok()
            })
            .collect();

        // Sort by created_at descending (newest first)
        entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(entries)
    }

    pub fn supported_schema_version() -> i32 {
        SCHEMA_VERSION
    }

    pub fn current_schema_version(&self) -> Result<i32, AppError> {
        let conn = lock_conn!(self.conn);
        Self::get_user_version(&conn)
    }

    pub fn backup_import_limit_bytes() -> usize {
        BACKUP_IMPORT_LIMIT_BYTES
    }

    pub fn get_backup_entry(filename: &str) -> Result<BackupEntry, AppError> {
        Self::validate_backup_filename(filename)?;
        let backup_dir = get_app_config_dir().join("backups");
        Self::backup_entry_for_filename(&backup_dir, filename)
    }

    pub fn read_backup_file(filename: &str) -> Result<(BackupEntry, Vec<u8>), AppError> {
        Self::validate_backup_filename(filename)?;
        let backup_dir = get_app_config_dir().join("backups");
        let entry = Self::backup_entry_for_filename(&backup_dir, filename)?;
        let backup_path = backup_dir.join(filename);
        let bytes = fs::read(&backup_path).map_err(|e| AppError::io(&backup_path, e))?;
        Ok((entry, bytes))
    }

    pub fn import_backup_file(
        filename: Option<&str>,
        bytes: &[u8],
    ) -> Result<BackupEntry, AppError> {
        if bytes.is_empty() {
            return Err(AppError::InvalidInput(
                "Backup payload cannot be empty".to_string(),
            ));
        }
        if bytes.len() > BACKUP_IMPORT_LIMIT_BYTES {
            return Err(AppError::InvalidInput(format!(
                "Backup payload exceeds {} MiB limit",
                BACKUP_IMPORT_LIMIT_BYTES / 1024 / 1024
            )));
        }

        let backup_dir = get_app_config_dir().join("backups");
        fs::create_dir_all(&backup_dir).map_err(|e| AppError::io(&backup_dir, e))?;

        let filename = match filename {
            Some(filename) => Self::normalize_import_backup_filename(filename)?,
            None => Self::unique_backup_filename(&backup_dir, "imported_db_backup"),
        };
        Self::validate_backup_filename(&filename)?;

        let target_path = backup_dir.join(&filename);
        if target_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "A backup named '{filename}' already exists"
            )));
        }

        let temp = NamedTempFile::new_in(&backup_dir).map_err(|e| AppError::IoContext {
            context: "创建临时备份文件失败".to_string(),
            source: e,
        })?;
        fs::write(temp.path(), bytes).map_err(|e| AppError::io(temp.path(), e))?;
        Self::validate_sqlite_backup_file(temp.path())?;

        temp.persist(&target_path)
            .map_err(|e| AppError::IoContext {
                context: format!("保存导入备份失败: {}", target_path.display()),
                source: e.error,
            })?;

        Self::backup_entry_for_filename(&backup_dir, &filename)
    }

    /// Restore database from a backup file. Returns the safety backup ID.
    pub fn restore_from_backup(&self, filename: &str) -> Result<String, AppError> {
        Self::validate_backup_filename(filename)?;

        let backup_dir = get_app_config_dir().join("backups");
        let backup_path = backup_dir.join(filename);

        if !backup_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "Backup file not found: {filename}"
            )));
        }
        Self::validate_sqlite_backup_file(&backup_path)?;

        // Step 1: Create safety backup of current database
        let safety_backup =
            self.backup_database_file_preserving(std::slice::from_ref(&backup_path))?;
        let safety_id = safety_backup
            .and_then(|p| p.file_stem().map(|s| s.to_string_lossy().to_string()))
            .unwrap_or_default();

        // Step 2: Open the backup file and restore it to the main database
        let source_conn =
            Connection::open(&backup_path).map_err(|e| AppError::Database(e.to_string()))?;

        {
            let mut main_conn = lock_conn!(self.conn);
            let backup = Backup::new(&source_conn, &mut main_conn)
                .map_err(|e| AppError::Database(e.to_string()))?;
            backup
                .step(-1)
                .map_err(|e| AppError::Database(e.to_string()))?;
        }

        // Step 3: Run schema migrations (backup may be from an older version)
        self.create_tables()?;
        self.apply_schema_migrations()?;
        self.ensure_model_pricing_seeded()?;

        log::info!("Database restored from backup: {filename}, safety backup: {safety_id}");
        Ok(safety_id)
    }

    /// Rename a backup file. Returns the new filename.
    pub fn rename_backup(old_filename: &str, new_name: &str) -> Result<String, AppError> {
        Self::validate_backup_filename(old_filename)?;

        // Clean new name
        let trimmed = new_name.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput(
                "New name cannot be empty".to_string(),
            ));
        }

        // Length limit (without .db suffix)
        let name_part = trimmed.strip_suffix(".db").unwrap_or(trimmed);
        if name_part.len() > 100 {
            return Err(AppError::InvalidInput(
                "Name too long (max 100 characters)".to_string(),
            ));
        }

        // Prevent path traversal in new name
        if name_part.contains("..")
            || name_part.contains('/')
            || name_part.contains('\\')
            || name_part.contains('\0')
        {
            return Err(AppError::InvalidInput(
                "Invalid characters in new name".to_string(),
            ));
        }

        let new_filename = format!("{name_part}.db");

        let backup_dir = get_app_config_dir().join("backups");
        let old_path = backup_dir.join(old_filename);
        let new_path = backup_dir.join(&new_filename);

        if !old_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "Backup file not found: {old_filename}"
            )));
        }

        if new_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "A backup named '{new_filename}' already exists"
            )));
        }

        fs::rename(&old_path, &new_path).map_err(|e| AppError::io(&old_path, e))?;
        log::info!("Renamed backup: {old_filename} -> {new_filename}");
        Ok(new_filename)
    }

    /// Delete a backup file permanently.
    pub fn delete_backup(filename: &str) -> Result<(), AppError> {
        Self::validate_backup_filename(filename)?;

        let backup_path = get_app_config_dir().join("backups").join(filename);
        if !backup_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "Backup file not found: {filename}"
            )));
        }

        fs::remove_file(&backup_path).map_err(|e| AppError::io(&backup_path, e))?;
        log::info!("Deleted backup: {filename}");
        Ok(())
    }

    fn validate_backup_filename(filename: &str) -> Result<(), AppError> {
        if filename.is_empty()
            || filename.contains("..")
            || filename.contains('/')
            || filename.contains('\\')
            || filename.contains('\0')
            || !filename.ends_with(".db")
            || Path::new(filename)
                .file_name()
                .and_then(|name| name.to_str())
                != Some(filename)
        {
            return Err(AppError::InvalidInput(
                "Invalid backup filename".to_string(),
            ));
        }

        Ok(())
    }

    fn normalize_import_backup_filename(filename: &str) -> Result<String, AppError> {
        let trimmed = filename.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput(
                "Backup filename cannot be empty".to_string(),
            ));
        }

        let filename = if trimmed.ends_with(".db") {
            trimmed.to_string()
        } else {
            format!("{trimmed}.db")
        };
        Self::validate_backup_filename(&filename)?;
        Ok(filename)
    }

    fn unique_backup_filename(backup_dir: &Path, prefix: &str) -> String {
        let base = format!("{}_{}", prefix, Local::now().format("%Y%m%d_%H%M%S"));
        let mut filename = format!("{base}.db");
        let mut counter = 1;
        while backup_dir.join(&filename).exists() {
            filename = format!("{base}_{counter}.db");
            counter += 1;
        }
        filename
    }

    fn backup_entry_for_filename(dir: &Path, filename: &str) -> Result<BackupEntry, AppError> {
        Self::validate_backup_filename(filename)?;
        let path = dir.join(filename);
        let metadata = path.metadata().map_err(|e| AppError::io(&path, e))?;
        let created_at = metadata
            .modified()
            .ok()
            .map(|t| {
                let dt: chrono::DateTime<Utc> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_default();

        Ok(BackupEntry {
            filename: filename.to_string(),
            size_bytes: metadata.len(),
            created_at,
            schema_version: Self::read_backup_schema_version(&path).ok(),
            supported_schema_version: SCHEMA_VERSION,
        })
    }

    fn read_backup_schema_version(path: &Path) -> Result<i32, AppError> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| AppError::Database(e.to_string()))?;
        Self::get_user_version(&conn)
    }

    fn validate_sqlite_backup_file(path: &Path) -> Result<(), AppError> {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| AppError::Database(format!("Invalid SQLite backup: {e}")))?;
        let result: String = conn
            .query_row("PRAGMA integrity_check;", [], |row| row.get(0))
            .map_err(|e| AppError::Database(format!("Backup integrity check failed: {e}")))?;
        if result != "ok" {
            return Err(AppError::Database(format!(
                "Backup integrity check failed: {result}"
            )));
        }
        let version = Self::get_user_version(&conn)?;
        if version <= 0 {
            return Err(AppError::Database(
                "Backup is not a CC Switch database: missing schema version".to_string(),
            ));
        }
        if version > SCHEMA_VERSION {
            return Err(AppError::Database(format!(
                "Backup schema version {version} is newer than supported version {SCHEMA_VERSION}"
            )));
        }
        Self::validate_cc_switch_backup_schema(&conn)?;
        Ok(())
    }

    fn validate_cc_switch_backup_schema(conn: &Connection) -> Result<(), AppError> {
        for (table, columns) in CC_SWITCH_BACKUP_SCHEMA_MARKERS {
            if !Self::table_exists(conn, table)? {
                return Err(AppError::Database(format!(
                    "Backup is not a CC Switch database: missing table `{table}`"
                )));
            }

            for column in *columns {
                if !Self::has_column(conn, table, column)? {
                    return Err(AppError::Database(format!(
                        "Backup is not a CC Switch database: missing column `{table}.{column}`"
                    )));
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Database;
    use crate::error::AppError;
    use crate::settings::{get_settings, update_settings, AppSettings};
    use rusqlite::Connection;
    use serial_test::serial;
    use std::path::PathBuf;

    const LEGACY_SCHEMA_V1_SQL: &str = r#"
        CREATE TABLE providers (
            id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            name TEXT NOT NULL,
            settings_config TEXT NOT NULL,
            website_url TEXT,
            category TEXT,
            created_at INTEGER,
            sort_index INTEGER,
            notes TEXT,
            icon TEXT,
            icon_color TEXT,
            meta TEXT NOT NULL DEFAULT '{}',
            is_current BOOLEAN NOT NULL DEFAULT 0,
            PRIMARY KEY (id, app_type)
        );
        CREATE TABLE provider_endpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            url TEXT NOT NULL,
            added_at INTEGER,
            FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
        );
        CREATE TABLE mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            server_config TEXT NOT NULL,
            description TEXT,
            homepage TEXT,
            docs TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            enabled_claude BOOLEAN NOT NULL DEFAULT 0,
            enabled_codex BOOLEAN NOT NULL DEFAULT 0,
            enabled_gemini BOOLEAN NOT NULL DEFAULT 0
        );
        CREATE TABLE prompts (
            id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            description TEXT,
            enabled BOOLEAN NOT NULL DEFAULT 1,
            created_at INTEGER,
            updated_at INTEGER,
            PRIMARY KEY (id, app_type)
        );
        CREATE TABLE skills (
            key TEXT PRIMARY KEY,
            installed BOOLEAN NOT NULL DEFAULT 0,
            installed_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE skill_repos (
            owner TEXT NOT NULL,
            name TEXT NOT NULL,
            branch TEXT NOT NULL DEFAULT 'main',
            enabled BOOLEAN NOT NULL DEFAULT 1,
            PRIMARY KEY (owner, name)
        );
        CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    "#;

    struct TestHomeGuard {
        old_test_home: Option<std::ffi::OsString>,
        path: PathBuf,
    }

    impl TestHomeGuard {
        fn new(name: &str) -> Self {
            let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
            let path = std::env::temp_dir().join(name);
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("create test home");
            std::env::set_var("CC_SWITCH_TEST_HOME", &path);
            Self {
                old_test_home,
                path,
            }
        }
    }

    impl Drop for TestHomeGuard {
        fn drop(&mut self) {
            match self.old_test_home.as_ref() {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    struct SettingsGuard {
        old_settings: AppSettings,
    }

    impl SettingsGuard {
        fn update(mut update: impl FnMut(&mut AppSettings)) -> Self {
            let old_settings = get_settings();
            let mut settings = old_settings.clone();
            update(&mut settings);
            update_settings(settings).expect("update test settings");
            Self { old_settings }
        }
    }

    impl Drop for SettingsGuard {
        fn drop(&mut self) {
            update_settings(self.old_settings.clone()).expect("restore test settings");
        }
    }

    fn legacy_v1_backup_bytes() -> Vec<u8> {
        let file = tempfile::NamedTempFile::new().expect("legacy sqlite temp file");
        let conn = Connection::open(file.path()).expect("open legacy sqlite");
        conn.execute_batch(LEGACY_SCHEMA_V1_SQL)
            .expect("seed legacy v1 schema");
        Database::set_user_version(&conn, 1).expect("set legacy user_version");
        conn.execute(
            "INSERT INTO providers (
                id, app_type, name, settings_config, website_url, category,
                created_at, sort_index, notes, icon, icon_color, meta, is_current
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                "legacy-provider",
                "claude",
                "Legacy Provider",
                "{}",
                Option::<String>::None,
                Option::<String>::None,
                Option::<i64>::None,
                Option::<usize>::None,
                Option::<String>::None,
                Option::<String>::None,
                Option::<String>::None,
                "{}",
                1,
            ],
        )
        .expect("seed legacy provider");
        drop(conn);
        std::fs::read(file.path()).expect("read legacy sqlite")
    }

    #[test]
    fn sync_import_preserves_local_only_tables() -> Result<(), AppError> {
        let remote_db = Database::memory()?;
        {
            let conn = crate::database::lock_conn!(remote_db.conn);
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, meta)
                 VALUES ('remote-provider', 'claude', 'Remote Provider', '{}', '{}')",
                [],
            )?;
        }
        let remote_sql = remote_db.export_sql_string_for_sync()?;

        let local_db = Database::memory()?;
        {
            let conn = crate::database::lock_conn!(local_db.conn);
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, meta)
                 VALUES ('local-provider', 'claude', 'Local Provider', '{}', '{}')",
                [],
            )?;
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES ('req-1', 'local-provider', 'claude', 'claude-3', 100, 50, '0.01', 120, 200, 1000)",
                [],
            )?;
            conn.execute(
                "INSERT INTO usage_daily_rollups (
                    date, app_type, provider_id, model, request_count, success_count,
                    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                    total_cost_usd, avg_latency_ms
                ) VALUES ('2026-03-01', 'claude', 'local-provider', 'claude-3', 7, 7, 700, 350, 0, 0, '0.07', 120)",
                [],
            )?;
            conn.execute(
                "INSERT INTO stream_check_logs (
                    provider_id, provider_name, app_type, status, success, message,
                    response_time_ms, http_status, model_used, retry_count, tested_at
                ) VALUES ('local-provider', 'Local Provider', 'claude', 'operational', 1, 'ok', 42, 200, 'claude-3', 0, 1000)",
                [],
            )?;
        }

        local_db.import_sql_string_for_sync(&remote_sql)?;

        let remote_provider_exists: i64 = {
            let conn = crate::database::lock_conn!(local_db.conn);
            conn.query_row(
                "SELECT COUNT(*) FROM providers WHERE id = 'remote-provider' AND app_type = 'claude'",
                [],
                |row| row.get(0),
            )?
        };
        assert_eq!(
            remote_provider_exists, 1,
            "remote config should be imported"
        );

        let (request_logs, rollups, stream_logs): (i64, i64, i64) = {
            let conn = crate::database::lock_conn!(local_db.conn);
            let request_logs =
                conn.query_row("SELECT COUNT(*) FROM proxy_request_logs", [], |row| {
                    row.get(0)
                })?;
            let rollups =
                conn.query_row("SELECT COUNT(*) FROM usage_daily_rollups", [], |row| {
                    row.get(0)
                })?;
            let stream_logs =
                conn.query_row("SELECT COUNT(*) FROM stream_check_logs", [], |row| {
                    row.get(0)
                })?;
            (request_logs, rollups, stream_logs)
        };
        assert_eq!(request_logs, 1, "local request logs should be preserved");
        assert_eq!(rollups, 1, "local rollups should be preserved");
        assert_eq!(
            stream_logs, 1,
            "local stream check logs should be preserved"
        );

        Ok(())
    }

    #[test]
    #[serial]
    fn periodic_maintenance_runs_even_when_auto_backup_disabled() -> Result<(), AppError> {
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        let test_home =
            std::env::temp_dir().join("cc-switch-periodic-maintenance-backup-disabled-test");
        let _ = std::fs::remove_dir_all(&test_home);
        std::fs::create_dir_all(&test_home).expect("create test home");
        std::env::set_var("CC_SWITCH_TEST_HOME", &test_home);

        let mut settings = AppSettings::default();
        settings.backup_interval_hours = Some(0);
        update_settings(settings).expect("disable auto backup");

        let db = Database::memory()?;
        let now = chrono::Utc::now().timestamp();
        let old_ts = now - 40 * 86400;
        let old_stream_ts = now - 8 * 86400;

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO proxy_request_logs (
                    request_id, provider_id, app_type, model,
                    input_tokens, output_tokens, total_cost_usd,
                    latency_ms, status_code, created_at
                ) VALUES ('old-req', 'p1', 'claude', 'claude-3', 100, 50, '0.01', 100, 200, ?1)",
                [old_ts],
            )?;
            conn.execute(
                "INSERT INTO stream_check_logs (
                    provider_id, provider_name, app_type, status, success, message,
                    response_time_ms, http_status, model_used, retry_count, tested_at
                ) VALUES ('p1', 'Provider 1', 'claude', 'operational', 1, 'ok', 42, 200, 'claude-3', 0, ?1)",
                [old_stream_ts],
            )?;
        }

        db.periodic_backup_if_needed()?;

        let (remaining_request_logs, stream_logs, rollups): (i64, i64, i64) = {
            let conn = crate::database::lock_conn!(db.conn);
            let remaining_request_logs =
                conn.query_row("SELECT COUNT(*) FROM proxy_request_logs", [], |row| {
                    row.get(0)
                })?;
            let stream_logs =
                conn.query_row("SELECT COUNT(*) FROM stream_check_logs", [], |row| {
                    row.get(0)
                })?;
            let rollups =
                conn.query_row("SELECT COUNT(*) FROM usage_daily_rollups", [], |row| {
                    row.get(0)
                })?;
            (remaining_request_logs, stream_logs, rollups)
        };

        assert_eq!(
            remaining_request_logs, 0,
            "old request logs should still be pruned when auto backup is disabled"
        );
        assert_eq!(
            stream_logs, 0,
            "old stream check logs should still be pruned when auto backup is disabled"
        );
        assert_eq!(rollups, 1, "old request logs should be rolled up");

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }

        Ok(())
    }

    #[test]
    #[serial]
    fn managed_backup_lifecycle_includes_metadata_and_safety_restore() -> Result<(), AppError> {
        let _home = TestHomeGuard::new("cc-switch-managed-backup-lifecycle-test");
        let db = Database::init()?;

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, meta)
                 VALUES ('provider-before', 'claude', 'Before Restore', '{}', '{}')",
                [],
            )?;
        }

        let backup_path = db.backup_database_file()?.expect("backup path");
        let backup_filename = backup_path
            .file_name()
            .expect("backup filename")
            .to_string_lossy()
            .to_string();

        let listed = Database::list_backups()?;
        let entry = listed
            .iter()
            .find(|entry| entry.filename == backup_filename)
            .expect("created backup listed");
        assert_eq!(
            entry.schema_version,
            Some(Database::supported_schema_version())
        );
        assert_eq!(
            entry.supported_schema_version,
            Database::supported_schema_version()
        );
        assert!(entry.size_bytes > 0);

        let (_download_entry, bytes) = Database::read_backup_file(&backup_filename)?;
        let imported = Database::import_backup_file(Some("imported-test.db"), &bytes)?;
        assert_eq!(imported.filename, "imported-test.db");
        assert_eq!(
            imported.schema_version,
            Some(Database::supported_schema_version())
        );

        Database::delete_backup("imported-test.db")?;
        assert!(Database::get_backup_entry("imported-test.db").is_err());

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "UPDATE providers SET name = 'After Mutation' WHERE id = 'provider-before'",
                [],
            )?;
        }

        let safety_id = db.restore_from_backup(&backup_filename)?;
        assert!(!safety_id.is_empty(), "restore should create safety backup");

        let restored_name: String = {
            let conn = crate::database::lock_conn!(db.conn);
            conn.query_row(
                "SELECT name FROM providers WHERE id = 'provider-before'",
                [],
                |row| row.get(0),
            )?
        };
        assert_eq!(restored_name, "Before Restore");

        let safety_filename = format!("{safety_id}.db");
        assert!(
            Database::get_backup_entry(&safety_filename).is_ok(),
            "safety backup should be managed and listable"
        );

        Ok(())
    }

    #[test]
    #[serial]
    fn restore_preserves_selected_older_backup_when_retention_is_reached() -> Result<(), AppError> {
        let _home = TestHomeGuard::new("cc-switch-restore-preserve-selected-backup-test");
        let _settings = SettingsGuard::update(|settings| {
            settings.backup_retain_count = Some(2);
        });
        let db = Database::init()?;

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, meta)
                 VALUES ('restore-retain-provider', 'claude', 'First Backup', '{}', '{}')",
                [],
            )?;
        }
        let selected_backup_path = db.backup_database_file()?.expect("selected backup");
        let selected_filename = selected_backup_path
            .file_name()
            .expect("selected filename")
            .to_string_lossy()
            .to_string();

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "UPDATE providers SET name = 'Second Backup' WHERE id = 'restore-retain-provider'",
                [],
            )?;
        }
        db.backup_database_file()?.expect("second backup");
        assert_eq!(Database::list_backups()?.len(), 2);

        {
            let conn = crate::database::lock_conn!(db.conn);
            conn.execute(
                "UPDATE providers SET name = 'Before Restore' WHERE id = 'restore-retain-provider'",
                [],
            )?;
        }

        let safety_id = db.restore_from_backup(&selected_filename)?;
        assert!(!safety_id.is_empty(), "restore should create safety backup");
        assert!(
            Database::get_backup_entry(&selected_filename).is_ok(),
            "retention cleanup must not delete the selected restore source"
        );

        let restored_name: String = {
            let conn = crate::database::lock_conn!(db.conn);
            conn.query_row(
                "SELECT name FROM providers WHERE id = 'restore-retain-provider'",
                [],
                |row| row.get(0),
            )?
        };
        assert_eq!(restored_name, "First Backup");

        Ok(())
    }

    #[test]
    #[serial]
    fn managed_backup_import_and_restore_reject_non_cc_switch_sqlite_db() -> Result<(), AppError> {
        let _home = TestHomeGuard::new("cc-switch-managed-backup-schema-validation-test");
        let db = Database::init()?;
        let backup_dir = crate::config::get_app_config_dir().join("backups");
        std::fs::create_dir_all(&backup_dir).expect("create backup dir");

        let empty_sqlite = tempfile::NamedTempFile::new().expect("temp sqlite");
        let unrelated_conn = Connection::open(empty_sqlite.path()).expect("create empty sqlite db");
        unrelated_conn
            .execute("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)", [])
            .expect("write unrelated sqlite schema");
        drop(unrelated_conn);
        let bytes = std::fs::read(empty_sqlite.path()).expect("read empty sqlite db");

        let import_error = Database::import_backup_file(Some("empty-sqlite.db"), &bytes)
            .expect_err("empty sqlite should not import as backup");
        assert!(
            import_error
                .to_string()
                .contains("not a CC Switch database"),
            "unexpected import error: {import_error}"
        );

        let invalid_restore_path = backup_dir.join("empty-restore.db");
        std::fs::write(&invalid_restore_path, &bytes).expect("write invalid managed backup");
        let restore_error = db
            .restore_from_backup("empty-restore.db")
            .expect_err("empty sqlite should not restore as backup");
        assert!(
            restore_error
                .to_string()
                .contains("not a CC Switch database"),
            "unexpected restore error: {restore_error}"
        );

        Ok(())
    }

    #[test]
    #[serial]
    fn managed_backup_import_and_restore_accept_v3_8_schema_v1_cc_switch_db() -> Result<(), AppError>
    {
        let _home = TestHomeGuard::new("cc-switch-managed-backup-legacy-v1-validation-test");
        let db = Database::init()?;
        let bytes = legacy_v1_backup_bytes();

        let legacy_file = tempfile::NamedTempFile::new().expect("legacy inspection file");
        std::fs::write(legacy_file.path(), &bytes).expect("write legacy inspection db");
        let legacy_conn = Connection::open(legacy_file.path()).expect("open legacy inspection db");
        assert_eq!(Database::get_user_version(&legacy_conn)?, 1);
        assert!(
            !Database::table_exists(&legacy_conn, "proxy_config")?,
            "v3.8/schema-v1 fixture intentionally lacks current proxy_config"
        );
        assert!(
            !Database::has_column(&legacy_conn, "providers", "display_sort_index")?,
            "v3.8/schema-v1 fixture intentionally lacks current provider display order column"
        );
        drop(legacy_conn);

        let imported = Database::import_backup_file(Some("legacy-v1.db"), &bytes)?;
        assert_eq!(imported.filename, "legacy-v1.db");
        assert_eq!(imported.schema_version, Some(1));

        db.restore_from_backup("legacy-v1.db")?;

        assert_eq!(
            db.current_schema_version()?,
            Database::supported_schema_version()
        );
        {
            let conn = crate::database::lock_conn!(db.conn);
            assert!(Database::table_exists(&conn, "proxy_config")?);
            assert!(Database::has_column(
                &conn,
                "providers",
                "display_sort_index"
            )?);
        }

        let provider_name: String = {
            let conn = crate::database::lock_conn!(db.conn);
            conn.query_row(
                "SELECT name FROM providers WHERE id = 'legacy-provider' AND app_type = 'claude'",
                [],
                |row| row.get(0),
            )?
        };
        assert_eq!(provider_name, "Legacy Provider");

        Ok(())
    }

    #[test]
    #[serial]
    fn managed_backup_rejects_path_traversal_inputs() -> Result<(), AppError> {
        let _home = TestHomeGuard::new("cc-switch-managed-backup-path-safety-test");
        let _db = Database::init()?;

        assert!(Database::read_backup_file("../escape.db").is_err());
        assert!(Database::delete_backup("nested/escape.db").is_err());
        assert!(Database::get_backup_entry("..\\escape.db").is_err());
        assert!(Database::import_backup_file(Some("../escape.db"), b"not a sqlite db").is_err());

        Ok(())
    }
}
