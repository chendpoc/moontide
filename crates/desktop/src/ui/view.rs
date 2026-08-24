use iced::widget::{button, column, container, row, text};
use iced::{Element, Fill};

use super::{components, UiMessage, UiState};

pub(super) fn view(state: &UiState) -> Element<'_, UiMessage> {
    let conversation = components::cards::conversation(state);
    let content: Element<'_, UiMessage> = if state.inspector_open {
        row![conversation, components::inspector::inspector(state)]
            .spacing(12)
            .height(Fill)
            .into()
    } else {
        conversation
    };

    container(
        column![
            top_bar(state),
            components::cards::notice_list(state),
            content,
            components::cards::approval_list(state),
            components::composer::composer(state),
        ]
        .spacing(12)
        .padding(16),
    )
    .width(Fill)
    .height(Fill)
    .into()
}

fn top_bar(state: &UiState) -> Element<'static, UiMessage> {
    row![
        text(format!("MoonTide · {:?}", state.render_state.run)).width(Fill),
        button(if state.inspector_open {
            "Hide Inspector"
        } else {
            "Inspector"
        })
        .on_press(UiMessage::ToggleInspector),
    ]
    .spacing(8)
    .into()
}
