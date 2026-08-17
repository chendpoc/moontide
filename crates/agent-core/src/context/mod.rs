//! Read-only materialization from the Session Item Log to model messages.

mod materialize;

#[allow(unused_imports)]
pub(crate) use materialize::materialize;

#[cfg(test)]
mod tests;
