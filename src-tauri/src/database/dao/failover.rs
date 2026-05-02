//! 故障转移队列 DAO
//!
//! 管理代理模式下的故障转移队列（基于 providers 表的 in_failover_queue 字段）

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::provider::Provider;
use serde::{Deserialize, Serialize};

/// 故障转移队列条目（简化版，用于前端展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailoverQueueItem {
    pub provider_id: String,
    pub provider_name: String,
    pub sort_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_notes: Option<String>,
}

impl Database {
    /// 获取故障转移队列（桌面端按显式队列顺序）
    #[cfg(feature = "tauri-desktop")]
    pub fn get_failover_queue(&self, app_type: &str) -> Result<Vec<FailoverQueueItem>, AppError> {
        let conn = lock_conn!(self.conn);

        let mut stmt = conn
            .prepare(
                "SELECT id, name, sort_index, notes
                 FROM providers
                 WHERE app_type = ?1 AND in_failover_queue = 1
                 ORDER BY COALESCE(sort_index, 999999), id ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let items = stmt
            .query_map([app_type], |row| {
                Ok(FailoverQueueItem {
                    provider_id: row.get(0)?,
                    provider_name: row.get(1)?,
                    sort_index: row.get(2)?,
                    provider_notes: row.get(3)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(items)
    }

    /// 获取故障转移队列（OpenWrt 端按可见 provider 顺序过滤）
    #[cfg(not(feature = "tauri-desktop"))]
    pub fn get_failover_queue(&self, app_type: &str) -> Result<Vec<FailoverQueueItem>, AppError> {
        let items = self
            .get_all_providers_by_display_order(app_type)?
            .into_values()
            .filter(|provider| provider.in_failover_queue)
            .enumerate()
            .map(|(index, provider)| FailoverQueueItem {
                provider_id: provider.id,
                provider_name: provider.name,
                sort_index: Some(index),
                provider_notes: provider.notes,
            })
            .collect();

        Ok(items)
    }

    /// 获取故障转移队列中的供应商（完整 Provider 信息，按顺序）
    pub fn get_failover_providers(&self, app_type: &str) -> Result<Vec<Provider>, AppError> {
        #[cfg(feature = "tauri-desktop")]
        let all_providers = self.get_all_providers(app_type)?;
        #[cfg(not(feature = "tauri-desktop"))]
        let all_providers = self.get_all_providers_by_display_order(app_type)?;

        let result: Vec<Provider> = all_providers
            .into_values()
            .filter(|p| p.in_failover_queue)
            .collect();

        Ok(result)
    }

    /// 添加供应商到故障转移队列
    #[cfg(feature = "tauri-desktop")]
    pub fn add_to_failover_queue(&self, app_type: &str, provider_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);

        let already_queued = conn
            .query_row(
                "SELECT in_failover_queue FROM providers WHERE id = ?1 AND app_type = ?2",
                rusqlite::params![provider_id, app_type],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::Database(format!("provider {provider_id} not found for {app_type}"))
                }
                e => AppError::Database(e.to_string()),
            })?;

        if already_queued {
            return Ok(());
        }

        let next_sort_index: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(COALESCE(sort_index, 999999)), -1) + 1
                 FROM providers
                 WHERE app_type = ?1 AND in_failover_queue = 1",
                [app_type],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        conn.execute(
            "UPDATE providers
             SET in_failover_queue = 1, sort_index = ?3
             WHERE id = ?1 AND app_type = ?2",
            rusqlite::params![provider_id, app_type, next_sort_index],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    /// 添加供应商到故障转移队列（OpenWrt 端仅记录 membership）
    #[cfg(not(feature = "tauri-desktop"))]
    pub fn add_to_failover_queue(&self, app_type: &str, provider_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);

        let already_queued = conn
            .query_row(
                "SELECT in_failover_queue FROM providers WHERE id = ?1 AND app_type = ?2",
                rusqlite::params![provider_id, app_type],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::Database(format!("provider {provider_id} not found for {app_type}"))
                }
                e => AppError::Database(e.to_string()),
            })?;

        if already_queued {
            return Ok(());
        }

        conn.execute(
            "UPDATE providers
             SET in_failover_queue = 1
             WHERE id = ?1 AND app_type = ?2",
            rusqlite::params![provider_id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    /// 重排故障转移队列顺序
    #[cfg(feature = "tauri-desktop")]
    pub fn reorder_failover_queue(
        &self,
        app_type: &str,
        provider_ids: &[String],
    ) -> Result<(), AppError> {
        let current_queue = self.get_failover_queue(app_type)?;

        if current_queue.len() != provider_ids.len() {
            return Err(AppError::Database(
                "failover queue reorder must include every queued provider exactly once"
                    .to_string(),
            ));
        }

        let mut current_ids = current_queue
            .iter()
            .map(|entry| entry.provider_id.clone())
            .collect::<Vec<_>>();
        let mut next_ids = provider_ids.to_vec();
        current_ids.sort();
        next_ids.sort();

        if current_ids != next_ids {
            return Err(AppError::Database(
                "failover queue reorder received a provider set that does not match the current queue"
                    .to_string(),
            ));
        }

        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        for (index, provider_id) in provider_ids.iter().enumerate() {
            let updated = tx
                .execute(
                    "UPDATE providers
                     SET sort_index = ?3
                     WHERE id = ?1 AND app_type = ?2 AND in_failover_queue = 1",
                    rusqlite::params![provider_id, app_type, index as i32],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;

            if updated != 1 {
                return Err(AppError::Database(format!(
                    "failed to reorder queued provider {provider_id}"
                )));
            }
        }

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    /// 重排故障转移队列顺序（OpenWrt 端以 provider 可见顺序为准）
    #[cfg(not(feature = "tauri-desktop"))]
    pub fn reorder_failover_queue(
        &self,
        app_type: &str,
        provider_ids: &[String],
    ) -> Result<(), AppError> {
        let current_queue = self.get_failover_queue(app_type)?;

        if current_queue.len() != provider_ids.len() {
            return Err(AppError::Database(
                "failover queue reorder must include every queued provider exactly once"
                    .to_string(),
            ));
        }

        let mut current_ids = current_queue
            .iter()
            .map(|entry| entry.provider_id.clone())
            .collect::<Vec<_>>();
        let mut next_ids = provider_ids.to_vec();
        current_ids.sort();
        next_ids.sort();

        if current_ids != next_ids {
            return Err(AppError::Database(
                "failover queue reorder received a provider set that does not match the current queue"
                    .to_string(),
            ));
        }

        Ok(())
    }

    /// 从故障转移队列中移除供应商
    pub fn remove_from_failover_queue(
        &self,
        app_type: &str,
        provider_id: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);

        // 1. 从队列中移除
        conn.execute(
            "UPDATE providers SET in_failover_queue = 0 WHERE id = ?1 AND app_type = ?2",
            rusqlite::params![provider_id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // 2. 清除该供应商的健康状态（退出队列后不再需要健康监控）
        conn.execute(
            "DELETE FROM provider_health WHERE provider_id = ?1 AND app_type = ?2",
            rusqlite::params![provider_id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        log::info!("已从故障转移队列移除供应商 {provider_id} ({app_type}), 并清除其健康状态");

        Ok(())
    }

    /// 清空故障转移队列
    pub fn clear_failover_queue(&self, app_type: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);

        conn.execute(
            "UPDATE providers SET in_failover_queue = 0 WHERE app_type = ?1",
            [app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    /// 检查供应商是否在故障转移队列中
    pub fn is_in_failover_queue(
        &self,
        app_type: &str,
        provider_id: &str,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);

        let in_queue: bool = conn
            .query_row(
                "SELECT in_failover_queue FROM providers WHERE id = ?1 AND app_type = ?2",
                rusqlite::params![provider_id, app_type],
                |row| row.get(0),
            )
            .unwrap_or(false);

        Ok(in_queue)
    }

    /// 获取可添加到故障转移队列的供应商（不在队列中的）
    pub fn get_available_providers_for_failover(
        &self,
        app_type: &str,
    ) -> Result<Vec<Provider>, AppError> {
        #[cfg(feature = "tauri-desktop")]
        let all_providers = self.get_all_providers(app_type)?;
        #[cfg(not(feature = "tauri-desktop"))]
        let all_providers = self.get_all_providers_by_display_order(app_type)?;

        let available: Vec<Provider> = all_providers
            .into_values()
            .filter(|p| !p.in_failover_queue)
            .collect();

        Ok(available)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use serde_json::json;

    fn save_provider(db: &Database, app_type: &str, id: &str, in_failover_queue: bool) {
        let mut provider = Provider::with_id(
            id.to_string(),
            id.to_string(),
            json!({"base_url": "https://example.test"}),
            None,
        );
        provider.in_failover_queue = in_failover_queue;
        db.save_provider(app_type, &provider)
            .expect("save provider");
    }

    #[cfg(feature = "tauri-desktop")]
    #[test]
    fn add_to_failover_queue_appends_after_legacy_null_sort_entries() {
        let db = Database::memory().expect("db");
        save_provider(&db, "claude", "provider-b", true);
        save_provider(&db, "claude", "provider-a", false);

        db.add_to_failover_queue("claude", "provider-a")
            .expect("queue provider a");

        let queue = db.get_failover_queue("claude").expect("queue");
        let ids = queue
            .iter()
            .map(|item| item.provider_id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["provider-b", "provider-a"]);
        assert!(
            queue[1].sort_index.expect("new provider sort index")
                > queue[0].sort_index.unwrap_or(999999)
        );
    }

    #[cfg(not(feature = "tauri-desktop"))]
    #[test]
    fn failover_queue_uses_visible_provider_order_for_queued_providers() {
        let db = Database::memory().expect("db");
        save_provider(&db, "claude", "provider-a", false);
        save_provider(&db, "claude", "provider-b", false);
        save_provider(&db, "claude", "provider-c", false);

        db.add_to_failover_queue("claude", "provider-c")
            .expect("queue provider c");
        db.add_to_failover_queue("claude", "provider-b")
            .expect("queue provider b");

        let queue = db
            .get_failover_queue("claude")
            .expect("queue before reorder");
        assert_eq!(
            queue
                .iter()
                .map(|item| item.provider_id.as_str())
                .collect::<Vec<_>>(),
            vec!["provider-b", "provider-c"]
        );
        assert_eq!(
            queue.iter().map(|item| item.sort_index).collect::<Vec<_>>(),
            vec![Some(0), Some(1)]
        );

        db.reorder_providers(
            "claude",
            &[
                "provider-c".to_string(),
                "provider-a".to_string(),
                "provider-b".to_string(),
            ],
        )
        .expect("reorder providers");

        let reordered_queue = db
            .get_failover_queue("claude")
            .expect("queue after reorder");
        assert_eq!(
            reordered_queue
                .iter()
                .map(|item| item.provider_id.as_str())
                .collect::<Vec<_>>(),
            vec!["provider-c", "provider-b"]
        );
        assert_eq!(
            reordered_queue
                .iter()
                .map(|item| item.sort_index)
                .collect::<Vec<_>>(),
            vec![Some(0), Some(1)]
        );
    }

    #[cfg(not(feature = "tauri-desktop"))]
    #[test]
    fn reorder_failover_queue_does_not_override_visible_provider_order() {
        let db = Database::memory().expect("db");
        save_provider(&db, "claude", "provider-a", false);
        save_provider(&db, "claude", "provider-b", false);
        save_provider(&db, "claude", "provider-c", false);

        db.add_to_failover_queue("claude", "provider-a")
            .expect("queue provider a");
        db.add_to_failover_queue("claude", "provider-c")
            .expect("queue provider c");
        db.reorder_providers(
            "claude",
            &[
                "provider-c".to_string(),
                "provider-a".to_string(),
                "provider-b".to_string(),
            ],
        )
        .expect("reorder providers");

        db.reorder_failover_queue(
            "claude",
            &["provider-a".to_string(), "provider-c".to_string()],
        )
        .expect("reorder queue");

        let queue = db
            .get_failover_queue("claude")
            .expect("queue after no-op reorder");
        assert_eq!(
            queue
                .iter()
                .map(|item| item.provider_id.as_str())
                .collect::<Vec<_>>(),
            vec!["provider-c", "provider-a"]
        );
    }
}
