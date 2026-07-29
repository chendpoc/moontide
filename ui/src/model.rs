use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_EVENTS: usize = 2000;
pub const OCULEAU_DIR: &str = ".oculeau";
pub const EVENTS_FILE: &str = "events.jsonl";
pub const STATUS_FILE: &str = "status.json";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,
    pub seq: u64,
    pub run_id: String,
    pub turn: i32,
    pub phase: String,
    pub channel: String,
    pub kind: String,
    pub ts: i64,
    pub payload: Value,
    #[serde(default)]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub workdir: String,
    pub turn: Option<i32>,
    pub context_pct: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct TraceRow {
    pub turn: i32,
    pub icon: String,
    pub label: String,
    pub extra: String,
    pub body: String,
}

#[derive(Debug, Clone)]
pub struct ChatRow {
    pub kind: String,
    pub turn: i32,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct ContextCard {
    pub title: String,
    pub line1: String,
    pub line2: String,
    pub line3: String,
    pub line4: String,
    pub alert: String,
}

pub fn truncate(text: &str, max: usize) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= max {
        one_line
    } else {
        let trimmed: String = one_line.chars().take(max.saturating_sub(1)).collect();
        format!("{trimmed}…")
    }
}

fn pad_turn(turn: i32) -> String {
    format!("{turn:02}")
}

fn fmt_num(value: i64) -> String {
    let s = value.to_string();
    let mut out = String::new();
    for (index, ch) in s.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out.chars().rev().collect()
}

fn payload_str(event: &AgentEvent, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = event.payload.get(*key).and_then(Value::as_str) {
            return value.to_string();
        }
    }
    event.preview.clone().unwrap_or_default()
}

pub fn trace_row_from_event(event: &AgentEvent) -> Option<TraceRow> {
    if event.channel != "trace" {
        return None;
    }

    match event.kind.as_str() {
        "thinking" => Some(TraceRow {
            turn: event.turn,
            icon: "💭".into(),
            label: "think".into(),
            extra: String::new(),
            body: truncate(&format!("\"{}\"", payload_str(event, &["body"])), 120),
        }),
        "tool_use" => {
            let tool_name = payload_str(event, &["toolName"]);
            Some(TraceRow {
                turn: event.turn,
                icon: "🔧".into(),
                label: "tool".into(),
                extra: tool_name,
                body: truncate(&payload_str(event, &["body"]), 120),
            })
        }
        "tool_result" => Some(TraceRow {
            turn: event.turn,
            icon: "✓".into(),
            label: "result".into(),
            extra: payload_str(event, &["toolName"]),
            body: truncate(&payload_str(event, &["body"]), 120),
        }),
        "assistant_text" => Some(TraceRow {
            turn: event.turn,
            icon: "→".into(),
            label: "out".into(),
            extra: String::new(),
            body: truncate(&payload_str(event, &["body"]), 120),
        }),
        _ => None,
    }
}

pub fn chat_row_from_event(event: &AgentEvent) -> Option<ChatRow> {
    if event.channel != "conversation" {
        return None;
    }

    match event.kind.as_str() {
        "user_prompt" => Some(ChatRow {
            kind: "user_prompt".into(),
            turn: event.turn,
            text: payload_str(event, &["text"]),
        }),
        "final" => Some(ChatRow {
            kind: "final".into(),
            turn: event.turn,
            text: payload_str(event, &["text"]),
        }),
        _ => None,
    }
}

fn token_bar(percent: f64, width: usize) -> String {
    let clamped = percent.clamp(0.0, 100.0);
    let filled = ((clamped / 100.0) * width as f64).round() as usize;
    format!(
        "{}{}",
        "█".repeat(filled),
        "░".repeat(width.saturating_sub(filled))
    )
}

pub fn context_card_from_event(event: &AgentEvent) -> Option<ContextCard> {
    if event.channel != "context" {
        return None;
    }

    if event.kind == "context_compact" {
        let before = event
            .payload
            .get("beforeTokens")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let after = event
            .payload
            .get("afterTokens")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let mode = event
            .payload
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("prune");
        return Some(ContextCard {
            title: format!("Compact · turn {}", pad_turn(event.turn)),
            line1: format!(
                "compact {mode} {}→{} (saved {})",
                fmt_num(before),
                fmt_num(after),
                fmt_num(before - after)
            ),
            line2: String::new(),
            line3: String::new(),
            line4: String::new(),
            alert: String::new(),
        });
    }

    let report = event.payload.get("report")?;
    let limit = report.get("limit").and_then(Value::as_i64).unwrap_or(0);
    let headroom = report.get("headroom").and_then(Value::as_i64).unwrap_or(0);
    let percent_used = report
        .get("percentUsed")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let exact = report.get("exactTokens").and_then(Value::as_i64);
    let estimated = report
        .get("estimatedTokens")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let tokens = exact.unwrap_or(estimated);
    let kind = if exact.is_some() { "exact" } else { "est" };

    let alert = report
        .get("alerts")
        .and_then(Value::as_array)
        .and_then(|alerts| alerts.first())
        .and_then(|alert| alert.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    match event.kind.as_str() {
        "metrics_pre" => Some(ContextCard {
            title: format!("CONTEXT · turn {} · pre", pad_turn(event.turn)),
            line1: format!(
                "Tokens  {} / {}  {}",
                fmt_num(tokens),
                fmt_num(limit),
                kind
            ),
            line2: format!(
                "Usage   {:.1}%  {}",
                percent_used,
                token_bar(percent_used, 20)
            ),
            line3: format!("Headroom {}", fmt_num(headroom)),
            line4: String::new(),
            alert,
        }),
        "metrics_post" => {
            let usage = report.get("usage")?;
            let input = usage.get("inputTokens").and_then(Value::as_i64)?;
            let output = usage
                .get("outputTokens")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            let trend_line = report
                .get("trend")
                .map(|trend| {
                    let delta = trend.get("deltaTokens").and_then(Value::as_i64).unwrap_or(0);
                    let cumulative = trend
                        .get("cumulativeTokens")
                        .and_then(Value::as_i64)
                        .unwrap_or(0);
                    let delta_str = if delta >= 0 {
                        format!("+{}", fmt_num(delta))
                    } else {
                        fmt_num(delta)
                    };
                    format!("Trend  Δ {delta_str}  cumulative {}", fmt_num(cumulative))
                })
                .unwrap_or_default();

            Some(ContextCard {
                title: format!("CONTEXT · turn {} · post", pad_turn(event.turn)),
                line1: format!("Usage  in={}  out={}", fmt_num(input), fmt_num(output)),
                line2: trend_line,
                line3: String::new(),
                line4: String::new(),
                alert,
            })
        }
        _ => None,
    }
}

pub fn format_context_pct(value: Option<f64>) -> String {
    match value {
        Some(pct) => format!("{pct:.1}%"),
        None => "—".into(),
    }
}

pub fn format_turn(value: Option<i32>) -> String {
    match value {
        Some(turn) => turn.to_string(),
        None => "—".into(),
    }
}
