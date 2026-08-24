use iced::widget::text_editor;

use super::{UiMessage, UiState};

pub(super) fn keyboard_message(event: iced::keyboard::Event) -> Option<UiMessage> {
    let iced::keyboard::Event::KeyPressed { key, repeat, .. } = event else {
        return None;
    };

    if repeat {
        return None;
    }

    match key {
        iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape) => Some(UiMessage::Escape),
        _ => None,
    }
}

pub(super) fn key_binding(
    key_press: text_editor::KeyPress,
) -> Option<text_editor::Binding<UiMessage>> {
    if matches!(
        key_press.key,
        iced::keyboard::Key::Named(iced::keyboard::key::Named::Enter)
    ) && key_press.modifiers.command()
    {
        Some(text_editor::Binding::Custom(UiMessage::Submit))
    } else if matches!(
        key_press.key,
        iced::keyboard::Key::Named(iced::keyboard::key::Named::Escape)
    ) {
        Some(text_editor::Binding::Custom(UiMessage::Escape))
    } else {
        text_editor::Binding::from_key_press(key_press)
    }
}

pub(super) fn active_turn(run: &crate::DesktopRunState) -> bool {
    matches!(
        run,
        crate::DesktopRunState::Thinking { .. }
            | crate::DesktopRunState::RunningTool { .. }
            | crate::DesktopRunState::WaitingApproval { .. }
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ComposerMode {
    Editable,
    Active,
    Submitting,
    Cancelling,
    Disabled,
}

pub(super) fn mode(state: &UiState) -> ComposerMode {
    mode_for(
        &state.render_state.run,
        state.submit_in_flight,
        state.cancellation_in_flight,
    )
}

pub(super) fn mode_for(
    run: &crate::DesktopRunState,
    submit_in_flight: bool,
    cancellation_in_flight: bool,
) -> ComposerMode {
    if cancellation_in_flight {
        return ComposerMode::Cancelling;
    }
    if submit_in_flight {
        return ComposerMode::Submitting;
    }

    match run {
        crate::DesktopRunState::Idle | crate::DesktopRunState::Failed { .. } => {
            ComposerMode::Editable
        }
        crate::DesktopRunState::Thinking { .. }
        | crate::DesktopRunState::RunningTool { .. }
        | crate::DesktopRunState::WaitingApproval { .. } => ComposerMode::Active,
        crate::DesktopRunState::Cancelling { .. } | crate::DesktopRunState::Stopping => {
            ComposerMode::Cancelling
        }
        crate::DesktopRunState::Starting | crate::DesktopRunState::Stopped => {
            ComposerMode::Disabled
        }
    }
}

pub(super) fn allows_edit(state: &UiState) -> bool {
    mode(state) == ComposerMode::Editable
}

pub(super) fn allows_submit(state: &UiState) -> bool {
    allows_edit(state)
}

pub(super) fn allows_stop(state: &UiState) -> bool {
    mode(state) == ComposerMode::Active
}

pub(super) fn allows_approval(state: &UiState) -> bool {
    mode(state) == ComposerMode::Active
        && matches!(
            state.render_state.run,
            crate::DesktopRunState::WaitingApproval { .. }
        )
}

pub(super) fn refresh_command_phase(state: &mut UiState) {
    if state.submit_in_flight && active_turn(&state.render_state.run) {
        state.submit_in_flight = false;
    }
    if state.cancellation_in_flight
        && !active_turn(&state.render_state.run)
        && !matches!(
            state.render_state.run,
            crate::DesktopRunState::Cancelling { .. }
        )
    {
        state.cancellation_in_flight = false;
    }
}
