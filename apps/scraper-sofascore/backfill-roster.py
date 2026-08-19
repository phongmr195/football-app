"""Backfill Player cho team roster RỖNG trong DB (football-data.org 403 — team đã rời giải
free-tier "hiện tại", xem CLAUDE.md § Scraper) — dùng Sofascore's /team/{id}/players làm gap-fill,
KHÔNG thay thế football-data.org cho team đã có data (đúng nguyên tắc "1 nguồn canonical mỗi loại
entity" — chỉ backfill khi nguồn chính không lấy được).

KHÔNG đụng Postgres — chỉ đọc roster-manifest.json (sinh bởi
generate-roster-backfill-manifest.ts), ghi roster-output/{ourTeamId}.json. apps/sync-worker chịu
trách nhiệm ingest (giữ "Prisma là nơi ghi DB duy nhất").

Chạy:
    python backfill-roster.py roster-manifest.json roster-output/
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import soccerdata as sd

from scraper import normalize_team_name

REQUEST_DELAY_SECONDS = 3.0

BASE_URL = "https://api.sofascore.com/api/v1"

# Sofascore chỉ trả position dạng 1 chữ (G/D/M/F, verify thật 2026-08-19) — khác football-data.org
# (chuỗi chi tiết hơn vd "Centre-Back"/"Attacking Midfield"). Map về đúng 4 giá trị "broad category"
# ĐÃ xuất hiện thật trong DB hiện có (Goalkeeper/Defence/Midfield/Offence) — nhất quán 1 phần dữ
# liệu football-data.org cũ, không tạo giá trị mới lạ.
POSITION_MAP = {
    "G": "Goalkeeper",
    "D": "Defence",
    "M": "Midfield",
    "F": "Offence",
}


def resolve_team_id(client: sd.Sofascore, team_name: str) -> int | None:
    """Tìm Sofascore team id qua /search/all — verify thật 2026-08-19: có thể trả nhiều đội trùng
    tên (khác giới, khác cấp độ U19/B) nên PHẢI lọc gender="M" + sport football + tên khớp CHÍNH
    XÁC sau normalize_team_name (tránh nhầm sang đội nữ/trẻ cùng tên, case thật: "Real Oviedo" có
    cả bản nam id=2851 VÀ bản nữ id=114821 cùng tên, khác gender)."""
    resp = client._session.get(f"{BASE_URL}/search/all?q={quote(team_name)}")
    if resp.status_code != 200:
        return None
    target = normalize_team_name(team_name)
    candidates = [
        r["entity"]
        for r in resp.json().get("results", [])
        if r.get("type") == "team"
        and r["entity"].get("sport", {}).get("slug") == "football"
        and r["entity"].get("gender") == "M"
        and normalize_team_name(r["entity"]["name"]) == target
    ]
    if len(candidates) != 1:
        return None
    return candidates[0]["id"]


def map_roster(players_json: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mapped = []
    for entry in players_json:
        player = entry.get("player") or {}
        name = player.get("name")
        if not name:
            continue
        dob = player.get("dateOfBirth")
        mapped.append(
            {
                "sofascorePlayerId": player["id"],
                "name": name,
                "position": POSITION_MAP.get(player.get("position") or ""),
                "nationality": (player.get("country") or {}).get("name"),
                "dateOfBirth": dob,
                "heightCm": player.get("height"),
            }
        )
    return mapped


def process_team(client: sd.Sofascore, team: dict[str, Any], output_dir: Path) -> None:
    our_team_id = team["ourTeamId"]
    team_name = team["teamName"]
    sofascore_team_id = resolve_team_id(client, team_name)
    if sofascore_team_id is None:
        print(f"  [{team_name}] KHÔNG resolve được Sofascore team id — bỏ qua.", file=sys.stderr)
        return

    resp = client._session.get(f"{BASE_URL}/team/{sofascore_team_id}/players")
    if resp.status_code != 200:
        print(f"  [{team_name}] GET /team/{sofascore_team_id}/players trả {resp.status_code} — bỏ qua.", file=sys.stderr)
        return

    roster = map_roster(resp.json().get("players", []))
    output = {"ourTeamId": our_team_id, "teamName": team_name, "sofascoreTeamId": sofascore_team_id, "players": roster}
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{our_team_id}.json").write_text(json.dumps(output, indent=2, default=str))
    print(f"  [{team_name}] OK — sofascore_team_id={sofascore_team_id}, {len(roster)} player")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Đường dẫn roster-manifest.json (sinh bởi sync-worker)")
    parser.add_argument("output_dir", type=Path, help="Thư mục ghi output JSON, 1 file/team")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    cache_dir = Path(__file__).parent / ".cache"

    client = sd.Sofascore(
        leagues=manifest["competitionKey"],
        seasons=manifest["season"],
        data_dir=cache_dir,
    )

    teams = manifest["teams"]
    print(f"Tìm thấy {len(teams)} team cần backfill roster, bắt đầu...")
    for i, team in enumerate(teams):
        process_team(client, team, args.output_dir)
        if i < len(teams) - 1:
            time.sleep(REQUEST_DELAY_SECONDS)

    print("Xong.")


if __name__ == "__main__":
    main()
