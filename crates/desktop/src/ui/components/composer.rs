use iced::widget::{button, row, text_editor};
use iced::Element;

use super::super::{composer as state_composer, UiMessage, UiState};
use super::controls::{primary_button, secondary_button};

pub fn composer(state: &UiState) -> Element<'_, UiMessage> {
    let mode = state_composer::mode(state);
    let mut editor = text_editor(&state.input)
        .placeholder("Message")
        .min_height(64)
        .max_height(160);
    if mode == state_composer::ComposerMode::Editable {
        editor = editor
            .on_action(UiMessage::ComposerAction)
            .key_binding(state_composer::key_binding);
    }

    let primary = match mode {
        state_composer::ComposerMode::Editable => primary_button("Send")
            .on_press_maybe((!state.input.text().trim().is_empty()).then_some(UiMessage::Submit)),
        state_composer::ComposerMode::Active => secondary_button("Stop").on_press(UiMessage::Stop),
        state_composer::ComposerMode::Submitting => button("Loading"),
        state_composer::ComposerMode::Cancelling => button("Cancelling"),
        state_composer::ComposerMode::Disabled => button("Disabled"),
    };

    row![editor, primary].spacing(8).into()
}
