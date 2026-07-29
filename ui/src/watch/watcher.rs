use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::store::{reload_all, SharedStores};

pub enum WatchSignal {
    Events,
    Status,
    Rescan,
}

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
    receiver: Receiver<WatchSignal>,
    workdir: PathBuf,
}

pub fn spawn_watcher(workdir: PathBuf) -> Result<FileWatcher> {
    let (tx, rx) = mpsc::channel();
    let signal_tx = tx.clone();
    let watch_dir = workdir.join(".oculeau");
    let watch_dir_for_closure = watch_dir.clone();

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| {
            let Ok(event) = result else {
                return;
            };
            if matches!(event.kind, EventKind::Any | EventKind::Access(_) | EventKind::Modify(_)) {
                for path in event.paths {
                    if path.ends_with("events.jsonl") {
                        let _ = signal_tx.send(WatchSignal::Events);
                    } else if path.ends_with("status.json") {
                        let _ = signal_tx.send(WatchSignal::Status);
                    } else if path == watch_dir_for_closure {
                        let _ = signal_tx.send(WatchSignal::Rescan);
                    }
                }
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(300)),
    )
    .context("create file watcher")?;

    if watch_dir.exists() {
        watcher
            .watch(&watch_dir, RecursiveMode::NonRecursive)
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
        workdir,
    })
}

impl FileWatcher {
    pub fn workdir(&self) -> &Path {
        &self.workdir
    }

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
        WatchSignal::Status => stores.status.reload(),
        WatchSignal::Rescan => reload_all(stores).map(|_| true),
    }
}
