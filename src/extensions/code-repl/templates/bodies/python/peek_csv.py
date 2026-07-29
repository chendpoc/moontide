import csv
import json
import sys

# __VARS__

def main() -> None:
    path = __VARS__["path"]
    n = int(__VARS__.get("n", 5))
    rows: list[dict[str, str]] = []
    columns: list[str] = []
    row_count = 0

    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        columns = list(reader.fieldnames or [])
        for row in reader:
            row_count += 1
            if len(rows) < n:
                rows.append(dict(row))

    print(json.dumps({"path": path, "columns": columns, "rows": rows, "row_count": row_count}))

if __name__ == "__main__":
    main()
