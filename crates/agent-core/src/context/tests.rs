use serde_json::json;

use super::materialize;
use crate::{
    llm::protocol::{ContentBlock, Message, MessageContent, Role, ToolResultContent},
    session::{CompactionKind, SessionItem, SessionItemBase},
    tools::{ToolCall, ToolContent, ToolResult},
};

fn base(seq: u64) -> SessionItemBase {
    SessionItemBase {
        id: format!("item-{seq}"),
        seq,
        session_id: "session-1".to_owned(),
        turn: 1,
        at: format!("2026-08-17T00:00:0{seq}Z"),
    }
}

fn user(seq: u64, text: &str) -> SessionItem {
    SessionItem::UserMessage {
        base: base(seq),
        text: text.to_owned(),
    }
}

fn assistant(seq: u64, blocks: Vec<ContentBlock>) -> SessionItem {
    SessionItem::AssistantMessage {
        base: base(seq),
        blocks,
    }
}

fn call(seq: u64, id: &str, name: &str, input: serde_json::Value) -> SessionItem {
    SessionItem::ToolCall {
        base: base(seq),
        call: ToolCall::new(id, name, input).expect("test call identity must be valid"),
    }
}

fn result(seq: u64, id: &str, name: &str, content: ToolContent) -> SessionItem {
    let call = ToolCall::new(id, name, json!({})).expect("test call identity must be valid");
    SessionItem::ToolResult {
        base: base(seq),
        result: ToolResult::succeeded(&call, content),
    }
}

fn checkpoint(seq: u64) -> SessionItem {
    SessionItem::CheckpointCreated {
        base: base(seq),
        checkpoint_id: format!("checkpoint-{seq}"),
    }
}

// 场景：session 只包含普通 user 与 assistant item。
// 预期：角色、文本和 assistant blocks 原样映射；不变量/副作用：materialize 只读输入，不产生写入。
#[test]
fn materialize_maps_plain_messages() {
    let items = vec![
        user(0, "hello"),
        assistant(
            1,
            vec![ContentBlock::Text {
                text: "hi".to_owned(),
            }],
        ),
    ];

    let messages = materialize(&items).expect("plain messages should materialize");

    assert_eq!(
        messages,
        vec![
            Message {
                role: Role::User,
                content: MessageContent::Text("hello".to_owned()),
            },
            Message {
                role: Role::Assistant,
                content: MessageContent::Blocks(vec![ContentBlock::Text {
                    text: "hi".to_owned(),
                }]),
            },
        ]
    );
}

// 场景：一个并行 round 包含两个连续 ToolCall，随后按 call 顺序返回两个 ToolResult。
// 预期：materialize 生成一个 assistant tool-use message 和一个 user tool-result message；不变量：每个 call 恰好闭合一次。
#[test]
fn materialize_aggregates_call_and_result_rounds() {
    let items = vec![
        user(0, "inspect"),
        call(1, "call-a", "read_file", json!({"path": "a.rs"})),
        call(2, "call-b", "grep", json!({"pattern": "TODO"})),
        result(3, "call-a", "read_file", ToolContent::Text("a".to_owned())),
        result(4, "call-b", "grep", ToolContent::Text("b".to_owned())),
    ];

    let messages = materialize(&items).expect("closed tool round should materialize");

    assert_eq!(messages.len(), 3);
    assert_eq!(messages[1].role, Role::Assistant);
    assert_eq!(
        messages[1].content,
        MessageContent::Blocks(vec![
            ContentBlock::ToolUse {
                id: "call-a".to_owned(),
                name: "read_file".to_owned(),
                input: json!({"path": "a.rs"}),
            },
            ContentBlock::ToolUse {
                id: "call-b".to_owned(),
                name: "grep".to_owned(),
                input: json!({"pattern": "TODO"}),
            },
        ])
    );
    assert_eq!(messages[2].role, Role::User);
    assert!(matches!(messages[2].content, MessageContent::Blocks(_)));
}

// 场景：两个 call 的 result 按实际完成顺序反向到达。
// 预期：结果 message 保留 Session Item Log 的到达顺序，同时按 id/name 正确配对；不变量：配对不依赖 result 的固定位置。
#[test]
fn materialize_accepts_completion_order_results() {
    let items = vec![
        call(0, "call-a", "read_file", json!({})),
        call(1, "call-b", "grep", json!({})),
        result(2, "call-b", "grep", ToolContent::Text("fast".to_owned())),
        result(
            3,
            "call-a",
            "read_file",
            ToolContent::Text("slow".to_owned()),
        ),
    ];

    let messages = materialize(&items).expect("completion-order results should close round");
    let MessageContent::Blocks(blocks) = &messages[1].content else {
        panic!("tool result message should contain blocks");
    };
    assert_eq!(
        blocks[0],
        ContentBlock::ToolResult {
            tool_use_id: "call-b".to_owned(),
            content: ToolResultContent::Text("fast".to_owned()),
        }
    );
    assert_eq!(
        blocks[1],
        ContentBlock::ToolResult {
            tool_use_id: "call-a".to_owned(),
            content: ToolResultContent::Text("slow".to_owned()),
        }
    );
}

// 场景：checkpoint 位于同一 tool-call round 的 call 之间和 result 之间。
// 预期：checkpoint 不生成 Message，也不刷新聚合 phase；不变量：存档元数据不能改变模型可见边界。
#[test]
fn materialize_keeps_checkpoint_transparent_inside_round() {
    let items = vec![
        call(0, "call-a", "read_file", json!({})),
        checkpoint(1),
        call(2, "call-b", "grep", json!({})),
        result(3, "call-a", "read_file", ToolContent::Text("a".to_owned())),
        checkpoint(4),
        result(5, "call-b", "grep", ToolContent::Text("b".to_owned())),
    ];

    let messages = materialize(&items).expect("checkpoint must not split tool round");

    assert_eq!(messages.len(), 2);
    assert!(matches!(messages[0].content, MessageContent::Blocks(_)));
    assert!(matches!(messages[1].content, MessageContent::Blocks(_)));
}

// 场景：ToolResult 使用 JSON 载荷。
// 预期：模型消息使用紧凑 JSON 文本表示；不变量：ToolResultStatus 仍留在 canonical result，context 不伪造 provider status 字段。
#[test]
fn materialize_serializes_json_result_content() {
    let items = vec![
        call(0, "call-json", "read_file", json!({})),
        result(
            1,
            "call-json",
            "read_file",
            ToolContent::Json(json!({"ok": true, "count": 1})),
        ),
    ];

    let messages = materialize(&items).expect("JSON result should materialize");
    let MessageContent::Blocks(blocks) = &messages[1].content else {
        panic!("tool result message should contain blocks");
    };
    assert_eq!(
        blocks[0],
        ContentBlock::ToolResult {
            tool_use_id: "call-json".to_owned(),
            content: ToolResultContent::Text("{\"count\":1,\"ok\":true}".to_owned()),
        }
    );
}

// 场景：result 在任何 call 之前出现。
// 预期：返回 unknown identity 错误；不变量/副作用：不生成孤立的模型 tool-result message。
#[test]
fn materialize_rejects_result_before_call() {
    let error = materialize(&[result(
        0,
        "call-missing",
        "read_file",
        ToolContent::Text("orphan".to_owned()),
    )])
    .expect_err("orphan result must fail");

    assert!(error.to_string().contains("no preceding tool call"));
}

// 场景：同一 round 内出现重复 tool_use_id。
// 预期：返回 duplicate identity 错误；不变量/副作用：重复调用不能覆盖 pending call。
#[test]
fn materialize_rejects_duplicate_call_identity() {
    let items = vec![
        call(0, "call-dup", "read_file", json!({})),
        call(1, "call-dup", "grep", json!({})),
    ];

    let error = materialize(&items).expect_err("duplicate call identity must fail");
    assert!(error.to_string().contains("duplicate tool call identity"));
}

// 场景：result 的 tool name 与已记录 call 的 name 不一致。
// 预期：返回 name mismatch 错误；不变量/副作用：不能只按 tool_use_id 接受错误工具的结果。
#[test]
fn materialize_rejects_result_name_mismatch() {
    let items = vec![
        call(0, "call-name", "read_file", json!({})),
        result(
            1,
            "call-name",
            "grep",
            ToolContent::Text("wrong".to_owned()),
        ),
    ];

    let error = materialize(&items).expect_err("mismatched result name must fail");
    assert!(error.to_string().contains("tool result name mismatch"));
}

// 场景：上一 round 的 result 尚未闭合，又出现新的 ToolCall。
// 预期：返回顺序错误；不变量/副作用：未闭合 round 不能被第二个 round 交叉污染。
#[test]
fn materialize_rejects_new_call_before_results_close() {
    let items = vec![
        call(0, "call-a", "read_file", json!({})),
        call(1, "call-b", "grep", json!({})),
        result(2, "call-a", "read_file", ToolContent::Text("a".to_owned())),
        call(3, "call-c", "write_file", json!({})),
    ];

    let error = materialize(&items).expect_err("interleaved tool round must fail");
    assert!(error
        .to_string()
        .contains("previous tool result round closed"));
}

// 场景：ToolCall round 结束时仍有未返回的 call。
// 预期：返回 dangling call 错误；不变量/副作用：model step 不能消费未闭合的 tool round。
#[test]
fn materialize_rejects_dangling_call() {
    let error = materialize(&[call(0, "call-dangling", "read_file", json!({}))])
        .expect_err("dangling call must fail");

    assert!(error.to_string().contains("dangling tool call round"));
    assert!(error.to_string().contains("call-dangling/read_file"));
}

// 场景：同一 round 有两个 call，但 EOF 前只收到其中一个 result。
// 预期：返回 dangling call 错误并指出缺失 identity；不变量：round barrier 必须等待全部 call 闭合。
#[test]
fn materialize_rejects_partially_closed_result_round() {
    let items = vec![
        call(0, "call-a", "read_file", json!({})),
        call(1, "call-b", "grep", json!({})),
        result(2, "call-a", "read_file", ToolContent::Text("a".to_owned())),
    ];

    let error = materialize(&items).expect_err("partially closed round must fail");
    assert!(error.to_string().contains("dangling tool call round"));
    assert!(error.to_string().contains("call-b/grep"));
}

// 场景：正常 call 已收到一个 result 后，重复写入同一 result。
// 预期：返回 unknown/duplicate identity 错误；不变量/副作用：一个 call 只能生成一个配对 result。
#[test]
fn materialize_rejects_duplicate_result() {
    let items = vec![
        call(0, "call-once", "read_file", json!({})),
        result(
            1,
            "call-once",
            "read_file",
            ToolContent::Text("ok".to_owned()),
        ),
        result(
            2,
            "call-once",
            "read_file",
            ToolContent::Text("again".to_owned()),
        ),
    ];

    let error = materialize(&items).expect_err("duplicate result must fail");
    assert!(error.to_string().contains("no preceding tool call"));
}

// 场景：普通 user message 出现在 tool round 未闭合期间。
// 预期：返回 phase 顺序错误；不变量/副作用：普通对话消息不能插入 call/result 聚合中。
#[test]
fn materialize_rejects_plain_message_inside_round() {
    let items = vec![
        call(0, "call-a", "read_file", json!({})),
        user(1, "interleaved"),
    ];

    let error = materialize(&items).expect_err("interleaved user message must fail");
    assert!(error.to_string().contains("user message appeared"));
}

// 场景：R1 遇到 Compaction session item。
// 预期：显式返回 unsupported 错误；不变量/副作用：不能静默丢弃尚未定义的 compaction 语义。
#[test]
fn materialize_rejects_compaction_in_r1() {
    let items = vec![SessionItem::Compaction {
        base: base(0),
        compaction_kind: CompactionKind::Prune,
        compaction_save_id: None,
        excluded_item_ids: vec![],
        before_tokens: None,
        after_tokens: None,
    }];

    let error = materialize(&items).expect_err("R1 compaction must be explicit error");
    assert!(error.to_string().contains("does not support compaction"));
}

// 场景：空的 Session Item Log。
// 预期：返回空 message 列表；不变量/副作用：空历史不创建默认 user/assistant 消息。
#[test]
fn materialize_accepts_empty_log() {
    assert!(materialize(&[])
        .expect("empty log should materialize")
        .is_empty());
}

// 场景：检查 context 实现文件的直接依赖边界。
// 预期：materialize 只保留 session、llm protocol 和 tools 依赖；不变量/副作用：禁止未来把 loop、model_input 或上层 runtime 逻辑反向带入 context。
#[test]
fn context_import_boundary_stays_below_orchestration_layers() {
    let sources = [
        ("mod.rs", include_str!("mod.rs")),
        ("materialize.rs", include_str!("materialize.rs")),
    ];

    for (file, source) in sources {
        for forbidden in ["event", "model_input", "loop", "agent", "cli", "scheduler"] {
            assert!(
                !source.contains(forbidden),
                "context source {file} must not mention forbidden dependency {forbidden}"
            );
        }
    }

    let materialize_source = include_str!("materialize.rs");
    assert!(materialize_source.contains("llm::protocol"));
    assert!(materialize_source.contains("session::SessionItem"));
    assert!(materialize_source.contains("tools::"));
}
