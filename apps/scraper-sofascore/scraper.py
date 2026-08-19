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


# Ký tự Latin mở rộng KHÔNG decompose được qua NFKD (khác các ký tự có dấu thường gặp như é/ö/ñ —
# NFKD tách được thành base+combining mark, combining mark bị strip đúng ở normalize()) — verify
# thật 2026-08-19: "ø" (Filip Jørgensen, Sofascore, Chelsea) bị regex `[^a-z0-9\s]` xoá hẳn như dấu
# câu thay vì fold về "o", khiến "Jørgensen" -> "jrgensen" lệch hẳn khỏi "jorgensen" (từ DB's "Filip
# Jörgensen", "ö" decompose được nên khớp đúng) — cùng 1 người, 2 ký tự Bắc Âu khác nhau, không tự
# match được. Thêm bảng fold tay cho ký tự Latin mở rộng phổ biến trong tên cầu thủ (Bắc Âu/Balkan/
# Ba Lan/Iceland/Romania) không tự decompose được qua NFKD.
EXTRA_CHAR_FOLDS = {
    "ø": "o",
    "Ø": "o",
    "æ": "ae",
    "Æ": "ae",
    "đ": "d",
    "Đ": "d",
    "ð": "d",
    "Ð": "d",
    "þ": "th",
    "Þ": "th",
    "ł": "l",
    "Ł": "l",
    "ț": "t",
    "Ț": "t",
    "ș": "s",
    "Ș": "s",
    "ß": "ss",
}


def normalize(text: str) -> str:
    """Lowercase, bỏ dấu (unicodedata NFKD), chỉ giữ chữ/số/khoảng trắng, gộp khoảng trắng thừa."""
    for char, replacement in EXTRA_CHAR_FOLDS.items():
        text = text.replace(char, replacement)
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


# Nickname/tên sân cỏ KHÔNG suy ra được bằng quy tắc chung (khác họ đôi/mononym ở fallback dưới) —
# verify thật 2026-08-19: "Gavi" (Sofascore, cách gọi phổ biến toàn cầu) vs DB's "Pablo Gavira"
# (football-data.org, giữ họ cha "Gavira", bỏ tên + họ mẹ "Martín Páez") — đối chiếu dateOfBirth
# (2004-08-05) xác nhận CÙNG 1 người thật, không phải trùng tên ngẫu nhiên. Key/value đã qua
# normalize() — thêm entry mới khi gặp case thật tương tự, KHÔNG đoán trước tên nickname chưa gặp.
PLAYER_NAME_ALIASES = {
    "gavi": "pablo gavira",
}


def match_player(sofascore_name: str, roster: list[dict[str, str]]) -> str | None:
    """So khớp tên cầu thủ Sofascore với roster đã cho (chỉ trong phạm vi 1 đội — an toàn hơn
    fuzzy-match toàn DB). Thử full-name trước, sau đó 2 fallback (chỉ áp dụng nếu ĐÚNG 1 ứng viên
    khớp — tránh match nhầm khi có nhiều khả năng)."""
    target = normalize(sofascore_name)
    target = PLAYER_NAME_ALIASES.get(target, target)
    for player in roster:
        if normalize(player["name"]) == target:
            return player["id"]

    target_words = target.split(" ") if target else []
    if not target_words:
        return None

    # Fallback 1: so khớp theo HỌ — coi mọi từ SAU từ đầu tiên (tên) là "họ", khớp nếu 2 bên có ÍT
    # NHẤT 1 từ họ trùng nhau. Rộng hơn "chỉ so từ cuối" (bản đầu viết) để xử lý thêm: họ ĐÔI kiểu
    # Tây Ban Nha/Bồ Đào Nha — verify thật 2026-08-19, DB lưu đủ 2 họ ("Jofre Carreras **Pagès**",
    # "Ángel Fortuño **Viñas**") nhưng Sofascore/truyền thông chỉ dùng họ cha ("Jofre Carreras",
    # "Angel Fortuno"), bỏ hẳn họ mẹ ở CUỐI — so khớp CHỈ từ cuối sẽ luôn lệch cho case này. Vẫn an
    # toàn: chỉ match khi ĐÚNG 1 ứng viên có họ trùng (roster đã giới hạn 1 đội).
    target_surnames = set(target_words[1:]) if len(target_words) > 1 else set(target_words)
    surname_candidates = []
    for player in roster:
        db_words = normalize(player["name"]).split(" ")
        db_surnames = set(db_words[1:]) if len(db_words) > 1 else set(db_words)
        if target_surnames & db_surnames:
            surname_candidates.append(player)
    if len(surname_candidates) == 1:
        return surname_candidates[0]["id"]

    # Fallback 2: 1 bên là mononym (tên 1 từ, thường gặp ở cầu thủ Brazil/Bồ Đào Nha — verify thật
    # 2026-08-19: DB lưu "Reinildo" nhưng Sofascore trả tên đầy đủ "Reinildo Mandava") — so khớp
    # nếu tên mononym (dù ở bên nào) TRÙNG NGUYÊN 1 từ của tên đầy đủ bên kia.
    mononym_candidates = []
    for player in roster:
        db_words = normalize(player["name"]).split(" ")
        is_db_mononym_match = len(db_words) == 1 and db_words[0] in target_words
        is_target_mononym_match = len(target_words) == 1 and target_words[0] in db_words
        if is_db_mononym_match or is_target_mononym_match:
            mononym_candidates.append(player)
    if len(mononym_candidates) == 1:
        return mononym_candidates[0]["id"]

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


# 9 loại data admin chọn được ở trang admin scraper (khớp SCRAPER_DATA_TYPES ở
# apps/api/src/scraper-competitions.ts — KHÔNG import chung được, 2 ngôn ngữ khác nhau, xem
# CLAUDE.md § Scraper). Value là path Sofascore thật SAU "/event/{game_id}" (verify thật
# 2026-08-19, xem CLAUDE.md § Scraper cho bảng inventory đầy đủ).
DATA_TYPE_ENDPOINTS = {
    "events": "incidents",
    "lineups": "lineups",
    "statistics": "statistics",
    "commentary": "comments",
    "shotmap": "shotmap",
    "highlights": "highlights",
    "averagePositions": "average-positions",
    "momentum": "graph",
    "odds": "odds/1/all",
}


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


# Sort theo `id` (thứ tự đăng thật của Sofascore, tăng dần đơn điệu — verify thật: có lệch nhỏ 1-2
# phút ở vài chỗ so với `time` do nhiều comment đăng gần như đồng thời, chấp nhận được) — KHÔNG
# sort theo `time` như bản đầu viết: verify thật 2026-08-19 phát hiện bug thật qua kiểm tra DB sau
# khi ingest — comment loại "meta" (`endFirstHalf`/`endSecondHalf`/`matchEnded`) THIẾU HẲN field
# `time` (không phải bằng 0), `.get("time", 0)` trả về 0 khiến 3 dòng "kết thúc trận" bị sort lên
# ĐẦU seq (sai hoàn toàn thứ tự thời gian thật). Fix: sort theo `id`, `minute` của comment thiếu
# `time` kế thừa (carry-forward) minute của comment gần nhất TRƯỚC nó có `time` thật.
def map_comments(comments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(comments, key=lambda c: c.get("id", 0))
    result = []
    last_minute = 0
    for seq, c in enumerate(ordered, start=1):
        minute = c.get("time")
        if minute is None:
            minute = last_minute
        else:
            last_minute = minute
        result.append({"minute": minute, "seq": seq, "text": c.get("text", "")})
    return result


# Verify thật 2026-08-19: mỗi shot LUÔN có playerCoordinates/shotType/situation/time/player.name —
# không cần fallback rỗng cho các field này, chỉ xg/xgot/bodyPart có thể null tuỳ loại cú sút.
def map_shotmap(
    shots: list[dict[str, Any]],
    home_team_id: str,
    away_team_id: str,
    home_roster: list[dict[str, str]],
    away_roster: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    unmatched: list[str] = []
    mapped = []
    for shot in shots:
        is_home = bool(shot.get("isHome"))
        # Own goal — cùng bug đã fix ở map_events(): `isHome` phản ánh đội ĐƯỢC LỢI điểm số, KHÔNG
        # PHẢI đội của cầu thủ đá phản lưới (verify thật 2026-08-19: Malo Gusto, Chelsea/đội khách,
        # đá phản lưới có `isHome: true`, `goalType: "own"` — dùng thẳng isHome sẽ tra nhầm sang
        # roster đối phương, luôn unmatched). Đảo isHome riêng cho case own-goal trước khi chọn
        # team/roster.
        is_own_goal = shot.get("goalType") == "own"
        player_is_home = (not is_home) if is_own_goal else is_home
        team_id = home_team_id if player_is_home else away_team_id
        roster = home_roster if player_is_home else away_roster
        player_name = (shot.get("player") or {}).get("name")
        player_id = None
        if player_name:
            player_id = match_player(player_name, roster)
            if player_id is None:
                unmatched.append(player_name)
        coords = shot.get("playerCoordinates") or {}
        mapped.append(
            {
                "teamId": team_id,
                "playerId": player_id,
                "minute": shot.get("time", 0),
                "shotType": shot.get("shotType", ""),
                "situation": shot.get("situation"),
                "bodyPart": shot.get("bodyPart"),
                "xg": shot.get("xg"),
                "xgot": shot.get("xgot"),
                "x": coords.get("x", 0),
                "y": coords.get("y", 0),
                "raw": shot,
            }
        )
    return mapped, unmatched


# `url`/`sourceUrl` trong response thật thường trùng giá trị (verify 2026-08-19) — chỉ lấy `url`,
# bỏ qua entry thiếu url (hiếm, phòng hờ dữ liệu thiếu).
def map_highlights(highlights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"title": h.get("title", ""), "url": h["url"], "thumbnailUrl": h.get("thumbnailUrl")}
        for h in highlights
        if h.get("url")
    ]


def map_average_positions(
    data: dict[str, Any],
    home_team_id: str,
    away_team_id: str,
    home_roster: list[dict[str, str]],
    away_roster: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    unmatched: list[str] = []
    mapped = []
    for side_key, team_id, roster in (
        ("home", home_team_id, home_roster),
        ("away", away_team_id, away_roster),
    ):
        for entry in data.get(side_key, []):
            player_name = (entry.get("player") or {}).get("name")
            if not player_name:
                continue
            player_id = match_player(player_name, roster)
            if player_id is None:
                unmatched.append(player_name)
                continue
            mapped.append(
                {
                    "teamId": team_id,
                    "playerId": player_id,
                    "averageX": entry.get("averageX", 0),
                    "averageY": entry.get("averageY", 0),
                }
            )
    return mapped, unmatched


# Verify thật 2026-08-19: `minute` có giá trị dạng "90.5" (phút bù giờ) — giữ nguyên kiểu số thật
# (float), KHÔNG ép int (khác MatchEvent.minute, xem MatchMomentum.minute ở schema.prisma).
def map_momentum(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"minute": p.get("minute", 0), "value": p.get("value", 0)} for p in data.get("graphPoints", [])]


# Verify thật 2026-08-19: 1 trận có thể có NHIỀU market cùng `marketName` (vd "Match goals" lặp lại
# ứng với nhiều mốc Over/Under) — dùng `id` (Sofascore's market id, KHÔNG phải `marketId`) làm khoá
# thật, không dùng marketName. Giữ nguyên cả object market vào `raw` — mức ưu tiên thấp, không tách
# field chi tiết.
def map_odds(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"sofascoreMarketId": m["id"], "marketName": m.get("marketName", ""), "raw": m}
        for m in data.get("markets", [])
        if m.get("id") is not None
    ]


def is_blocked(resp: Any) -> bool:
    """403 là dấu hiệu Cloudflare/Sofascore chặn (verify thật lúc research — curl không có
    tls_requests bị 403 ngay cả với User-Agent giả), khác 404/500 (lỗi khác, không phải bị chặn)."""
    return resp.status_code == 403


def process_match(
    client: sd.Sofascore, schedule: Any, match: dict[str, Any], output_dir: Path, data_types: set[str]
) -> bool:
    """Trả về True nếu match này bị BLOCK (403 ở TẤT CẢ endpoint ĐANG được gọi cho run này — endpoint
    của loại data không được chọn không tính) — dùng ở main() để đếm số trận liên tiếp bị chặn và
    dừng sớm, tránh chạy hết cả batch với data rỗng mà không ai biết."""
    match_id = match["ourMatchId"]
    game_id = resolve_game_id(schedule, match)
    if game_id is None:
        print(f"  [{match_id}] KHÔNG tìm thấy game_id Sofascore khớp — bỏ qua.", file=sys.stderr)
        return False

    home_roster = match["homeRoster"]
    away_roster = match["awayRoster"]
    home_team_id = match["homeTeamId"]
    away_team_id = match["awayTeamId"]

    responses = {
        data_type: client._session.get(f"https://api.sofascore.com/api/v1/event/{game_id}/{endpoint}")
        for data_type, endpoint in DATA_TYPE_ENDPOINTS.items()
        if data_type in data_types
    }

    if responses and all(is_blocked(r) for r in responses.values()):
        print(
            f"  [{match_id}] BỊ CHẶN (403 ở cả {len(responses)} endpoint đang gọi) — game_id={game_id}",
            file=sys.stderr,
        )
        return True

    unmatched_all: list[str] = []
    output: dict[str, Any] = {"ourMatchId": match_id, "sofascoreGameId": game_id}
    summary_counts: dict[str, int] = {}

    if "events" in data_types:
        events: list[dict[str, Any]] = []
        resp = responses["events"]
        if resp.status_code == 200:
            events, unmatched = map_events(
                resp.json().get("incidents", []), home_team_id, away_team_id, home_roster, away_roster
            )
            unmatched_all.extend(unmatched)
        output["events"] = events
        summary_counts["events"] = len(events)

    if "lineups" in data_types:
        lineups = None
        ratings: list[dict[str, Any]] = []
        resp = responses["lineups"]
        if resp.status_code == 200:
            data = resp.json()
            home_lineup, home_ratings, home_unmatched = map_lineup_side(data.get("home", {}), home_roster)
            away_lineup, away_ratings, away_unmatched = map_lineup_side(data.get("away", {}), away_roster)
            lineups = {
                "home": {**home_lineup, "teamId": home_team_id},
                "away": {**away_lineup, "teamId": away_team_id},
            }
            ratings = home_ratings + away_ratings
            unmatched_all.extend(home_unmatched + away_unmatched)
        output["lineups"] = lineups
        output["ratings"] = ratings
        summary_counts["ratings"] = len(ratings)

    if "statistics" in data_types:
        statistics = None
        resp = responses["statistics"]
        if resp.status_code == 200:
            mapped = map_statistics(resp.json())
            if mapped:
                statistics = {
                    "home": {**mapped["home"], "teamId": home_team_id},
                    "away": {**mapped["away"], "teamId": away_team_id},
                }
        output["statistics"] = statistics

    if "commentary" in data_types:
        comments: list[dict[str, Any]] = []
        resp = responses["commentary"]
        if resp.status_code == 200:
            comments = map_comments(resp.json().get("comments", []))
        output["commentary"] = comments
        summary_counts["commentary"] = len(comments)

    if "shotmap" in data_types:
        shots: list[dict[str, Any]] = []
        resp = responses["shotmap"]
        if resp.status_code == 200:
            shots, unmatched = map_shotmap(
                resp.json().get("shotmap", []), home_team_id, away_team_id, home_roster, away_roster
            )
            unmatched_all.extend(unmatched)
        output["shotmap"] = shots
        summary_counts["shotmap"] = len(shots)

    if "highlights" in data_types:
        highlights: list[dict[str, Any]] = []
        resp = responses["highlights"]
        if resp.status_code == 200:
            highlights = map_highlights(resp.json().get("highlights", []))
        output["highlights"] = highlights
        summary_counts["highlights"] = len(highlights)

    if "averagePositions" in data_types:
        avg_positions: list[dict[str, Any]] = []
        resp = responses["averagePositions"]
        if resp.status_code == 200:
            avg_positions, unmatched = map_average_positions(
                resp.json(), home_team_id, away_team_id, home_roster, away_roster
            )
            unmatched_all.extend(unmatched)
        output["averagePositions"] = avg_positions
        summary_counts["averagePositions"] = len(avg_positions)

    if "momentum" in data_types:
        momentum: list[dict[str, Any]] = []
        resp = responses["momentum"]
        if resp.status_code == 200:
            momentum = map_momentum(resp.json())
        output["momentum"] = momentum
        summary_counts["momentum"] = len(momentum)

    if "odds" in data_types:
        odds: list[dict[str, Any]] = []
        resp = responses["odds"]
        if resp.status_code == 200:
            odds = map_odds(resp.json())
        output["odds"] = odds
        summary_counts["odds"] = len(odds)

    output["unmatchedPlayers"] = sorted(set(unmatched_all))

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / f"{match_id}.json").write_text(json.dumps(output, indent=2, default=str))
    counts_str = ", ".join(f"{k}={v}" for k, v in summary_counts.items())
    print(f"  [{match_id}] OK — game_id={game_id}, {counts_str}, unmatched={len(set(unmatched_all))}")
    return False


# Số trận LIÊN TIẾP bị block (403 ở TẤT CẢ endpoint đang gọi cho run này) trước khi dừng hẳn script
# — không chạy tiếp âm thầm cho tới hết batch với hàng loạt output rỗng. 2 là đủ nhạy (1 lần có thể
# là fluke/lỗi tạm thời phía Sofascore) mà không tốn quá nhiều request để xác nhận thật sự bị chặn.
BLOCK_THRESHOLD_CONSECUTIVE_MATCHES = 2

DEFAULT_DATA_TYPES = "events,lineups,statistics"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="Đường dẫn manifest.json (sinh bởi sync-worker)")
    parser.add_argument("output_dir", type=Path, help="Thư mục ghi output JSON, 1 file/match")
    parser.add_argument(
        "--data-types",
        default=DEFAULT_DATA_TYPES,
        help=f"Danh sách loại data, cách nhau bởi dấu phẩy (mặc định: {DEFAULT_DATA_TYPES}). "
        f"Giá trị hợp lệ: {', '.join(DATA_TYPE_ENDPOINTS)}",
    )
    args = parser.parse_args()

    data_types = set(args.data_types.split(","))
    invalid = data_types - set(DATA_TYPE_ENDPOINTS)
    if invalid:
        print(f"--data-types chứa giá trị không hợp lệ: {sorted(invalid)}", file=sys.stderr)
        sys.exit(1)

    manifest = json.loads(args.manifest.read_text())
    cache_dir = Path(__file__).parent / ".cache"

    client = sd.Sofascore(
        leagues=manifest["competitionKey"],
        seasons=manifest["season"],
        data_dir=cache_dir,
    )
    schedule = client.read_schedule()

    matches = manifest["matches"]
    print(f"Tìm thấy {len(matches)} match trong manifest, data_types={sorted(data_types)}, bắt đầu scrape...")
    consecutive_blocked = 0
    for i, match in enumerate(matches):
        blocked = process_match(client, schedule, match, args.output_dir, data_types)
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
