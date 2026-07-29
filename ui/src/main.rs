mod model;
mod store;
mod watch;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use clap::Parser;
use slint::{ComponentHandle, ModelRc, VecModel};
use store::{reload_all, SharedStores};

slint::include_modules!();

#[derive(Parser, Debug)]
#[command(name = "oculeau-ui", about = "Read-only Slint sidecar for Oculeau")]
struct Cli {
    #[arg(long)]
    workdir: Option<PathBuf>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let initial_workdir = cli
        .workdir
        .clone()
        .or_else(|| std::env::current_dir().ok())
        .context("no workdir provided and current directory unavailable")?;

    let ui = AppWindow::new()?;
    let stores = Arc::new(Mutex::new(SharedStores {
        events: store::event_store::EventStore::new(initial_workdir.clone()),
        status: store::status_store::StatusStore::new(initial_workdir.clone()),
    }));

    {
        let mut locked = stores.lock().expect("stores lock");
        reload_all(&mut locked)?;
    }
    refresh_ui(&ui, &stores);

    let watcher_cell = Arc::new(Mutex::new(watch::spawn_watcher(initial_workdir)?));
    let ui_weak = ui.as_weak();
    let stores_timer = Arc::clone(&stores);
    let watcher_timer = Arc::clone(&watcher_cell);

    let timer = slint::Timer::default();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(250),
        move || {
            let signals = {
                let watcher = watcher_timer.lock().expect("watcher lock");
                watcher.poll_signals()
            };
            if signals.is_empty() {
                return;
            }

            if let Ok(mut locked) = stores_timer.lock() {
                for signal in signals {
                    let _ = watch::apply_watch_signal(&mut locked, signal);
                }
            }

            if let Some(ui) = ui_weak.upgrade() {
                refresh_ui(&ui, &stores_timer);
            }
        },
    );

    let stores_pick = Arc::clone(&stores);
    let watcher_pick = Arc::clone(&watcher_cell);
    let ui_weak = ui.as_weak();
    ui.on_pick_workdir(move || {
        let Some(path) = rfd::FileDialog::new().pick_folder() else {
            return;
        };

        if let Ok(mut locked) = stores_pick.lock() {
            locked.events.set_workdir(path.clone()).ok();
            locked.status.set_workdir(path.clone());
            locked.status.reload().ok();
        }

        if let Ok(new_watcher) = watch::spawn_watcher(path) {
            *watcher_pick.lock().expect("watcher lock") = new_watcher;
        }

        if let Some(ui) = ui_weak.upgrade() {
            refresh_ui(&ui, &stores_pick);
        }
    });

    ui.run()?;
    Ok(())
}

fn refresh_ui(ui: &AppWindow, stores: &Arc<Mutex<SharedStores>>) {
    let locked = stores.lock().expect("stores lock");
    push_ui(ui, &locked.events, &locked.status);
}

fn push_ui(
    ui: &AppWindow,
    events: &store::event_store::EventStore,
    status: &store::status_store::StatusStore,
) {
    let trace_model: ModelRc<TraceRowData> = ModelRc::new(VecModel::from(
        events
            .trace_rows()
            .into_iter()
            .map(to_trace_row_data)
            .collect::<Vec<_>>(),
    ));
    ui.set_trace_rows(trace_model);

    let chat_model: ModelRc<ChatRowData> = ModelRc::new(VecModel::from(
        events
            .chat_rows()
            .into_iter()
            .map(to_chat_row_data)
            .collect::<Vec<_>>(),
    ));
    ui.set_chat_rows(chat_model);

    let context_model: ModelRc<ContextCardData> = ModelRc::new(VecModel::from(
        events
            .context_cards()
            .into_iter()
            .map(to_context_card_data)
            .collect::<Vec<_>>(),
    ));
    ui.set_context_cards(context_model);

    let snapshot = status.snapshot();
    ui.set_workdir_path(status.workdir_display(events.workdir()).into());
    ui.set_status_phase(
        if snapshot.phase.is_empty() {
            "—".into()
        } else {
            snapshot.phase.clone().into()
        },
    );
    ui.set_status_model(
        if snapshot.model.is_empty() {
            "—".into()
        } else {
            snapshot.model.clone().into()
        },
    );
    ui.set_status_turn(model::format_turn(snapshot.turn).into());
    ui.set_status_context(model::format_context_pct(snapshot.context_pct).into());
}

fn to_trace_row_data(row: model::TraceRow) -> TraceRowData {
    TraceRowData {
        turn: row.turn,
        icon: row.icon.into(),
        label: row.label.into(),
        extra: row.extra.into(),
        body: row.body.into(),
    }
}

fn to_chat_row_data(row: model::ChatRow) -> ChatRowData {
    ChatRowData {
        kind: row.kind.into(),
        turn: row.turn,
        text: row.text.into(),
    }
}

fn to_context_card_data(card: model::ContextCard) -> ContextCardData {
    ContextCardData {
        title: card.title.into(),
        line1: card.line1.into(),
        line2: card.line2.into(),
        line3: card.line3.into(),
        line4: card.line4.into(),
        alert: card.alert.into(),
    }
}
