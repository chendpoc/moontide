default: check

build:
    cargo build --workspace

test:
    cargo test --workspace

fmt:
    cargo fmt --all

check:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets
    cargo test --workspace

run *ARGS:
    cargo run -p moontide-cli -- {{ARGS}}

ui:
    cargo run -p moontide-ui -- --workdir .
