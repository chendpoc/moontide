default: check

# rustfmt/clippy scope: Cargo workspace members under crates/ only (not scripts/, frontend/, etc.)
workspace_packages := "-p agent-core -p agent-tools -p agent -p cli -p moontide-desktop"

build:
    cargo build --workspace

test:
    cargo test --workspace

fmt:
    cargo +nightly fmt {{workspace_packages}}

check:
    cargo +nightly fmt {{workspace_packages}} --check
    cargo clippy --workspace --all-targets
    cargo test --workspace

# pre-commit hook: fast gate on commit (fmt + clippy)
pre-commit:
    cargo +nightly fmt {{workspace_packages}} --check
    cargo clippy --workspace --all-targets -- -D warnings
    cargo clippy --workspace --all-targets -- -D warnings

# pre-push hook: full test suite before push
pre-push:
    cargo test --workspace
