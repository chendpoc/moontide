use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::model::ACTIVE_EVENTS_SUFFIX;
use crate::store::{reload_all, SharedStores};

pub enum WatchSignal {
    Events,
    EventsReset,
    Status,
    Rescan,
}

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    receiver: Receiver<WatchSignal>,
}

fn is_active_events(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(ACTIVE_EVENTS_SUFFIX))
}

fn send_event_signal(tx: &Sender<WatchSignal>, event: &Event) {
    for path in &event.paths {
        if is_active_events(path) {
            let signal = match event.kind {
                EventKind::Create(_) | EventKind::Remove(_) => WatchSignal::EventsReset,
                EventKind::Modify(notify::event::ModifyKind::Name(_)) => WatchSignal::EventsReset,
                _ => WatchSignal::Events,
            };
            let _ = tx.send(signal);
        } else if path.ends_with("status.json") {
            let _ = tx.send(WatchSignal::Status);
        }
    }
}

pub fn spawn_watcher(workdir: PathBuf) -> Result<FileWatcher> {
    let (tx, rx) = mpsc::channel();
    let signal_tx = tx.clone();
    let watch_dir = workdir.join(".ocula");
    let watch_dir_for_closure = watch_dir.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            let Ok(event) = result else {
                return;
            };
            send_event_signal(&signal_tx, &event);
            if event.paths.iter().any(|path| path == &watch_dir_for_closure) {
                let _ = signal_tx.send(WatchSignal::Rescan);
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(300)),
    )
    .context("create file watcher")?;

    if watch_dir.exists() {
        watcher
            .watch(&watch_dir, RecursiveMode::Recursive)
            .with_context(|| format!("watch {}", watch_dir.display()))?;
    } else {
        watcher
            .watch(&workdir, RecursiveMode::NonRecursive)
            .with_context(|| format!("watch {}", workdir.display()))?;
    }

    let _ = tx.send(WatchSignal::Rescan);

    Ok(FileWatcher {
        _watcher: watcher,
        receiver: rx,
    })
}

impl FileWatcher {
    pub fn poll_signals(&self) -> Vec<WatchSignal> {
        let mut signals = Vec::new();
        while let Ok(signal) = self.receiver.try_recv() {
            signals.push(signal);
        }
        signals
    }
}

pub fn apply_watch_signal(stores: &mut SharedStores, signal: WatchSignal) -> Result<bool> {
    match signal {
        WatchSignal::Events => stores.events.reload_tail(),
        WatchSignal::EventsReset => stores.events.reload_active_segment(),
        WatchSignal::Status => {
            let mut changed = stores.status.reload()?;
            let run_id = match stores.status.snapshot().run_id.as_str() {
                "" => None,
                value => Some(value.to_string()),
            };
            changed |= stores.events.set_run_id(run_id)?;
            Ok(changed)
        }
        WatchSignal::Rescan => reload_all(stores).map(|_| true),
    }
}
