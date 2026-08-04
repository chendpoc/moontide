import json
import sys

# __VARS__

def main() -> None:
    max_chars = int(__VARS__.get("max_chars", 20000))
    if __VARS__.get("path"):
        with open(__VARS__["path"], encoding="utf-8") as f:
            data = json.load(f)
    elif __VARS__.get("text"):
        data = json.loads(__VARS__["text"])
    else:
        print(json.dumps({"error": "path or text required"}))
        sys.exit(1)
    pretty = json.dumps(data, indent=2, ensure_ascii=False)
    if len(pretty) > max_chars:
        pretty = pretty[:max_chars] + "\n... (truncated)"
    print(pretty)

if __name__ == "__main__":
    main()
