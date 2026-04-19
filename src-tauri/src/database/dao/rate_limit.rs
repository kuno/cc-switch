use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::proxy::rate_limit::RateLimitSnapshot;

impl Database {
    pub fn flush_rate_limit_snapshots(
        &self,
        snapshots: &[RateLimitSnapshot],
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);

        conn.execute("DELETE FROM rate_limit_snapshots", [])
            .map_err(|e| AppError::Database(e.to_string()))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        for s in snapshots {
            let json = serde_json::to_string(s)
                .map_err(|e| AppError::Database(format!("JSON serialization failed: {e}")))?;
            conn.execute(
                "INSERT INTO rate_limit_snapshots (provider_id, snapshot_json, updated_at)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![s.provider_id, json, now],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }

        Ok(())
    }

    pub fn load_rate_limit_snapshots(&self) -> Vec<RateLimitSnapshot> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("Failed to lock DB for rate limit load: {e}");
                return Vec::new();
            }
        };

        let mut stmt = match conn.prepare("SELECT snapshot_json FROM rate_limit_snapshots") {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to query rate_limit_snapshots: {e}");
                return Vec::new();
            }
        };

        let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
            Ok(r) => r,
            Err(e) => {
                log::warn!("Failed to read rate_limit_snapshots: {e}");
                return Vec::new();
            }
        };

        let mut result = Vec::new();
        for row in rows {
            if let Ok(json) = row {
                match serde_json::from_str::<RateLimitSnapshot>(&json) {
                    Ok(s) => result.push(s),
                    Err(e) => log::warn!("Skipping malformed rate limit snapshot: {e}"),
                }
            }
        }
        result
    }
}
