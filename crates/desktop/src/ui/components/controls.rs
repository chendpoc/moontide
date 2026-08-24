use iced::widget::{button, container};
use iced::Element;

use super::super::UiMessage;

pub(super) fn primary_button<'a>(
    label: impl Into<Element<'a, UiMessage>>,
) -> button::Button<'a, UiMessage> {
    button(label).style(button::primary)
}

pub(super) fn secondary_button<'a>(
    label: impl Into<Element<'a, UiMessage>>,
) -> button::Button<'a, UiMessage> {
    button(label).style(button::secondary)
}

pub(super) fn text_button<'a>(
    label: impl Into<Element<'a, UiMessage>>,
) -> button::Button<'a, UiMessage> {
    button(label).style(button::text)
}

pub(super) fn danger_button<'a>(
    label: impl Into<Element<'a, UiMessage>>,
) -> button::Button<'a, UiMessage> {
    button(label).style(button::danger)
}

pub(super) fn panel<'a>(
    content: impl Into<Element<'a, UiMessage>>,
) -> container::Container<'a, UiMessage> {
    container(content)
        .style(container::bordered_box)
        .padding(12)
}

pub(super) fn card<'a>(
    content: impl Into<Element<'a, UiMessage>>,
) -> container::Container<'a, UiMessage> {
    container(content).style(container::rounded_box).padding(8)
}
