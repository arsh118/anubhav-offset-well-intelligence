"""Deterministic text/PDF extraction and evidence-backed drilling event rules."""

import hashlib
import re
import shutil
import subprocess
import unicodedata
from dataclasses import dataclass
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from app.models import EventType, Formation

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_EVIDENCE_CHARS = 600

EVENT_ALIASES: Dict[EventType, Tuple[str, ...]] = {
    EventType.LOST_CIRCULATION: (
        "lost circulation",
        "loss of circulation",
        "losses",
        "mud loss",
        "mud losses",
        "lost returns",
        "loss of returns",
        "fracture",
    ),
    EventType.KICK_INFLUX: ("kick", "influx"),
    EventType.STUCK_PIPE: ("stuck pipe", "pipe stuck", "differential sticking", "differentially stuck"),
    EventType.TORQUE_SPIKE: ("torque", "high torque", "torque spike"),
    EventType.DRAG_INCREASE: ("drag", "high drag", "drag increase", "pickup drag"),
    EventType.OVERPRESSURE_SIGNAL: ("overpressure", "formation pressure", "pore pressure"),
    EventType.WELLBORE_INSTABILITY: (
        "wellbore instability",
        "hole collapse",
        "wellbore collapse",
        "washout",
        "cavings",
    ),
    EventType.CEMENTING_ISSUE: ("cementing", "cement failure", "cement job", "cement issue"),
    EventType.CASING_ISSUE: ("casing", "casing failure", "casing issue"),
    EventType.MUD_WEIGHT_ADJUSTMENT: ("mud weight", "mud-weight", "ecd", "equivalent circulating density"),
    EventType.HOLE_CLEANING_ISSUE: ("hole cleaning", "hole-cleaning", "cuttings loading", "poor hole cleaning"),
    EventType.FISHING_OPERATION: ("fishing", "fishing operation", "fish recovery"),
    EventType.NPT_EVENT: ("npt", "non-productive time", "nonproductive time"),
    EventType.EQUIPMENT_FAILURE: ("equipment failure", "pump failure", "top drive failure"),
    EventType.GAS_SHOW: ("gas show", "gas shows"),
}

EVENT_LABELS: Dict[EventType, str] = {
    EventType.LOST_CIRCULATION: "Lost circulation",
    EventType.KICK_INFLUX: "Kick / influx",
    EventType.STUCK_PIPE: "Stuck pipe",
    EventType.TORQUE_SPIKE: "Torque spike",
    EventType.DRAG_INCREASE: "Drag increase",
    EventType.OVERPRESSURE_SIGNAL: "Overpressure signal",
    EventType.WELLBORE_INSTABILITY: "Wellbore instability",
    EventType.CEMENTING_ISSUE: "Cementing issue",
    EventType.CASING_ISSUE: "Casing issue",
    EventType.MUD_WEIGHT_ADJUSTMENT: "Mud weight / ECD",
    EventType.HOLE_CLEANING_ISSUE: "Hole cleaning issue",
    EventType.FISHING_OPERATION: "Fishing operation",
    EventType.NPT_EVENT: "NPT event",
    EventType.EQUIPMENT_FAILURE: "Equipment failure",
    EventType.GAS_SHOW: "Gas show",
}

_LABELED_DEPTH = re.compile(
    r"\b(MD|TVD)\s*(?:=|:)?\s*"
    r"(\d{1,3}(?:,\d{3})+|\d{3,5}(?:\.\d+)?)\s*(m|meters?|metres?)?\b",
    re.IGNORECASE,
)
_COMBINED_DEPTH = re.compile(
    r"\b(MD|TVD)\s*/\s*(MD|TVD)\s*(?:=|:)?\s*"
    r"(\d{1,3}(?:,\d{3})+|\d{3,5}(?:\.\d+)?)\s*/\s*"
    r"(\d{1,3}(?:,\d{3})+|\d{3,5}(?:\.\d+)?)\s*(m|meters?|metres?)?\b",
    re.IGNORECASE,
)
_UNIT_DEPTH = re.compile(
    r"(?<![\w/])(?:(?:at|depth(?:\s+of)?|near)\s+)?"
    r"(\d{1,3}(?:,\d{3})+|\d{3,5}(?:\.\d+)?)\s*(m|meters?|metres)\b",
    re.IGNORECASE,
)
_BARE_DEPTH = re.compile(
    r"\b(?:depth\s+)(\d{3,5}(?:\.\d+)?)\b",
    re.IGNORECASE,
)
_DATE_PATTERNS = (
    re.compile(r"\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b"),
    re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d{2})\b"),
)
_SECTION_HEADINGS = {
    "event": re.compile(r"^(?:drilling\s+)?(?:event|incident|observation)s?\s*:?$", re.IGNORECASE),
    "mitigation": re.compile(r"^(?:mitigation|response|corrective\s+action)s?(?:\s*:.*)?$", re.IGNORECASE),
    "consequence": re.compile(r"^(?:consequence|result|impact)s?(?:\s*:.*)?$", re.IGNORECASE),
    "general": re.compile(
        r"^(?:daily drilling report|drilling summary|operations summary|remarks?|comments?)\s*:?$",
        re.IGNORECASE,
    ),
}


class DocumentExtractionError(ValueError):
    """The uploaded source could not be extracted safely and deterministically."""


@dataclass(frozen=True)
class PageText:
    page_number: int
    text: str
    used_ocr: bool = False


@dataclass(frozen=True)
class DepthExtraction:
    measured_depth: Optional[float]
    true_vertical_depth: Optional[float]


@dataclass(frozen=True)
class EventCandidate:
    event_type: EventType
    title: str
    description: str
    measured_depth: Optional[float]
    true_vertical_depth: Optional[float]
    formation_id: Optional[str]
    formation_name: Optional[str]
    event_date: Optional[datetime]
    consequence: Optional[str]
    mitigation: Optional[str]
    page_number: int
    evidence_excerpt: str
    confidence: float
    occurrence_index: int


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    normalized = normalized.replace("\u00a0", " ").replace("\u2011", "-").replace("\u2013", "-")
    normalized = re.sub(r"[\t\r ]+", " ", normalized)
    normalized = re.sub(r" *\n *", "\n", normalized)
    return re.sub(r"\n{3,}", "\n\n", normalized).strip()


def extract_depths(text: str) -> DepthExtraction:
    """Extract the first explicitly labeled MD/TVD pair, or an unlabeled meter depth as MD."""
    combined = _COMBINED_DEPTH.search(text)
    if combined:
        first_label, second_label, first_value, second_value, _unit = combined.groups()
        values = {first_label.upper(): _number(first_value), second_label.upper(): _number(second_value)}
        return DepthExtraction(values.get("MD"), values.get("TVD"))

    measured_depth: Optional[float] = None
    true_vertical_depth: Optional[float] = None
    occupied_spans: List[Tuple[int, int]] = []
    for match in _LABELED_DEPTH.finditer(text):
        label, value, _unit = match.groups()
        parsed = _number(value)
        if label.upper() == "MD" and measured_depth is None:
            measured_depth = parsed
        elif label.upper() == "TVD" and true_vertical_depth is None:
            true_vertical_depth = parsed
        occupied_spans.append(match.span())
    if measured_depth is not None or true_vertical_depth is not None:
        return DepthExtraction(measured_depth, true_vertical_depth)

    for match in _UNIT_DEPTH.finditer(text):
        if any(start <= match.start() < end for start, end in occupied_spans):
            continue
        return DepthExtraction(_number(match.group(1)), None)
    bare = _BARE_DEPTH.search(text)
    if bare:
        return DepthExtraction(_number(bare.group(1)), None)
    return DepthExtraction(None, None)


def _number(value: str) -> float:
    return float(value.replace(",", ""))


def extract_event_types(text: str) -> List[EventType]:
    normalized = normalize_text(text).casefold()
    found = []
    for event_type, aliases in EVENT_ALIASES.items():
        if any(_alias_pattern(alias).search(normalized) for alias in aliases):
            found.append(event_type)
    return found


def _alias_pattern(alias: str) -> re.Pattern:
    phrase = r"\s+".join(re.escape(part) for part in alias.split())
    return re.compile(r"(?<!\w)" + phrase + r"(?!\w)", re.IGNORECASE)


def extract_formation(text: str, formations: Sequence[Formation]) -> Optional[Formation]:
    """Match a direct formation name or alias using normalized word boundaries."""
    normalized = normalize_text(text).casefold()
    options = []
    for formation in formations:
        for alias in [formation.name, formation.normalized_name, *(formation.aliases or [])]:
            alias = normalize_text(alias).casefold()
            if len(alias) >= 3 and _alias_pattern(alias).search(normalized):
                options.append((len(alias), formation.normalized_name, formation))
    if not options:
        return None
    return sorted(options, key=lambda option: (-option[0], option[1]))[0][2]


def extract_well_name(text: str, known_well_names: Iterable[str]) -> Optional[str]:
    names = list(known_well_names)
    header_values = re.findall(r"(?im)^\s*(?:well(?:\s+name|\s+no\.?)?)\s*[:#-]\s*([^\n]+)", text)
    search_text = "\n".join(header_values) if header_values else text[:2500]
    normalized = normalize_text(search_text).casefold()
    matches = [name for name in names if re.search(r"(?<!\w)" + re.escape(name.casefold()) + r"(?!\w)", normalized)]
    return max(matches, key=len) if matches else None


def extract_date(text: str) -> Optional[datetime]:
    for pattern_index, pattern in enumerate(_DATE_PATTERNS):
        match = pattern.search(text)
        if not match:
            continue
        if pattern_index == 0:
            year, month, day = (int(part) for part in match.groups())
        else:
            day, month, year = (int(part) for part in match.groups())
        try:
            return datetime.combine(datetime(year, month, day).date(), time.min, tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def detect_section_heading(line: str) -> Optional[str]:
    normalized = normalize_text(line)
    for section, pattern in _SECTION_HEADINGS.items():
        if pattern.match(normalized):
            return section
    return None


def extract_pages(filename: str, content: bytes) -> List[PageText]:
    """Extract page-aware text from TXT/PDF bytes; OCR PDF pages with little text."""
    suffix = Path(filename).suffix.casefold()
    if suffix in (".txt", ".text"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise DocumentExtractionError("Text uploads must use UTF-8 encoding.") from exc
        text_pages = text.split("\f")
        return [PageText(index, normalize_text(page)) for index, page in enumerate(text_pages, start=1) if page.strip()]
    if suffix != ".pdf" or not content.startswith(b"%PDF"):
        raise DocumentExtractionError("The uploaded file is not a readable PDF or UTF-8 text document.")

    try:
        import fitz  # type: ignore[import-untyped]

        pdf = fitz.open(stream=content, filetype="pdf")
    except Exception as exc:
        raise DocumentExtractionError("The PDF could not be opened.") from exc

    pages: List[PageText] = []
    try:
        for index, page in enumerate(pdf, start=1):
            text = normalize_text(page.get_text("text"))
            used_ocr = False
            if len(text) < 40 and page.get_images(full=True):
                text = normalize_text(_ocr_page(page))
                used_ocr = True
            pages.append(PageText(index, text, used_ocr))
    finally:
        pdf.close()
    if not pages:
        raise DocumentExtractionError("The PDF contains no readable pages.")
    return pages


def _ocr_page(page) -> str:
    executable = shutil.which("tesseract")
    if executable is None:
        raise DocumentExtractionError("This scanned PDF needs OCR, but Tesseract is not installed.")
    try:
        pixmap = page.get_pixmap(dpi=250, alpha=False)
        result = subprocess.run(
            [executable, "stdin", "stdout", "--psm", "6"],
            input=pixmap.tobytes("png"),
            capture_output=True,
            check=True,
            timeout=45,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        raise DocumentExtractionError("OCR could not read a scanned PDF page.") from exc
    return result.stdout.decode("utf-8", errors="replace")


def extract_event_candidates(
    pages: Sequence[PageText],
    formations: Sequence[Formation],
    document_date: Optional[datetime] = None,
) -> List[EventCandidate]:
    candidates: List[EventCandidate] = []
    for page in pages:
        page_date = extract_date(page.text)
        blocks = [normalize_text(block) for block in re.split(r"\n\s*\n+", page.text) if block.strip()]
        for block_index, block in enumerate(blocks):
            sentences = _sentences(block)
            event_units = []
            for sentence_index, sentence in enumerate(sentences):
                section = detect_section_heading(sentence)
                event_types = extract_event_types(sentence)
                if event_types and section not in ("mitigation", "consequence"):
                    event_units.append((sentence_index, sentence, event_types))
            if not event_units and extract_event_types(block):
                # Wrapped PDF lines can split an alias; retain the complete paragraph as evidence.
                event_units.append((-1, block, extract_event_types(block)))

            event_sentence_indexes = {index for index, _sentence, _types in event_units if index >= 0}
            for sentence_index, event_sentence, event_types in event_units:
                context_sentences = [event_sentence]
                event_depths = extract_depths(event_sentence)
                event_formation = extract_formation(event_sentence, formations)
                if sentence_index > 0 and (
                    event_depths.measured_depth is None
                    and event_depths.true_vertical_depth is None
                    or event_formation is None
                ):
                    previous = sentences[sentence_index - 1]
                    previous_depth = extract_depths(previous)
                    previous_formation = extract_formation(previous, formations)
                    previous_has_depth = (
                        previous_depth.measured_depth is not None or previous_depth.true_vertical_depth is not None
                    )
                    if not extract_event_types(previous) and (previous_has_depth or previous_formation):
                        context_sentences.insert(0, previous)

                if sentence_index >= 0:
                    for next_index in range(sentence_index + 1, min(sentence_index + 4, len(sentences))):
                        if next_index in event_sentence_indexes:
                            break
                        following = sentences[next_index]
                        section = detect_section_heading(following)
                        support = _is_outcome_or_action(following)
                        supplies_location = (
                            (event_depths.measured_depth is None and event_depths.true_vertical_depth is None)
                            and (
                                extract_depths(following).measured_depth is not None
                                or extract_depths(following).true_vertical_depth is not None
                            )
                        ) or (event_formation is None and extract_formation(following, formations) is not None)
                        if section in ("mitigation", "consequence") or support or supplies_location:
                            context_sentences.append(following)
                        else:
                            break

                context_text = "\n".join(context_sentences)
                depths = extract_depths(context_text)
                formation = extract_formation(context_text, formations)
                event_date = extract_date(event_sentence) or page_date or document_date
                evidence = _evidence_excerpt(context_text)
                description = _clip(event_sentence, 1200)
                consequence = _extract_labeled(context_text, ("consequence", "result", "impact"))
                mitigation = _extract_labeled(context_text, ("mitigation", "response", "action"))
                if consequence is None:
                    consequence = _find_sentence(
                        context_text,
                        r"\b(resulted|resulting|caused|reduced|required|increased|delayed|"
                        r"loss of|consequence|impact)\b",
                        exclude=description,
                    )
                if mitigation is None:
                    mitigation = _find_sentence(
                        context_text,
                        r"\b(treated|pumped|circulat|increased|adjusted|revised|shut.?in|reamed|washed|backream|monitored|resumed|mitigat|response)\w*\b",
                        exclude=description,
                    )
                confidence = 0.52
                confidence += 0.14 if depths.measured_depth is not None or depths.true_vertical_depth is not None else 0
                confidence += 0.12 if formation is not None else 0
                confidence += 0.08 if event_date is not None else 0
                confidence += 0.07 if consequence else 0
                confidence += 0.07 if mitigation else 0
                confidence = min(confidence, 0.99)

                for type_index, event_type in enumerate(event_types):
                    occurrence_index = max(sentence_index, 0) * 10000 + block_index * 100 + type_index
                    label = EVENT_LABELS[event_type]
                    location = f" at {depths.measured_depth:g} m" if depths.measured_depth is not None else ""
                    if formation is not None:
                        location += f" in {formation.name}"
                    candidates.append(
                        EventCandidate(
                            event_type=event_type,
                            title=f"{label} noted{location}"[:200],
                            description=description,
                            measured_depth=depths.measured_depth,
                            true_vertical_depth=depths.true_vertical_depth,
                            formation_id=formation.id if formation else None,
                            formation_name=formation.name if formation else None,
                            event_date=event_date,
                            consequence=_clip(consequence, 1200) if consequence else None,
                            mitigation=_clip(mitigation, 1200) if mitigation else None,
                            page_number=page.page_number,
                            evidence_excerpt=evidence,
                            confidence=confidence,
                            occurrence_index=occurrence_index,
                        )
                    )
    return candidates


def _sentences(text: str) -> List[str]:
    return [normalize_text(part) for part in re.split(r"(?<=[.!?])\s+|\n+", text) if part.strip()]


def _is_outcome_or_action(sentence: str) -> bool:
    section = detect_section_heading(sentence)
    if section in ("mitigation", "consequence"):
        return True
    return bool(
        re.search(
            r"(?i)\b(resulted|resulting|caused|reduced|required|increased|delayed|treated|pumped|"
            r"circulat|adjusted|revised|shut.?in|reamed|washed|backream|monitored|resumed|"
            r"mitigat|consequence|response)\w*\b",
            sentence,
        )
    )


def _evidence_excerpt(block: str) -> str:
    sentences = _sentences(block)
    event_sentences = [sentence for sentence in sentences if extract_event_types(sentence)]
    support_sentences = [
        sentence
        for sentence in sentences
        if re.search(
            r"(?i)\b(consequence|result|impact|mitigation|response|action|treated|pumped|circulat|"
            r"adjusted|reamed|washed|monitored|resumed|shut.?in)\w*\b",
            sentence,
        )
    ]
    excerpt_sentences = list(dict.fromkeys(event_sentences + support_sentences))
    excerpt = " ".join(excerpt_sentences) if excerpt_sentences else block
    return _clip(excerpt, MAX_EVIDENCE_CHARS)


def _extract_labeled(text: str, labels: Sequence[str]) -> Optional[str]:
    names = "|".join(re.escape(label) for label in labels)
    next_label = r"(?:Consequence|Result|Impact|Mitigation|Response|Action)"
    pattern = re.compile(
        r"(?:^|\n|\s)(?:" + names + r")\s*:\s*(.+?)(?=(?:\n|\s)" + next_label + r"\s*:|$)",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(text)
    return normalize_text(match.group(1)).strip(" .;:-") if match else None


def _find_sentence(text: str, pattern: str, exclude: Optional[str] = None) -> Optional[str]:
    for sentence in _sentences(text):
        if sentence != exclude and re.search(pattern, sentence, re.IGNORECASE):
            return sentence.strip(" .;:-")
    return None


def _clip(text: str, limit: int) -> str:
    compact = normalize_text(text)
    return compact if len(compact) <= limit else compact[: limit - 1].rstrip() + "…"


def sha256_digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
