use moontide_session::ArtifactStore;
use tempfile::tempdir;

#[test]
fn artifact_put_get_round_trip() {
    let dir = tempdir().unwrap();
    let store = ArtifactStore::new(dir.path());
    let id = store.put("sess-1", "toolu_1", "hello artifact").unwrap();
    assert!(id.starts_with("art_"));
    let content = store.get("sess-1", &id).unwrap();
    assert_eq!(content, "hello artifact");
}
