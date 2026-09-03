use std::path::PathBuf;

use anyhow::Result;

use crate::protocol as wire;

const EXCERPT_MAX_CHARS: usize = 80;

pub(super) fn list_rows(
    sessions_dir: PathBuf,
    loaded_session_id: Option<&str>,
) -> Result<Vec<wire::SessionCatalogRowDto>> {
    let query = agent::SessionQuery::new(sessions_dir);
    let mut rows =
        query.map_snapshots(|snapshot| row_from_snapshot(&snapshot, loaded_session_id))?;
    rows.sort_by(|left, right| {
        right
            .last_activity_at
            .cmp(&left.last_activity_at)
            .then_with(|| right.session_id.cmp(&left.session_id))
    });
    Ok(rows)
}

fn row_from_snapshot(
    snapshot: &agent::SessionSnapshot,
    loaded_session_id: Option<&str>,
) -> wire::SessionCatalogRowDto {
    wire::SessionCatalogRowDto {
        session_id: snapshot.summary.session_id.clone(),
        first_user_message_excerpt: snapshot
            .items
            .iter()
            .find_map(agent::SessionItem::text)
            .and_then(excerpt),
        last_activity_at: snapshot.items.last().map(|item| item.base().at.clone()),
        loaded: loaded_session_id == Some(snapshot.summary.session_id.as_str()),
    }
}

fn excerpt(text: &str) -> Option<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return None;
    }
    let mut chars = normalized.chars();
    let excerpt = chars.by_ref().take(EXCERPT_MAX_CHARS).collect::<String>();
    Some(if chars.next().is_some() {
        format!("{excerpt}…")
    } else {
        excerpt
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use agent::SessionItem;
    use agent_core::session::SessionItemBase;

    use super::*;

    fn snapshot(session_id: &str, at: &str, text: &str) -> agent::SessionSnapshot {
        agent::SessionSnapshot {
            summary: agent::SessionSummary {
                session_id: session_id.into(),
                cwd: PathBuf::from("/workspace"),
                last_turn: Some(0),
                item_count: 1,
            },
            items: vec![SessionItem::UserMessage {
                base: SessionItemBase {
                    id: format!("item-{session_id}"),
                    seq: 0,
                    session_id: session_id.into(),
                    turn: 0,
                    at: at.into(),
                },
                text: text.into(),
            }],
        }
    }

    // 场景：catalog 将 Session Item Log 投影为一条可显示的 loaded row。
    // 预期：首条用户消息被规范化并截断，最后活动时间来自最后一条 SessionItem。
    // 不变量：row metadata 是只读派生值，不写回 Session 持久化格式。
    #[test]
    fn catalog_row_derives_display_metadata_without_persisted_title() {
        let long_text = format!("hello   {}", "MoonTide ".repeat(20));
        let row = row_from_snapshot(
            &snapshot("session-1", "2026-09-01T08:00:00Z", &long_text),
            Some("session-1"),
        );

        assert_eq!(row.session_id, "session-1");
        assert!(
            row.first_user_message_excerpt
                .as_deref()
                .is_some_and(|excerpt| excerpt.ends_with('…'))
        );
        assert_eq!(
            row.last_activity_at.as_deref(),
            Some("2026-09-01T08:00:00Z")
        );
        assert!(row.loaded);
    }
}
