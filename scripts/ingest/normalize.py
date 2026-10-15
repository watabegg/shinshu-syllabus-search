"""Search-field normalization and cautious delivery-format classification."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from .common import normalize_text

MODALITIES = ("in_person", "on_demand", "live_online", "remote_unspecified", "unknown")

_PATTERNS = {
    "on_demand": re.compile(r"オンデマンド(?:式|型)(?:の授業|授業方式|方式)?|オンデマンドで(?:受講|視聴|配信|実施)|(?:録画|オンデマンド)配信授業|on-demand (?:class|course|lecture)", re.IGNORECASE),
    "live_online": re.compile(r"同時配信|リアルタイム配信|ライブ(?:配信|授業)|オンライン(?:で|による)?ライブ|online live (?:lectures?|classes?)", re.IGNORECASE),
    "in_person": re.compile(r"対面(?:授業|講義|形式)|対面の?(?:講義|授業)(?:を|で)?(?:行|実施|開講)|対面で(?:授業|講義)?(?:を)?(?:実施|行|開講)|現地開催|教室で(?:実施|行|開講)|ハイブリッド方式|ハイブリッド開催"),
    "remote_unspecified": re.compile(r"遠隔授業(?!科目)|オンライン(?:授業|講義|開催)|オンラインで実施|リモート授業|Zoom(?:形式による|による|形式)?(?:オンライン)?(?:授業|講義|開催)|(?:delivered|held|conducted) online(?: via Zoom)?|online course", re.IGNORECASE),
}
_AMBIGUITY = re.compile(r"(?:ではない|ではありません|ではなく|しない|ありません|なし|以外|除く|場合|予定|可能性|原則|要相談|検討中)")
_PREPARATION_CONTEXT = re.compile(r"事前学習|事前課題|予習|事後学習|復習|予習用|参考書|オンデマンド版")


def _contexts(text: str, pattern: re.Pattern[str], radius: int = 45) -> list[tuple[str, bool]]:
    found: list[tuple[str, bool]] = []
    for match in pattern.finditer(text):
        # Keep ambiguity scoped to the same sentence. A syllabus may state an
        # unconditional online format, then mention in a later sentence that
        # in-person venue details will be posted if an exception is scheduled.
        sentence_start = max((text.rfind(mark, 0, match.start()) for mark in "。！？!?"), default=-1) + 1
        following = [position for mark in "。！？!?" if (position := text.find(mark, match.end())) >= 0]
        sentence_end = min(following) if following else len(text)
        start = max(sentence_start, match.start() - radius)
        end = min(sentence_end, match.end() + radius)
        context = text[start:end].strip()
        found.append((context, bool(_AMBIGUITY.search(context))))
    return found


def classify_modalities(pages: list[str]) -> tuple[list[str], list[dict[str, str]], list[str]]:
    full_text = "\n".join(pages)
    modalities: set[str] = set()
    evidence: list[dict[str, str]] = []
    warnings: list[str] = []
    ambiguous_seen = False
    for modality, pattern in _PATTERNS.items():
        for context, ambiguous in _contexts(full_text, pattern):
            if modality == "on_demand" and _PREPARATION_CONTEXT.search(context):
                continue
            if modality == "remote_unspecified" and re.search(r"(?:ライブ|同時配信|リアルタイム)", context):
                continue
            if ambiguous:
                ambiguous_seen = True
                evidence.append({"modality": "unknown", "text": context, "source": "pdf:ambiguous-delivery-text"})
                warnings.append(f"ambiguous delivery-format statement near {context[:80]}")
                continue
            modalities.add(modality)
            evidence.append({"modality": modality, "text": context, "source": "pdf:text"})
    if "live_online" in modalities:
        # A Zoom sentence that is explicitly described as live should not also
        # become an unspecified-remote classification merely because it says
        # "online lecture".
        retained = [item for item in evidence if not (
            item["modality"] == "remote_unspecified" and re.search(r"Zoom|ZOOM", item["text"])
        )]
        evidence = retained
        if not any(item["modality"] == "remote_unspecified" for item in evidence):
            modalities.discard("remote_unspecified")
    if not modalities or ambiguous_seen:
        modalities.add("unknown")
    if not evidence:
        evidence.append({"modality": "unknown", "text": "明示的な授業実施方式の記載なし", "source": "pdf:no-explicit-delivery-evidence"})
    return [item for item in MODALITIES if item in modalities], evidence, list(dict.fromkeys(warnings))


def search_fields(*, title: str, teacher: str, room: str, code: str, pages: list[str],
                  aliases: dict[str, dict[str, str]]) -> dict[str, str]:
    from .common import alias_search, normalize_key
    body = normalize_text("\n".join(pages))
    return {
        "title_search": normalize_text(title),
        "teacher_search": alias_search(teacher, aliases.get("teachers", {})),
        "room_search": alias_search(room, aliases.get("rooms", {})),
        "code_search": normalize_key(code),
        "body_search": body,
    }


def _is_japanese(value: str) -> bool:
    return any("\u3040" <= char <= "\u9fff" for char in value)


def detect_slots(term: str, schedule: str) -> list[dict[str, Any]]:
    slots: list[dict[str, Any]] = []
    normalized = unicodedata.normalize("NFKC", schedule)
    pattern = re.compile(r"([月火水木金土日])曜(?:日)?\s*[･・、,]?\s*([0-9]+)\s*(?:時限|限|コマ)")
    for match in pattern.finditer(normalized):
        day_char = match.group(1)
        period = int(match.group(2))
        raw = schedule[match.start():match.end()] if len(schedule) == len(normalized) else match.group(0)
        # NFKC can change some code points but preserves character positions for
        # these source labels in ordinary Japanese text.
        day_label = f"{day_char}曜"
        period_match = re.search(r"([0-9０-９]+)\s*(?:時限|限|コマ)", raw)
        period_label = period_match.group(0).replace(" ", "") if period_match else f"{match.group(2)}時限"
        slots.append({"term_label": term, "day_label": day_label, "period_label": period_label,
                      "day": {"月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6, "日": 7}[day_char],
                      "period": period, "source_kind": "pdf"})
    if not slots and schedule.strip():
        slots.append({"term_label": term, "day_label": "", "period_label": schedule.strip(),
                      "day": None, "period": None, "source_kind": "pdf"})
    elif not slots and term.strip():
        slots.append({"term_label": term.strip(), "day_label": "", "period_label": "",
                      "day": None, "period": None, "source_kind": "pdf"})
    return slots


def has_japanese(value: str) -> bool:
    return _is_japanese(value)
