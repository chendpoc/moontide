//! Semantic translation between MoonTide protocol and wire formats (no HTTP).

#![allow(dead_code)] // R3 adapter layer will call these entry points.

pub mod anthropic_messages;
pub mod common;
pub mod openai_chat;
