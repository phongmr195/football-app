"""Sofascore scraper — Events/Lineups/Player ratings/Match statistics.

Đọc 1 file manifest (sinh bởi `apps/sync-worker`'s generate-sofascore-manifest script), với mỗi
match: dùng `soccerdata.Sofascore.read_schedule()` để resolve game_id (khớp tên đội + ngày), sau đó
gọi trực tiếp 3 endpoint Sofascore mà soccerdata KHÔNG wrap (`/lineups`, `/statistics`,
`/incidents`) qua CHÙM session đã bypass Cloudflare sẵn có của soccerdata (`ss._session`, dùng
`tls_requests` giả mạo TLS fingerprint — xem CLAUDE.md § Scraper cho lý do/rủi ro).

KHÔNG đụng Postgres — chỉ đọc manifest.json, ghi output/{ourMatchId}.json. apps/sync-worker chịu
trách nhiệm sinh manifest và ingest kết quả (giữ "Prisma là nơi ghi DB duy nhất").

Chạy:
    python scraper.py manifest.json output/
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any

import soccerdata as sd

REQUEST_DELAY_SECONDS = 3.0

TEAM_SUFFIX_RE = re.compile(r"\b(fc|afc|cf)\b")

CARD_RED_MARKERS = ("red",)
CARD_YELLOW_MARKERS = ("yellow",)
GOAL_OWN_MARKERS = ("own",)
GOAL_PENALTY_MARKERS = ("penalty",)


def normalize(text: str) -> str:
    """Lowercase, bỏ dấu (unicodedata NFKD), chỉ giữ chữ/số/khoảng trắng, gộp khoảng trắng thừa."""
    decomposed = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = re.sub(r"[^a-z0-9\s]", " ", ascii_only.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


# Biệt danh khác nhau giữa nguồn — KHÔNG phải suffix chung (fc/afc/cf, đã xử lý bằng
# TEAM_SUFFIX_RE) mà là rút gọn tên riêng. Phát hiện thật (2026-08-18, đối chiếu toàn bộ 20 đội
# Premier League 2025-26 thật giữa football-data.org và Sofascore): CHỈ 1/20 đội gặp case này —
# "Wolverhampton Wanderers FC" (football-data.org) vs "Wolverhampton" (Sofascore, bỏ hẳn
# "Wanderers", không phải suffix) — khiến toàn bộ 38 trận của đội này (~10% mùa giải) không bao
# giờ resolve được game_id, lặp lại y hệt ở mọi lần chạy backfill cho tới khi fix. 19 đội còn lại
# chỉ khác biệt suffix, TEAM_SUFFIX_RE đã xử lý đúng. Thêm alias mới ở đây nếu gặp case tương tự
# (không dùng substring/prefix match chung — rủi ro nhầm lẫn thật, vd "Manchester United" vs
# "Manchester City" cùng chứa "manchester").
#
# Bundesliga (verify thật 2026-08-18, admin scraper piece, limit=10 mùa 2025-26): football-data.org
# thêm năm thành lập vào tên 1 số đội Đức mà Sofascore không có (hoặc thêm ở vị trí khác trong
# tên) — 3/18 đội gặp case này, cộng 1 đội bị viết tắt khác hẳn:
# - "1. FC Heidenheim 1846" vs Sofascore "1. FC Heidenheim" (năm ở cuối, không phải suffix fc/afc/cf)
# - "FC St. Pauli 1910" vs Sofascore "FC St. Pauli" (tương tự)
# - "TSG 1899 Hoffenheim" vs Sofascore "TSG Hoffenheim" (năm chèn GIỮA tên, không phải đầu/cuối)
# - "Borussia Mönchengladbach" vs Sofascore "Borussia M'gladbach" (viết tắt hẳn "Mönchengladbach"
#   thành "M'gladbach", không liên quan gì tới suffix/năm)
# Giá trị đúng bằng key/value SAU khi qua TEAM_SUFFIX_RE.sub()+normalize() (bao gồm khoảng trắng
# đôi còn sót lại khi "fc" bị xoá giữa chuỗi, vd "1  heidenheim 1846") — verify bằng cách gọi trực
# tiếp normalize_team_name(), không gõ tay để tránh sai lệch.
#
# La Liga/Serie A/Ligue 1 (verify thật 2026-08-19, đối chiếu toàn bộ đội mùa 2025-26 thật giữa
# football-data.org và Sofascore) — khác Premier League/Bundesliga (lệch lẻ tẻ vài đội), ở 3 giải
# này football-data.org dùng tên CLB ĐẦY ĐỦ (kèm hậu tố quốc gia như "RC"/"RCD"/"CA"/"AC"/"SS"/
# "US"/"OGC"/"AJ", "Calcio"/"CFC"/"BC"/"SCO"/"OSC", hoặc "de Madrid"/"de Vigo"/"de Barcelona"),
# Sofascore dùng tên rút gọn thông dụng — lệch GẦN NỬA số đội mỗi giải (La Liga 8/20, Serie A
# 14/20, Ligue 1 9/18), không phải ngoại lệ hiếm như Wolves/Bundesliga. Các hậu tố này KHÔNG thêm
# vào TEAM_SUFFIX_RE (generic hoá rủi ro nhầm lẫn thật, đúng nguyên tắc đã ghi ở trên) — vẫn liệt
# kê alias tường minh dù số lượng nhiều hơn.
TEAM_NAME_ALIASES = {
    # EPL
    "wolverhampton wanderers": "wolverhampton",
    # Bundesliga    
    "1  heidenheim 1846": "1  heidenheim",
    "st pauli 1910": "st pauli",
    "tsg 1899 hoffenheim": "tsg hoffenheim",
    "borussia monchengladbach": "borussia m gladbach",
    # La Liga
    "ca osasuna": "osasuna",
    "club atletico de madrid": "atletico madrid",
    "rayo vallecano de madrid": "rayo vallecano",
    "rc celta de vigo": "celta vigo",
    "rcd espanyol de barcelona": "espanyol",
    "rcd mallorca": "mallorca",
    "real betis balompie": "real betis",
    "real sociedad de futbol": "real sociedad",
    # Serie A
    "ac pisa 1909": "pisa",
    "acf fiorentina": "fiorentina",
    "atalanta bc": "atalanta",
    "bologna  1909": "bologna",
    "cagliari calcio": "cagliari",
    "como 1907": "como",
    "genoa cfc": "genoa",
    "internazionale milano": "inter",
    "parma calcio 1913": "parma",
    "ss lazio": "lazio",
    "udinese calcio": "udinese",
    "us cremonese": "cremonese",
    "us lecce": "lecce",
    "us sassuolo calcio": "sassuolo",
    # Ligue 1
    "aj auxerre": "auxerre",
    "angers sco": "angers",
    "le havre ac": "le havre",
    "lille osc": "lille",
    "ogc nice": "nice",
    "racing club de lens": "rc lens",
    "rc strasbourg alsace": "rc strasbourg",
    "stade brestois 29": "stade brestois",
    "stade rennais  1901": "stade rennais",
}


def normalize_team_name(name: str) -> str:
    stripped = TEAM_SUFFIX_RE.sub("", normalize(name)).strip()
    return TEAM_NAME_ALIASES.get(stripped, stripped)


def match_player(sofascore_name: str, roster: list[dict[str, str]]) -> str | None:
    """So khớp tên cầu thủ Sofascore với roster đã cho (chỉ trong phạm vi 1 đội — an toàn hơn
    fuzzy-match toàn DB). Thử full-name trước, fallback so khớp theo họ (từ cuối) nếu chỉ có đúng
    1 ứng viên khớp — tên cầu thủ quốc tế có dấu/viết tắt khác nhau giữa các nguồn."""
    target = normalize(sofascore_name)
    for player in roster:
        if normalize(player["name"]) == target:
            return player["id"]

    surname = target.split(" ")[-1] if target else ""
    if not surname:
        return None
    candidates = [p for p in roster if normalize(p["name"]).split(" ")[-1] == surname]
    if len(candidates) == 1:
        return candidates[0]["id"]
    return None


def resolve_game_id(schedule: Any, match: dict[str, Any]) -> int | None:
    home_norm = normalize_team_name(match["homeTeamName"])
    away_norm = normalize_team_name(match["awayTeamName"])
    kickoff_date = match["kickoffAt"][:10]  # "YYYY-MM-DD"

    for _, row in schedule.iterrows():
        row_date = str(row["date"])[:10]
        if row_date != kickoff_date:
            continue
        if normalize_team_name(row["home_team"]) == home_norm and normalize_team_name(
            row["away_team"]
        ) == away_norm:
            return int(row["game_id"])
    return None


def classify_event_type(incident: dict[str, Any]) -> str | None:
    incident_type = incident.get("incidentType")
    incident_class = (incident.get("incidentClass") or "").lower()

    if incident_type == "goal":
        if any(m in incident_class for m in GOAL_OWN_MARKERS):
            return "OWN_GOAL"
        if any(m in incident_class for m in GOAL_PENALTY_MARKERS):
            return "PENALTY"
        return "GOAL"
    if incident_type == "card":
        if any(m in incident_class for m in CARD_RED_MARKERS):
            return "RED_CARD"
        if any(m in incident_class for m in CARD_YELLOW_MARKERS):
            return "YELLOW_CARD"
        return None
    if incident_type == "substitution":
        return "SUBSTITUTION"
    if incident_type == "varDecision":
        return "VAR"
    # "period"/"injuryTime"/... — không phải event cầu thủ, bỏ qua có chủ đích.
    return None


def map_events(
    incidents: list[dict[str, Any]],
    home_team_id: str,
    away_team_id: str,
    home_roster: list[dict[str, str]],
    away_roster: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    unmatched: list[str] = []
    typed = [(inc, classify_event_type(inc)) for inc in incidents]
    typed = [(inc, t) for inc, t in typed if t is not None]
    # Sofascore trả incidents theo thứ tự MỚI NHẤT TRƯỚC (verify thật: "FT" period luôn là phần tử
    # đầu) — sort tăng dần theo "time" (phút) để seq đúng thứ tự thời gian thật của trận đấu.
    typed.sort(key=lambda pair: (pair[0].get("time", 0), pair[0].get("addedTime", 0) or 0))

    events = []
    for seq, (incident, event_type) in enumerate(typed, start=1):
        is_home = bool(incident.get("isHome"))
        # Verify thật (2026-08-18): với incidentClass "ownGoal", Sofascore's `isHome` phản ánh đội
        # ĐƯỢC LỢI điểm số (đội đối phương của người đá phản lưới), KHÔNG PHẢI đội của cầu thủ ghi
        # bàn — ví dụ thật: Malo Gusto (Chelsea, đội khách) đá phản lưới, incident có isHome=True.
        # Nếu dùng thẳng isHome để chọn roster sẽ tra nhầm sang đội đối phương, luôn unmatched.
        # Đảo isHome cho riêng case own-goal để tra đúng roster của cầu thủ thật sự ghi bàn.
        player_is_home = (not is_home) if event_type == "OWN_GOAL" else is_home
        team_id = home_team_id if player_is_home else away_team_id
        roster = home_roster if player_is_home else away_roster

        player_id = None
        related_player_id = None
        if event_type == "SUBSTITUTION":
            player_in = (incident.get("playerIn") or {}).get("name")
            player_out = (incident.get("playerOut") or {}).get("name")
            if player_in:
                player_id = match_player(player_in, roster)
                if player_id is None:
                    unmatched.append(player_in)
            if player_out:
                related_player_id = match_player(player_out, roster)
                if related_player_id is None:
                    unmatched.append(player_out)
        else:
            player_name = incident.get("playerName") or (incident.get("player") or {}).get("name")
            if player_name:
                player_id = match_player(player_name, roster)
                if player_id is None:
                    unmatched.append(player_name)
            assist_name = (incident.get("assist1") or {}).get("name")
            if assist_name:
                related_player_id = match_player(assist_name, roster)
                if related_player_id is None:
                    unmatched.append(assist_name)

        events.append(
            {
                "seq": seq,
                "minute": incident.get("time", 0),
                "type": event_type,
                "teamId": team_id,
                "playerId": player_id,
                "relatedPlayerId": related_player_id,
                "detail": incident,
            }
        )
    return events, unmatched


def map_lineup_side(side: dict[str, Any], roster: list[dict[str, str]]) -> tuple[dict, list[dict], list[str]]:
    unmatched: list[str] = []
    players = []
    ratings = []
    for entry in side.get("players", []):
        name = (entry.get("player") or {}).get("name")
        if not name:
            continue
        player_id = match_player(name, roster)
        if player_id is None:
            unmatched.append(name)
            continue
        players.append(
            {
                "playerId": player_id,
                "position": entry.get("position"),
                "shirtNumber": entry.get("shirtNumber"),
                "isStarting": not entry.get("substitute", False),
            }
        )
        stats = entry.get("statistics") or {}
        if "rating" in stats:
            ratings.append({"playerId": player_id, "rating": stats["rating"], "stats": stats})

    lineup = {"formation": side.get("formation"), "players": players}
    return lineup, ratings, unmatched


# Tên field Sofascore (key trong statisticsItems) đã xác nhận thật khớp field đã model hoá ở
# MatchStatistic — chỉ những field chắc chắn đúng, còn lại (kilometersCovered, expectedGoals,
# bigChances, ...) giữ nguyên trong "raw", KHÔNG đoán field chưa verify.
STAT_KEY_MAP = {
    "ballPossession": "possession",
}


def map_statistics(stats_json: dict[str, Any]) -> dict[str, Any] | None:
    groups_by_period = stats_json.get("statistics") or []
    all_period = next((g for g in groups_by_period if g.get("period") == "ALL"), None)
    if not all_period:
        return None

    home: dict[str, Any] = {}
    away: dict[str, Any] = {}
    for group in all_period.get("groups", []):
        for item in group.get("statisticsItems", []):
            key = item.get("key")
            mapped = STAT_KEY_MAP.get(key)
            if mapped:
                home[mapped] = item.get("homeValue")
                away[mapped] = item.get("awayValue")

    return {"home": {**home, "raw": all_period}, "away": {**away, "raw": all_period}}


def is_blocked(resp: Any) -> bool:
    """403 là dấu hiệu Cloudflare/Sofascore chặn (verify thật lúc research — curl không có
    tls_requests bị 403 ngay cả với User-Agent giả), khác 404/500 (lỗi khác, không phải bị chặn)."""
    return resp.status_code == 403


def process_match(client: sd.Sofascore, schedule: Any, match: dict[str, Any], output_dir: Path) -> bool:
    """Trả về True nếu match này bị BLOCK (cả 3 endpoint đều 403) — dùng ở main() để đếm số trận
    liên tiếp bị chặn và dừng sớm, tránh chạy hết cả batch với data rỗng mà không ai biết."""
    match_id = match["ourMatchId"]
    game_id = resolve_game_id(schedule, match)
    if game_id is None:
        print(f"  [{match_id}] KHÔNG tìm thấy game_id Sofascore khớp — bỏ qua.", file=sys.stderr)
        return False

    home_roster = match["homeRoster"]
    away_roster = match["awayRoster"]
    home_team_id = match["homeTeamId"]
    away_team_id = match["awayTeamId"]

    incidents_resp = client._session.get(f"https://api.sofascore.com/api/v1/event/{game_id}/incidents")
    lineups_resp = client._session.get(f"https://api.sofascore.com/api/v1/event/{game_id}/lineups")
    stats_resp = client._session.get(f"https://api.sofascore.com/api/v1/event/{game_id}/statistics")

    if is_blocked(incidents_resp) and is_blocked(lineups_resp) and is_blocked(stats_resp):
        print(f"  [{match_id}] BỊ CHẶN (403 cả 3 endpoint) — game_id={game_id}", file=sys.stderr)
        return True

    unmatched_all: list[str] = []

    events = []
    if incidents_resp.status_code == 200:
        events, unmatched = map_events(
            incidents_resp.json().get("incidents", []), home_team_id, away_team_id, home_roster, away_roster
        )
        unmatched_all.extend(unmatched)

    lineups = None
    ratings: list[dict[str, Any]] = []
    if lineups_resp.status_code == 200:
        data = lineups_resp.json()
        home_lineup, home_ratings, home_unmatched = map_lineup_side(data.get("home", {}), home_roster)
        away_lineup, away_ratings, away_unmatched = map_lineup_side(data.get("away", {}), away_roster)
        lineups = {
            "home": {**home_lineup, "teamId": home_team_id},
            "away": {**away_lineup, "teamId": away_team_id},
        }
        ratings = home_ratings + away_ratings
        unmatched_all.extend(home_unmatched + away_unmatched)

    statistics = None
    if stats_resp.status_code == 200:
        mapped = map_statistics(stats_resp.json())
        if mapped:
            statistics = {
                "home": {**mapped["home"], "teamId": home_team_id},
                "away": {**mapped["away"], "teamId": away_team_id},
            }

    output = {
        "ourMatchId": match_id,
        "sofascoreGameId": game_id,
        "events": events,
        "lineups": lineups,
        "ratings": ratings,
        "statistics": statistics,
        "unmatchedPlayers": sorted(set(unmatched_all)),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{match_id}.json").write_text(json.dumps(output, indent=2, default=str))
    print(f"  [{match_id}] OK — game_id={game_id}, events={len(events)}, ratings={len(ratings)}, "
          f"unmatched={len(set(unmatched_all))}")
    return False


# Số trận LIÊN TIẾP bị block (403 cả 3 endpoint) trước khi dừng hẳn script — không chạy tiếp âm
# thầm cho tới hết batch với hàng loạt output rỗng. 2 là đủ nhạy (1 lần có thể là fluke/lỗi tạm
# thời phía Sofascore) mà không tốn quá nhiều request để xác nhận thật sự bị chặn.
BLOCK_THRESHOLD_CONSECUTIVE_MATCHES = 2


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Đường dẫn manifest.json (sinh bởi sync-worker)")
    parser.add_argument("output_dir", type=Path, help="Thư mục ghi output JSON, 1 file/match")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text())
    cache_dir = Path(__file__).parent / ".cache"

    client = sd.Sofascore(
        leagues=manifest["competitionKey"],
        seasons=manifest["season"],
        data_dir=cache_dir,
    )
    schedule = client.read_schedule()

    matches = manifest["matches"]
    print(f"Tìm thấy {len(matches)} match trong manifest, bắt đầu scrape...")
    consecutive_blocked = 0
    for i, match in enumerate(matches):
        blocked = process_match(client, schedule, match, args.output_dir)
        consecutive_blocked = consecutive_blocked + 1 if blocked else 0
        if consecutive_blocked >= BLOCK_THRESHOLD_CONSECUTIVE_MATCHES:
            print(
                f"\nDỪNG SỚM: {consecutive_blocked} trận liên tiếp bị chặn (403) — có vẻ IP đã bị "
                f"Sofascore/Cloudflare chặn. Đã xử lý {i + 1}/{len(matches)} trận trước khi dừng. "
                "Đợi 1 lúc rồi thử lại, hoặc dùng proxy/tor (xem tham số `proxy` của soccerdata.Sofascore).",
                file=sys.stderr,
            )
            sys.exit(1)
        if i < len(matches) - 1:
            time.sleep(REQUEST_DELAY_SECONDS)

    print("Xong.")


if __name__ == "__main__":
    main()
