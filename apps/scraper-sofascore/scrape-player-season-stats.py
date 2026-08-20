"""Scrape thống kê nâng cao theo mùa giải cho MỌI cầu thủ lọt top-50 ở ÍT NHẤT 1 trong 33 category
(Sofascore's /unique-tournament/{id}/season/{id}/top-players/overall, xem CLAUDE.md § Scraper) —
KHÁC scraper.py (theo TỪNG match) — đây là 1 lần fetch DUY NHẤT cho cả competition/season (verify
thật: cả 33 category nằm trong CÙNG 1 response's `topPlayers` dict, KHÔNG phải 1 request/category).

KHÔNG đụng Postgres — chỉ đọc player-season-stats-manifest.json (sinh bởi
generate-player-season-stats-manifest.ts), ghi 1 file output duy nhất. apps/sync-worker chịu
trách nhiệm ingest (giữ "Prisma là nơi ghi DB duy nhất").

Chạy:
    python scrape-player-season-stats.py player-season-stats-manifest.json output.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import soccerdata as sd

from scraper import match_player, normalize_team_name

BASE_URL = "https://api.sofascore.com/api/v1"

# 33 category thật (verify thật 2026-08-19/20, xem CLAUDE.md § Scraper) — mỗi category là top-50
# CỦA CATEGORY ĐÓ (KHÔNG phải toàn giải), 1 cầu thủ có thể lọt category này mà không lọt category
# khác.
CATEGORIES = [
    "rating", "goals", "expectedGoals", "assists", "expectedAssists", "goalsAssistsSum",
    "kilometersCovered", "numberOfSprints", "kilometersCoveredPer90", "numberOfSprintsPer90",
    "topSpeed", "penaltyGoals", "freeKickGoal", "scoringFrequency", "totalShots", "shotsOnTarget",
    "bigChancesMissed", "bigChancesCreated", "accuratePasses", "keyPasses", "accurateLongBalls",
    "successfulDribbles", "penaltyWon", "tackles", "interceptions", "clearances", "possessionLost",
    "yellowCards", "redCards", "saves", "goalsPrevented", "mostConceded", "leastConceded", "cleanSheet",
]

# Field nào map thẳng vào cột riêng của PlayerStatistics — PHẢI khớp tên field Prisma (xem migration
# extend_player_statistics_advanced_fields). Còn lại (22 category khác) giữ trong "raw" mỗi
# cầu thủ, không model hoá riêng.
MODELED_FIELDS = {
    "rating", "expectedGoals", "expectedAssists", "tackles", "interceptions", "keyPasses",
    "successfulDribbles", "kilometersCovered", "topSpeed", "saves", "cleanSheet",
    "goals", "assists", "yellowCards", "redCards",
}


def merge_player_entries(client: sd.Sofascore, tournament_id: int, season_id: int) -> dict[int, dict[str, Any]]:
    """Gọi endpoint 1 LẦN (trả nguyên 33 category cùng lúc), merge theo Sofascore player id — 1
    cầu thủ có thể xuất hiện ở nhiều category, mỗi lần merge thêm field mới vào entry đã có.
    `appearances` nằm TRONG `statistics` của MỌI category (không phải category riêng, verify thật
    — vd entry category "yellowCards" của James Garner có cả `appearances: 38`), merge luôn."""
    resp = client._session.get(f"{BASE_URL}/unique-tournament/{tournament_id}/season/{season_id}/top-players/overall")
    if resp.status_code != 200:
        print(f"GET top-players/overall trả {resp.status_code} — dừng.", file=sys.stderr)
        return {}

    top_players = resp.json().get("topPlayers", {})
    merged: dict[int, dict[str, Any]] = {}
    for category in CATEGORIES:
        for entry in top_players.get(category, []):
            player = entry.get("player") or {}
            team = entry.get("team") or {}
            player_id = player.get("id")
            if player_id is None:
                continue
            record = merged.setdefault(
                player_id,
                {"name": player.get("name"), "teamName": team.get("name"), "raw": {}},
            )
            stats = entry.get("statistics") or {}
            if category in stats:
                record["raw"][category] = stats[category]
            if "appearances" in stats:
                record["raw"]["appearances"] = stats["appearances"]
    return merged


def resolve_players(
    merged: dict[int, dict[str, Any]], teams: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    rosters_by_team_norm = {normalize_team_name(t["teamName"]): t["roster"] for t in teams}
    full_roster = [player for t in teams for player in t["roster"]]
    unmatched: list[str] = []
    resolved = []
    for record in merged.values():
        team_name = record.get("teamName")
        roster = rosters_by_team_norm.get(normalize_team_name(team_name)) if team_name else None
        player_id = match_player(record["name"], roster) if roster else None
        if player_id is None:
            # Fallback: team Sofascore gắn cho cầu thủ này là team HIỆN TẠI (lúc scrape), KHÔNG
            # PHẢI team lúc đá mùa giải đang xét — verify thật 2026-08-20: mùa 2025-26 đã kết thúc,
            # qua kỳ chuyển nhượng hè, Sofascore's season top-players vẫn tag theo team CURRENT (vd
            # "Antoine Semenyo" bị tag "Manchester City" nhưng DB đúng "AFC Bournemouth" — nơi anh
            # THẬT SỰ đá mùa 2025-26). Thử lại trên TOÀN BỘ cầu thủ cả giải (không giới hạn 1 team)
            # — vẫn an toàn vì match_player() chỉ nhận khi ĐÚNG 1 ứng viên, dù pool rộng hơn.
            player_id = match_player(record["name"], full_roster)
        if player_id is None:
            unmatched.append(f"{record.get('name')} ({team_name})")
            continue

        raw = record["raw"]
        entry: dict[str, Any] = {"playerId": player_id, "raw": raw}
        for field in MODELED_FIELDS:
            if field in raw:
                entry[field] = raw[field]
        if "appearances" in raw:
            entry["appearances"] = raw["appearances"]
        resolved.append(entry)
    return resolved, unmatched


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Đường dẫn player-season-stats-manifest.json")
    parser.add_argument("output", type=Path, help="Đường dẫn file output JSON (1 file duy nhất)")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    cache_dir = Path(__file__).parent / ".cache"

    client = sd.Sofascore(
        leagues=manifest["competitionKey"],
        seasons=manifest["season"],
        data_dir=cache_dir,
    )
    season_row = client.read_seasons().iloc[0]
    tournament_id = int(season_row["league_id"])
    season_id = int(season_row["season_id"])
    print(f"Sofascore tournament_id={tournament_id}, season_id={season_id}")

    merged = merge_player_entries(client, tournament_id, season_id)
    print(f"Tìm thấy {len(merged)} cầu thủ (lọt top-50 ít nhất 1/{len(CATEGORIES)} category).")

    resolved, unmatched = resolve_players(merged, manifest["teams"])

    output = {"seasonId": manifest["seasonId"], "players": resolved, "unmatchedPlayers": sorted(set(unmatched))}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, default=str))
    print(f"OK — {len(resolved)} player resolved, {len(set(unmatched))} unmatched.")


if __name__ == "__main__":
    main()
