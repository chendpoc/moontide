#![allow(
    dead_code,
    reason = "RenderState fields are consumed by the D3 Iced shell"
)]

mod fold;
mod model;
mod projection;
#[cfg(test)]
mod tests;

pub(crate) use model::*;
