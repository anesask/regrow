"""AI progress reports: a short plain-language report per demo plot in English, German and Turkish.

Written by the model only from the plot's facts sheet (regrow_api.reports.facts: the published pipeline numbers), and
checked: every number in the text must appear in the facts, otherwise the model gets one retry and an unverified
report is not published. Pre-written here so the live site spends nothing on them.

Inputs: data/results.json, data/plots.geojson, an OpenAI key (.env). Output: data/ai_reports.json
Usage: uv run python pipeline/15_ai_reports.py [--model=gpt-5] [plot-id ...]
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from regrow_api import ai, reports

from common import DATA_DIR


def main() -> None:
    plots = json.loads((DATA_DIR / "plots.geojson").read_text(encoding="utf-8"))["features"]
    args = [a for a in sys.argv[1:] if not a.startswith("--model=")]
    model = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--model=")), None)
    ids = args or [f["properties"]["id"] for f in plots if f["properties"].get("kind") == "plot"]
    out_path = DATA_DIR / "ai_reports.json"
    out = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"plots": {}}
    before = ai.spent()
    for pid in ids:
        rep = reports.write_report(pid, model=model)
        out["plots"][pid] = rep
        print(pid, "verified" if rep["verified"] else f"NOT verified {rep.get('unsupported')}", f"attempts {rep.get('attempts', 2)}")
        if rep["verified"]:
            print("   en:", rep["en"][:160])
    out["method"] = {
        "model": model or ai.model_name(), "provider": "openai",
        "promptSha256": reports.hashlib.sha256(reports.REPORT_PROMPT.encode()).hexdigest()[:12],
        "check": "every number in the text appears in the plot's facts sheet; unverified text is not published",
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    out_path.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"estimated cost of this run: ${ai.spent() - before:.4f}")


if __name__ == "__main__":
    main()
