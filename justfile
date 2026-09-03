default: check

build:
    cargo build --workspace

test:
    cargo test --workspace

fmt:
    cargo +nightly fmt --all

check:
    cargo +nightly fmt --all --check
    cargo clippy --workspace --all-targets
    cargo test --workspace

# pre-commit hook: fast gate on commit (fmt + clippy)
pre-commit:
    cargo +nightly fmt --all --check
    cargo clippy --workspace --all-targets -- -D warnings

# pre-push hook: full test suite before push
pre-push:
    cargo test --workspace
