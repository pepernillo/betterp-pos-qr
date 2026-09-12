from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import re
from typing import BinaryIO, Callable

import pdfplumber


class BankStatementParseError(ValueError):
    """Raised when a bank statement PDF cannot be parsed safely."""


@dataclass(slots=True)
class ParsedBankStatement:
    movimientos: list[dict[str, object]]
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    saldo_inicial: Decimal | None = None
    saldo_final: Decimal | None = None
    banco: str | None = None
    titular: str | None = None
    numero_cuenta: str | None = None
    clabe: str | None = None
    ultima_4: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


_BANK_PARSER = Callable[[list[str]], ParsedBankStatement]

_MONTHS = {
    "ENE": 1,
    "FEB": 2,
    "MAR": 3,
    "ABR": 4,
    "MAY": 5,
    "JUN": 6,
    "JUL": 7,
    "AGO": 8,
    "SEP": 9,
    "OCT": 10,
    "NOV": 11,
    "DIC": 12,
}

_BANK_SIGNATURES: dict[str, tuple[str, ...]] = {
    "BBVA": ("MAESTRA PYME BBVA", "BBVA MEXICO", "BBVA"),
    "Banorte": ("BANORTE", "GRUPO FINANCIERO BANORTE"),
    "Santander": ("SANTANDER", "BANCO SANTANDER"),
    "Citibanamex": ("CITIBANAMEX", "BANAMEX", "BANCO NACIONAL DE MEXICO"),
    "Scotiabank": ("SCOTIABANK", "SCOTIA INVERLAT"),
    "Banco Azteca": ("BANCO AZTECA", "AZTECA"),
    "Banco Coppel": ("BANCO COPPEL", "COPPEL"),
    "Nu": ("NU MEXICO", "NU BANK", "NUBANK", "NU CUENTA"),
}

_PERIOD_RE = re.compile(
    r"Periodo DEL (\d{2}/\d{2}/\d{4}) AL (\d{2}/\d{2}/\d{4})",
    re.IGNORECASE,
)
_GENERIC_PERIOD_PATTERNS = (
    re.compile(
        r"Periodo\s+(?:del\s+)?(\d{2}[/-]\d{2}[/-]\d{2,4})\s+(?:al|a)\s+(\d{2}[/-]\d{2}[/-]\d{2,4})",
        re.IGNORECASE,
    ),
    re.compile(
        r"\bDel\s+(\d{2}[/-]\d{2}[/-]\d{2,4})\s+al\s+(\d{2}[/-]\d{2}[/-]\d{2,4})",
        re.IGNORECASE,
    ),
)

_ACCOUNT_RE = re.compile(r"No\.\s*de Cuenta\s+(\d+)", re.IGNORECASE)
_CLABE_RE = re.compile(r"No\.\s*Cuenta CLABE\s+(\d{18})", re.IGNORECASE)
_GENERIC_ACCOUNT_PATTERNS = (
    re.compile(
        r"(?:No\.?\s*de\s*Cuenta|Numero\s*de\s*Cuenta|N[úu]mero\s*de\s*Cuenta|Cuenta)\s*[:#]?\s*([0-9*Xx\-\s]{8,24})",
        re.IGNORECASE,
    ),
)
_GENERIC_CLABE_PATTERNS = (
    re.compile(r"(?:CLABE|Cuenta\s+CLABE)\s*[:#]?\s*(\d{18})", re.IGNORECASE),
)

_START_BALANCE_RE = re.compile(
    r"Saldo de Operaci[oó]n Inicial\s+([0-9,]+\.\d{2})|Saldo de Liquidaci[oó]n Inicial\s+([0-9,]+\.\d{2})",
    re.IGNORECASE,
)
_END_BALANCE_RE = re.compile(
    r"Saldo de Operaci[oó]n Final\s+([0-9,]+\.\d{2})|Saldo Final \(\+\)\s+([0-9,]+\.\d{2})",
    re.IGNORECASE,
)
_GENERIC_START_BALANCE_PATTERNS = (
    re.compile(r"Saldo(?:\s+de\s+\w+)?\s+Inicial\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})", re.IGNORECASE),
    re.compile(r"Saldo anterior\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})", re.IGNORECASE),
    re.compile(r"Saldo al inicio del periodo\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})", re.IGNORECASE),
)
_GENERIC_END_BALANCE_PATTERNS = (
    re.compile(r"Saldo(?:\s+de\s+\w+)?\s+Final(?:\s+\(\+\))?\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})", re.IGNORECASE),
    re.compile(r"Saldo final\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})", re.IGNORECASE),
    re.compile(r"Saldo al corte\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})", re.IGNORECASE),
    re.compile(r"Saldo actual\s+(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})", re.IGNORECASE),
)

_TXN_START_RE = re.compile(
    r"^(?P<oper>\d{2}/[A-Z]{3})\s+(?P<liq>\d{2}/[A-Z]{3})\s+(?P<code>[A-Z0-9]{2,4})\s+(?P<rest>.+)$"
)
_GENERIC_TXN_START_RE = re.compile(
    r"^(?P<date1>\d{2}[/-](?:\d{2}|[A-Z]{3})(?:[/-](?:\d{2,4}))?)(?:\s+(?P<date2>\d{2}[/-](?:\d{2}|[A-Z]{3})(?:[/-](?:\d{2,4}))?))?\s+(?P<rest>.+)$",
    re.IGNORECASE,
)
_TRAILING_AMOUNTS_RE = re.compile(
    r"^(?P<prefix>.*?)(?P<amounts>(?:\s+-?\d{1,3}(?:,\d{3})*\.\d{2}){1,3})\s*$"
)
_GENERIC_TRAILING_AMOUNTS_RE = re.compile(
    r"^(?P<prefix>.*?)(?P<amounts>(?:\s+-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}){1,4})\s*$"
)
_MONEY_RE = re.compile(r"-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2}")
_GENERIC_MONEY_RE = re.compile(r"-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}")
_REFERENCE_RE = re.compile(r"\bRef\.?\s*([A-Z0-9*]+)", re.IGNORECASE)
_GENERIC_REFERENCE_RE = re.compile(
    r"\b(?:REF(?:ERENCIA)?|RASTREO|AUT(?:ORIZACION)?|AUT\.?)\s*[:#]?\s*([A-Z0-9*._-]{4,})",
    re.IGNORECASE,
)
_FOLIO_RE = re.compile(r"\bFOLIO:?\s*([A-Z0-9*]+)", re.IGNORECASE)
_GENERIC_FOLIO_RE = re.compile(r"\bFOLIO\s*[:#]?\s*([A-Z0-9*._-]{3,})", re.IGNORECASE)
_LEADING_FOLIO_RE = re.compile(r"^\s*(\d{6,})")
_NAME_LIKE_RE = re.compile(r"^[A-ZÁÉÍÓÚÑ,&./\\' -]{5,}$")
_TRACKING_LINE_RE = re.compile(r"^[A-Z0-9*]{12,}$")

_TRANSACTION_SECTION_STARTS = (
    "DETALLE DE MOVIMIENTOS",
    "MOVIMIENTOS",
    "TRANSACCIONES",
    "OPERACIONES",
    "DETALLE DE OPERACIONES",
    "DETALLE DE TRANSACCIONES",
)
_TRANSACTION_SECTION_STOPS = (
    "INFORMACION FINANCIERA",
    "INFORMACION IMPORTANTE",
    "COMISIONES",
    "RESUMEN",
    "GLOSARIO",
    "LEYENDAS",
    "SALDO PROMEDIO",
)
_GENERIC_SKIP_PREFIXES = (
    "FECHA",
    "ESTADO DE CUENTA",
    "PERIODO",
    "NO. DE CUENTA",
    "NUMERO DE CUENTA",
    "NUMERO DE CLIENTE",
    "CLABE",
    "SALDO",
    "DETALLE DE",
    "PAGINA",
)
_GENERIC_INGRESO_KEYWORDS = (
    "RECIBIDO",
    "DEPOSITO",
    "ABONO",
    "ENTRANTE",
    "PAGO RECIBIDO",
    "SPEI RECIBIDO",
    "TRANSFERENCIA RECIBIDA",
)
_GENERIC_EGRESO_KEYWORDS = (
    "PAGO",
    "COMPRA",
    "RETIRO",
    "CARGO",
    "COMISION",
    "SPEI ENVIADO",
    "TRANSFERENCIA ENVIADA",
    "DOMICILIACION",
    "CHEQUE",
    "SERVICIO",
    "DISPOSICION",
)

_HOLDER_SKIP_KEYWORDS = (
    "BBVA",
    "BANORTE",
    "SANTANDER",
    "CITIBANAMEX",
    "BANAMEX",
    "SCOTIABANK",
    "BANCO AZTECA",
    "BANCO COPPEL",
    "NU ",
    "ESTADO DE CUENTA",
    "PERIODO",
    "SALDO",
    "CLABE",
    "CUENTA",
    "CLIENTE",
    "RFC",
    "SUCURSAL",
    "DIRECCION",
    "DOMICILIO",
    "PLAZA",
    "TELEFONO",
    "FECHA DE CORTE",
    "PAGINA",
    "PÁGINA",
    "OPER LIQ",
    "DESCRIPCIÓN",
    "DESCRIPCION",
)

_BBVA_INGRESO_CODES = {"AA7", "N06", "T20", "Y45"}
_BBVA_EGRESO_CODES = {"P14", "P72", "S39", "S40", "T17"}
_BBVA_SUMMARY_ABONOS_RE = re.compile(
    r"Dep[oóÃ³]sitos\s*/\s*Abonos\s*\(\+\)\s+(\d+)\s+([0-9,]+\.\d{2})",
    re.IGNORECASE,
)
_BBVA_SUMMARY_CARGOS_RE = re.compile(
    r"Retiros\s*/\s*Cargos\s*\(-\)\s+(\d+)\s+([0-9,]+\.\d{2})",
    re.IGNORECASE,
)


def parse_bank_statement_pdf(*, fileobj: BinaryIO, filename: str = "") -> ParsedBankStatement:
    pages = extract_pdf_pages(fileobj=fileobj, filename=filename)
    bank_name = detect_bank_name(pages)
    if bank_name == "BBVA":
        return parse_bbva_statement_pdf(fileobj=fileobj, pages=pages, filename=filename)
    parser = detect_bank_parser(pages)
    return parser(pages)


def parse_bbva_statement_pdf(
    *, fileobj: BinaryIO, pages: list[str], filename: str = ""
) -> ParsedBankStatement:
    summary_text = "\n".join(pages[:3])
    period_start, period_end = _extract_period(summary_text)
    numero_cuenta = _extract_match(_ACCOUNT_RE, summary_text)
    clabe = _extract_match(_CLABE_RE, summary_text)
    saldo_inicial = _extract_balance(_START_BALANCE_RE, summary_text)
    saldo_final = _extract_balance(_END_BALANCE_RE, summary_text)
    titular = _extract_account_holder(summary_text)
    summary_totals = _extract_bbva_summary_totals(summary_text)

    movimientos = _extract_bbva_pdf_movements(
        fileobj=fileobj,
        filename=filename,
        period_start=period_start,
        period_end=period_end,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        summary_totals=summary_totals,
    )

    return ParsedBankStatement(
        movimientos=movimientos,
        fecha_desde=period_start,
        fecha_hasta=period_end,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        banco="BBVA",
        titular=titular,
        numero_cuenta=numero_cuenta,
        clabe=clabe,
        ultima_4=(numero_cuenta[-4:] if numero_cuenta else (clabe[-4:] if clabe else None)),
        metadata={
            "parser": "bbva_pdf_v2",
            "paginas": len(pages),
            "movimientos_detectados": len(movimientos),
            "summary_depositos_count": summary_totals["deposit_count"],
            "summary_depositos_total": _decimal_to_string(summary_totals["deposit_total"]),
            "summary_retiros_count": summary_totals["withdraw_count"],
            "summary_retiros_total": _decimal_to_string(summary_totals["withdraw_total"]),
            "confidence": 0.99,
        },
    )


def extract_pdf_pages(*, fileobj: BinaryIO, filename: str = "") -> list[str]:
    fileobj.seek(0)
    try:
        with pdfplumber.open(fileobj) as pdf:
            pages = [(page.extract_text() or "").strip() for page in pdf.pages]
    except Exception as exc:  # pragma: no cover - defensive against malformed PDFs
        raise BankStatementParseError(
            f"No pudimos abrir el PDF '{filename or 'estado de cuenta'}'. Verifica que no este danado."
        ) from exc

    if not any(page for page in pages):
        raise BankStatementParseError(
            "No pudimos extraer texto del PDF. Si el estado de cuenta viene escaneado como imagen, "
            "todavia necesitaremos OCR para convertirlo."
        )
    return pages


def detect_bank_name(pages: list[str]) -> str | None:
    signature = "\n".join(pages[:3]).upper()
    for bank_name, markers in _BANK_SIGNATURES.items():
        if any(marker in signature for marker in markers):
            return bank_name
    return None


def detect_bank_parser(pages: list[str]) -> _BANK_PARSER:
    bank_name = detect_bank_name(pages)
    if bank_name == "BBVA":
        return parse_bbva_statement_pages
    return parse_generic_statement_pages


def parse_bbva_statement_pages(pages: list[str]) -> ParsedBankStatement:
    summary_text = "\n".join(pages[:3])
    period_start, period_end = _extract_period(summary_text)
    numero_cuenta = _extract_match(_ACCOUNT_RE, summary_text)
    clabe = _extract_match(_CLABE_RE, summary_text)
    saldo_inicial = _extract_balance(_START_BALANCE_RE, summary_text)
    saldo_final = _extract_balance(_END_BALANCE_RE, summary_text)
    titular = _extract_account_holder(summary_text)

    blocks = _collect_bbva_transaction_blocks(pages)
    movimientos = [
        _parse_bbva_transaction_block(
            first_line=block["first_line"],
            extra_lines=block["extra_lines"],
            page_number=block["page_number"],
            period_start=period_start,
            period_end=period_end,
        )
        for block in blocks
    ]

    return ParsedBankStatement(
        movimientos=movimientos,
        fecha_desde=period_start,
        fecha_hasta=period_end,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        banco="BBVA",
        titular=titular,
        numero_cuenta=numero_cuenta,
        clabe=clabe,
        ultima_4=(numero_cuenta[-4:] if numero_cuenta else (clabe[-4:] if clabe else None)),
        metadata={
            "parser": "bbva_pdf_v1",
            "paginas": len(pages),
            "bloques_detectados": len(blocks),
            "confidence": 0.98,
        },
    )


def _extract_bbva_summary_totals(summary_text: str) -> dict[str, Decimal | int]:
    deposit_match = _BBVA_SUMMARY_ABONOS_RE.search(summary_text)
    withdraw_match = _BBVA_SUMMARY_CARGOS_RE.search(summary_text)
    if not deposit_match or not withdraw_match:
        raise BankStatementParseError(
            "No pudimos leer el resumen oficial de abonos y cargos del estado de cuenta BBVA."
        )

    return {
        "deposit_count": int(deposit_match.group(1)),
        "deposit_total": _parse_decimal(deposit_match.group(2)),
        "withdraw_count": int(withdraw_match.group(1)),
        "withdraw_total": _parse_decimal(withdraw_match.group(2)),
    }


def _extract_bbva_pdf_movements(
    *,
    fileobj: BinaryIO,
    filename: str,
    period_start: date | None,
    period_end: date | None,
    saldo_inicial: Decimal | None,
    saldo_final: Decimal | None,
    summary_totals: dict[str, Decimal | int],
) -> list[dict[str, object]]:
    if period_start is None or period_end is None:
        raise BankStatementParseError("No pudimos interpretar el periodo del estado de cuenta BBVA.")

    fileobj.seek(0)
    try:
        with pdfplumber.open(fileobj) as pdf:
            rows_by_page = [
                _group_pdf_rows(
                    page.extract_words(
                        x_tolerance=1,
                        y_tolerance=1,
                        keep_blank_chars=False,
                    )
                )
                for page in pdf.pages
            ]
    except Exception as exc:  # pragma: no cover - defensive against malformed PDFs
        raise BankStatementParseError(
            f"No pudimos leer el detalle tabular del PDF '{filename or 'estado de cuenta BBVA'}'."
        ) from exc
    finally:
        fileobj.seek(0)

    movimientos: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    column_positions: dict[str, float] | None = None
    in_movements = False

    for page_number, rows in enumerate(rows_by_page, start=1):
        for row in rows:
            texts = [str(word["text"]).strip() for word in row if str(word["text"]).strip()]
            if not texts:
                continue
            line = " ".join(texts)
            upper = line.upper()

            if "DETALLE DE MOVIMIENTOS REALIZADOS" in upper:
                in_movements = True
                continue
            if "OPER LIQ COD." in upper and "CARGOS" in upper and "ABONOS" in upper:
                column_positions = _extract_bbva_column_positions(row)
                in_movements = True
                continue
            if not in_movements:
                continue
            if _should_skip_bbva_pdf_line(upper):
                continue
            if _looks_like_bbva_transaction_row(texts):
                if current is not None:
                    movimientos.append(
                        _build_bbva_pdf_movement(
                            current=current,
                            period_start=period_start,
                            period_end=period_end,
                        )
                    )
                current = _start_bbva_pdf_movement(
                    row=row,
                    texts=texts,
                    page_number=page_number,
                    column_positions=column_positions,
                )
                continue
            if current is not None:
                _append_bbva_pdf_row(
                    current=current,
                    row=row,
                    column_positions=column_positions,
                )

    if current is not None:
        movimientos.append(
            _build_bbva_pdf_movement(
                current=current,
                period_start=period_start,
                period_end=period_end,
            )
        )

    _hydrate_running_balances(
        movimientos=movimientos,
        saldo_inicial=saldo_inicial,
    )

    _validate_bbva_pdf_totals(
        movimientos=movimientos,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        summary_totals=summary_totals,
    )
    return movimientos


def parse_generic_statement_pages(pages: list[str]) -> ParsedBankStatement:
    summary_text = "\n".join(pages)
    bank_name = detect_bank_name(pages)
    period_start, period_end = _extract_generic_period(summary_text)
    numero_cuenta = _extract_generic_account_number(summary_text)
    clabe = _extract_generic_clabe(summary_text)
    saldo_inicial = _extract_generic_balance(summary_text, _GENERIC_START_BALANCE_PATTERNS)
    saldo_final = _extract_generic_balance(summary_text, _GENERIC_END_BALANCE_PATTERNS)
    titular = _extract_account_holder(summary_text)

    blocks = _collect_generic_transaction_blocks(pages, require_section=True)
    if not blocks:
        blocks = _collect_generic_transaction_blocks(pages, require_section=False)

    movimientos = [
        _parse_generic_transaction_block(
            first_line=block["first_line"],
            extra_lines=block["extra_lines"],
            page_number=block["page_number"],
            period_start=period_start,
            period_end=period_end,
        )
        for block in blocks
    ]

    if not movimientos:
        raise BankStatementParseError(
            "No pudimos detectar movimientos bancarios en este PDF. Podemos intentar con otros bancos "
            "cuando el archivo trae texto real, pero si viene escaneado o con un formato muy distinto "
            "todavia necesitaremos OCR o un parser dedicado."
        )

    confidence = _estimate_generic_confidence(
        bank_name=bank_name,
        period_start=period_start,
        period_end=period_end,
        numero_cuenta=numero_cuenta,
        clabe=clabe,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        movimientos=movimientos,
    )

    return ParsedBankStatement(
        movimientos=movimientos,
        fecha_desde=period_start,
        fecha_hasta=period_end,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        banco=bank_name,
        titular=titular,
        numero_cuenta=numero_cuenta,
        clabe=clabe,
        ultima_4=(numero_cuenta[-4:] if numero_cuenta else (clabe[-4:] if clabe else None)),
        metadata={
            "parser": "generic_text_pdf_v1",
            "bank_hint": bank_name,
            "paginas": len(pages),
            "bloques_detectados": len(blocks),
            "confidence": confidence,
        },
    )


def _collect_bbva_transaction_blocks(pages: list[str]) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    in_movements = False

    for page_number, page_text in enumerate(pages, start=1):
        raw_lines = [line.strip() for line in page_text.splitlines()]
        for raw_line in raw_lines:
            line = _normalize_line(raw_line)
            if not line:
                continue
            if "DETALLE DE MOVIMIENTOS REALIZADOS" in line.upper():
                in_movements = True
                continue
            if not in_movements:
                continue
            if _is_bbva_footer_start(line):
                break
            if _should_skip_bbva_line(line):
                continue

            if _TXN_START_RE.match(line):
                if current is not None:
                    blocks.append(current)
                current = {
                    "page_number": page_number,
                    "first_line": line,
                    "extra_lines": [],
                }
                continue

            if current is not None:
                current["extra_lines"].append(line)

    if current is not None:
        blocks.append(current)
    return blocks


def _collect_generic_transaction_blocks(
    pages: list[str], *, require_section: bool
) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    in_movements = not require_section

    for page_number, page_text in enumerate(pages, start=1):
        raw_lines = [line.strip() for line in page_text.splitlines()]
        for raw_line in raw_lines:
            line = _normalize_line(raw_line)
            if not line:
                continue
            upper = line.upper()

            if require_section and any(marker in upper for marker in _TRANSACTION_SECTION_STARTS):
                in_movements = True
                continue
            if in_movements and any(marker in upper for marker in _TRANSACTION_SECTION_STOPS):
                if current is not None:
                    blocks.append(current)
                    current = None
                in_movements = False if require_section else True
                continue
            if not in_movements:
                continue
            if _should_skip_generic_line(line):
                continue

            if _GENERIC_TXN_START_RE.match(line):
                if current is not None:
                    blocks.append(current)
                current = {
                    "page_number": page_number,
                    "first_line": line,
                    "extra_lines": [],
                }
                continue

            if current is not None:
                current["extra_lines"].append(line)

    if current is not None:
        blocks.append(current)
    return blocks


def _parse_bbva_transaction_block(
    *,
    first_line: str,
    extra_lines: list[str],
    page_number: int,
    period_start: date | None,
    period_end: date | None,
) -> dict[str, object]:
    match = _TXN_START_RE.match(first_line)
    if not match or period_start is None or period_end is None:
        raise BankStatementParseError(f"No pudimos interpretar un movimiento de BBVA: '{first_line}'.")

    operation_date = _parse_short_bbva_date(match.group("oper"), period_start=period_start, period_end=period_end)
    liquidation_date = _parse_short_bbva_date(match.group("liq"), period_start=period_start, period_end=period_end)
    bank_code = match.group("code")
    first_line_payload = _split_bbva_amounts(match.group("rest"))
    raw_detail_lines = [_normalize_line(line) for line in extra_lines]
    raw_detail_lines = [line for line in raw_detail_lines if line]
    detail_lines = [_normalize_detail_line(line) for line in extra_lines]
    detail_lines = [line for line in detail_lines if line]

    reference = _extract_reference(raw_detail_lines)
    folio = _extract_folio(raw_detail_lines)
    counterparty = _extract_counterparty_name(detail_lines)
    narrative = _extract_narrative_detail(detail_lines)
    concept = _build_concept(
        main_description=first_line_payload["description"],
        narrative=narrative,
        counterparty=counterparty,
    )

    amounts = first_line_payload["amounts"]
    monto = amounts[0]
    saldo_resultante = amounts[-1] if len(amounts) > 1 else None
    saldo_operacion = amounts[1] if len(amounts) == 3 else None
    saldo_liquidacion = amounts[2] if len(amounts) == 3 else saldo_resultante

    movement_type = _infer_bbva_movement_type(
        bank_code=bank_code,
        main_description=first_line_payload["description"],
        detail_lines=detail_lines,
    )

    return {
        "fecha_pago": operation_date,
        "monto": monto,
        "tipo_movimiento": movement_type,
        "numero_referencia": reference,
        "folio_bancario": folio,
        "concepto_bancario": concept,
        "saldo_resultante": saldo_resultante,
        "metadata": {
            "row_number": None,
            "source_page": page_number,
            "parser": "bbva_pdf_v1",
            "banco": "BBVA",
            "fecha_operacion": operation_date.isoformat(),
            "fecha_liquidacion": liquidation_date.isoformat(),
            "codigo_bancario": bank_code,
            "saldo_operacion": _decimal_to_string(saldo_operacion),
            "saldo_liquidacion": _decimal_to_string(saldo_liquidacion),
            "beneficiario_detectado": counterparty,
            "lineas_origen": [first_line, *extra_lines],
        },
    }


def _parse_generic_transaction_block(
    *,
    first_line: str,
    extra_lines: list[str],
    page_number: int,
    period_start: date | None,
    period_end: date | None,
) -> dict[str, object]:
    match = _GENERIC_TXN_START_RE.match(first_line)
    if not match:
        raise BankStatementParseError(f"No pudimos interpretar un movimiento bancario: '{first_line}'.")

    operation_date = _parse_statement_date(match.group("date1"), period_start=period_start, period_end=period_end)
    liquidation_date = _parse_statement_date(
        match.group("date2") or match.group("date1"),
        period_start=period_start,
        period_end=period_end,
    )
    payload_text = " ".join([match.group("rest"), *extra_lines]).strip()
    payload = _split_generic_amounts(payload_text)
    detail_lines = [_normalize_detail_line(line) for line in extra_lines]
    detail_lines = [line for line in detail_lines if line]

    reference = _extract_generic_reference([match.group("rest"), *detail_lines])
    folio = _extract_generic_folio([match.group("rest"), *detail_lines])
    counterparty = _extract_counterparty_name(detail_lines)
    narrative = _extract_narrative_detail(detail_lines)
    concept = _build_concept(
        main_description=payload["description"],
        narrative=narrative,
        counterparty=counterparty,
    )

    movement_type = _infer_generic_movement_type(
        text=" ".join([payload["description"], *detail_lines]),
        amount_candidates=payload["amount_candidates"],
    )
    monto, saldo_resultante = _resolve_generic_amount_and_balance(
        amounts=payload["amounts"],
        amount_candidates=payload["amount_candidates"],
        movement_type=movement_type,
    )

    return {
        "fecha_pago": operation_date,
        "monto": monto,
        "tipo_movimiento": movement_type,
        "numero_referencia": reference,
        "folio_bancario": folio,
        "concepto_bancario": concept,
        "saldo_resultante": saldo_resultante,
        "metadata": {
            "row_number": None,
            "source_page": page_number,
            "parser": "generic_text_pdf_v1",
            "fecha_operacion": operation_date.isoformat(),
            "fecha_liquidacion": liquidation_date.isoformat(),
            "beneficiario_detectado": counterparty,
            "lineas_origen": [first_line, *extra_lines],
        },
    }


def _extract_period(text: str) -> tuple[date | None, date | None]:
    match = _PERIOD_RE.search(text)
    if not match:
        return None, None
    return (
        datetime.strptime(match.group(1), "%d/%m/%Y").date(),
        datetime.strptime(match.group(2), "%d/%m/%Y").date(),
    )


def _extract_generic_period(text: str) -> tuple[date | None, date | None]:
    bbva_period = _extract_period(text)
    if all(bbva_period):
        return bbva_period
    for pattern in _GENERIC_PERIOD_PATTERNS:
        match = pattern.search(text)
        if match:
            return (_parse_date_string(match.group(1)), _parse_date_string(match.group(2)))
    return None, None


def _extract_balance(pattern: re.Pattern[str], text: str) -> Decimal | None:
    match = pattern.search(text)
    if not match:
        return None
    for value in match.groups():
        if value:
            return _parse_decimal(value)
    return None


def _extract_generic_balance(text: str, patterns: tuple[re.Pattern[str], ...]) -> Decimal | None:
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            return _parse_decimal(match.group(1))
    return None


def _extract_match(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return match.group(1) if match else None


def _extract_generic_account_number(text: str) -> str | None:
    exact = _extract_match(_ACCOUNT_RE, text)
    if exact:
        return exact
    for pattern in _GENERIC_ACCOUNT_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        digits = re.sub(r"\D", "", match.group(1))
        if 8 <= len(digits) <= 20:
            return digits
    return None


def _extract_generic_clabe(text: str) -> str | None:
    exact = _extract_match(_CLABE_RE, text)
    if exact:
        return exact
    for pattern in _GENERIC_CLABE_PATTERNS:
        match = pattern.search(text)
        if match:
            digits = re.sub(r"\D", "", match.group(1))
            if len(digits) == 18:
                return digits
    return None


def _extract_account_holder(text: str) -> str | None:
    lines = [_normalize_line(line) for line in text.splitlines()[:40]]
    for line in lines:
        if not line:
            continue
        upper = line.upper()
        if any(keyword in upper for keyword in _HOLDER_SKIP_KEYWORDS):
            continue
        if re.search(r"\d{2}[/-]\d{2}", line):
            continue
        if len(line) < 5:
            continue
        if _looks_like_counterparty_name(line):
            return line.title()
        if re.fullmatch(r"[A-Z0-9&.,' /-]{5,}", upper):
            return line.title()
    return None


def _group_pdf_rows(words: list[dict[str, object]]) -> list[list[dict[str, object]]]:
    rows: list[list[dict[str, object]]] = []
    current: list[dict[str, object]] = []
    current_top: float | None = None
    for word in sorted(words, key=lambda item: (round(float(item["top"]), 1), float(item["x0"]))):
        top = float(word["top"])
        if current_top is None or abs(top - current_top) <= 2:
            current.append(word)
            current_top = top if current_top is None else current_top
        else:
            rows.append(current)
            current = [word]
            current_top = top
    if current:
        rows.append(current)
    return rows


def _extract_bbva_column_positions(row: list[dict[str, object]]) -> dict[str, float]:
    positions: dict[str, float] = {}
    for word in row:
        text = str(word["text"]).strip().upper()
        if text == "CARGOS":
            positions["cargos"] = float(word["x0"])
        elif text == "ABONOS":
            positions["abonos"] = float(word["x0"])
        elif text == "OPERACIÓN":
            positions["operacion"] = float(word["x0"])
        elif text == "LIQUIDACIÓN":
            positions["liquidacion"] = float(word["x0"])
    if {"cargos", "abonos", "operacion", "liquidacion"} - positions.keys():
        raise BankStatementParseError(
            "No pudimos ubicar las columnas del estado de cuenta BBVA para clasificar cargos y abonos."
        )
    return positions


def _should_skip_bbva_pdf_line(upper: str) -> bool:
    return (
        upper.startswith("NO. CUENTA")
        or upper.startswith("NO. CLIENTE")
        or upper.startswith("ESTADO DE CUENTA")
        or upper.startswith("PAGINA ")
        or upper.startswith("MAESTRA PYME BBVA")
        or upper.startswith("FECHA SALDO")
        or upper.startswith("BBVA MEXICO, S.A.")
        or upper.startswith("AV. PASEO DE LA REFORMA")
        or upper.startswith("DOMICILIO FISCAL")
        or upper.startswith("INFORMACION FINANCIERA")
        or upper.startswith("LA GAT REAL")
    )


def _looks_like_bbva_transaction_row(texts: list[str]) -> bool:
    return len(texts) >= 2 and bool(re.match(r"^\d{2}/[A-Z]{3}$", texts[0])) and bool(
        re.match(r"^\d{2}/[A-Z]{3}$", texts[1])
    )


def _classify_bbva_amount_column(x0: float, column_positions: dict[str, float] | None) -> str | None:
    if not column_positions:
        return None
    cargos = column_positions["cargos"]
    abonos = column_positions["abonos"]
    operacion = column_positions["operacion"]
    liquidacion = column_positions["liquidacion"]
    threshold_cargos_abonos = (cargos + abonos) / 2
    threshold_abonos_operacion = (abonos + operacion) / 2
    threshold_operacion_liquidacion = (operacion + liquidacion) / 2

    if x0 >= threshold_operacion_liquidacion:
        return "saldo_liquidacion"
    if x0 >= threshold_abonos_operacion:
        return "saldo_operacion"
    if x0 >= threshold_cargos_abonos:
        return "abono"
    if x0 >= cargos - 20:
        return "cargo"
    return None


def _start_bbva_pdf_movement(
    *,
    row: list[dict[str, object]],
    texts: list[str],
    page_number: int,
    column_positions: dict[str, float] | None,
) -> dict[str, object]:
    code = texts[2] if len(texts) >= 3 and re.match(r"^[A-Z0-9]{2,4}$", texts[2]) else ""
    skip_leading = 3 if code else 2
    movement: dict[str, object] = {
        "page_number": page_number,
        "oper_token": texts[0],
        "liq_token": texts[1],
        "code": code,
        "description": "",
        "extra_lines": [],
        "cargo": None,
        "abono": None,
        "saldo_operacion": None,
        "saldo_liquidacion": None,
        "lineas_origen": [" ".join(texts)],
    }
    _append_bbva_pdf_row(
        current=movement,
        row=row,
        column_positions=column_positions,
        skip_leading=skip_leading,
        set_description=True,
    )
    return movement


def _append_bbva_pdf_row(
    *,
    current: dict[str, object],
    row: list[dict[str, object]],
    column_positions: dict[str, float] | None,
    skip_leading: int = 0,
    set_description: bool = False,
) -> None:
    text_tokens: list[str] = []
    for index, word in enumerate(row):
        if index < skip_leading:
            continue
        text = str(word["text"]).strip()
        if not text:
            continue
        if _MONEY_RE.fullmatch(text):
            column = _classify_bbva_amount_column(float(word["x0"]), column_positions)
            amount = _parse_decimal(text)
            if column == "cargo" and current.get("cargo") is None:
                current["cargo"] = amount
                continue
            if column == "abono" and current.get("abono") is None:
                current["abono"] = amount
                continue
            if column == "saldo_operacion" and current.get("saldo_operacion") is None:
                current["saldo_operacion"] = amount
                continue
            if column == "saldo_liquidacion" and current.get("saldo_liquidacion") is None:
                current["saldo_liquidacion"] = amount
                continue
        text_tokens.append(text)

    line = _normalize_line(" ".join(text_tokens))
    if not line:
        return
    if set_description:
        current["description"] = _humanize_bbva_description(line)
    else:
        current["extra_lines"].append(line)
    current["lineas_origen"].append(line)


def _build_bbva_pdf_movement(
    *,
    current: dict[str, object],
    period_start: date,
    period_end: date,
) -> dict[str, object]:
    operation_date = _parse_short_bbva_date(
        str(current["oper_token"]), period_start=period_start, period_end=period_end
    )
    liquidation_date = _parse_short_bbva_date(
        str(current["liq_token"]), period_start=period_start, period_end=period_end
    )
    detail_lines = [_normalize_detail_line(str(line)) for line in current["extra_lines"]]
    detail_lines = [line for line in detail_lines if line]

    reference = _extract_reference(detail_lines)
    folio = _extract_folio(detail_lines)
    counterparty = _extract_counterparty_name(detail_lines)
    narrative = _extract_narrative_detail(detail_lines)
    concept = _build_concept(
        main_description=str(current.get("description") or ""),
        narrative=narrative,
        counterparty=counterparty,
    )

    abono = current.get("abono")
    cargo = current.get("cargo")
    if abono is not None and cargo is None:
        movement_type = "INGRESO"
        amount = abono
    elif cargo is not None and abono is None:
        movement_type = "EGRESO"
        amount = cargo
    else:
        raise BankStatementParseError(
            "No pudimos clasificar un movimiento de BBVA en las columnas de cargos o abonos."
        )

    saldo_operacion = current.get("saldo_operacion")
    saldo_liquidacion = current.get("saldo_liquidacion")
    # Para conciliacion usamos primero el saldo de operacion, porque es el que
    # permite reconstruir el corrida del estado del periodo. El saldo de
    # liquidacion puede adelantarse al dia siguiente en BBVA.
    saldo_resultante = saldo_operacion or saldo_liquidacion

    return {
        "fecha_pago": operation_date,
        "monto": amount,
        "tipo_movimiento": movement_type,
        "numero_referencia": reference,
        "folio_bancario": folio,
        "concepto_bancario": concept,
        "saldo_resultante": saldo_resultante,
        "metadata": {
            "row_number": None,
            "source_page": current["page_number"],
            "parser": "bbva_pdf_v2",
            "banco": "BBVA",
            "fecha_operacion": operation_date.isoformat(),
            "fecha_liquidacion": liquidation_date.isoformat(),
            "codigo_bancario": current.get("code"),
            "saldo_operacion": _decimal_to_string(saldo_operacion),
            "saldo_liquidacion": _decimal_to_string(saldo_liquidacion),
            "beneficiario_detectado": counterparty,
            "lineas_origen": current["lineas_origen"],
        },
    }


def _validate_bbva_pdf_totals(
    *,
    movimientos: list[dict[str, object]],
    saldo_inicial: Decimal | None,
    saldo_final: Decimal | None,
    summary_totals: dict[str, Decimal | int],
) -> None:
    total_ingresos = sum(
        (Decimal(str(movement["monto"])) for movement in movimientos if movement["tipo_movimiento"] == "INGRESO"),
        Decimal("0"),
    )
    total_egresos = sum(
        (Decimal(str(movement["monto"])) for movement in movimientos if movement["tipo_movimiento"] == "EGRESO"),
        Decimal("0"),
    )
    deposit_count = sum(1 for movement in movimientos if movement["tipo_movimiento"] == "INGRESO")
    withdraw_count = sum(1 for movement in movimientos if movement["tipo_movimiento"] == "EGRESO")

    if deposit_count != int(summary_totals["deposit_count"]):
        raise BankStatementParseError(
            f"BBVA reporta {summary_totals['deposit_count']} abonos, pero detectamos {deposit_count}."
        )
    if withdraw_count != int(summary_totals["withdraw_count"]):
        raise BankStatementParseError(
            f"BBVA reporta {summary_totals['withdraw_count']} cargos, pero detectamos {withdraw_count}."
        )
    if clamp_decimal(total_ingresos) != clamp_decimal(Decimal(str(summary_totals["deposit_total"]))):
        raise BankStatementParseError(
            "Los abonos detectados no cuadran con el resumen oficial del estado de cuenta BBVA."
        )
    if clamp_decimal(total_egresos) != clamp_decimal(Decimal(str(summary_totals["withdraw_total"]))):
        raise BankStatementParseError(
            "Los cargos detectados no cuadran con el resumen oficial del estado de cuenta BBVA."
        )

    if saldo_inicial is not None:
        saldo_corrida = clamp_decimal(saldo_inicial)
        for index, movement in enumerate(movimientos, start=1):
            amount = clamp_decimal(Decimal(str(movement["monto"])))
            if movement["tipo_movimiento"] == "INGRESO":
                saldo_corrida += amount
            else:
                saldo_corrida -= amount
            saldo_resultante = movement.get("saldo_resultante")
            if saldo_resultante is not None and clamp_decimal(Decimal(str(saldo_resultante))) != saldo_corrida:
                raise BankStatementParseError(
                    f"El movimiento {index} no cuadra contra el saldo reportado por BBVA."
                )
        if saldo_final is not None and saldo_corrida != clamp_decimal(saldo_final):
            raise BankStatementParseError(
                "El saldo final calculado con los movimientos no coincide con el saldo final del estado de cuenta BBVA."
            )


def _hydrate_running_balances(
    *,
    movimientos: list[dict[str, object]],
    saldo_inicial: Decimal | None,
) -> None:
    if saldo_inicial is None:
        return

    saldo_corrida = clamp_decimal(saldo_inicial)
    for movement in movimientos:
        amount = clamp_decimal(Decimal(str(movement["monto"])))
        if movement["tipo_movimiento"] == "INGRESO":
            saldo_corrida += amount
        else:
            saldo_corrida -= amount

        if movement.get("saldo_resultante") in (None, ""):
            movement["saldo_resultante"] = saldo_corrida
            metadata = movement.get("metadata")
            if isinstance(metadata, dict):
                metadata["saldo_reconstruido"] = True


def clamp_decimal(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _normalize_detail_line(value: str) -> str:
    cleaned = _normalize_line(value)
    if not cleaned:
        return ""
    cleaned = re.sub(r"^(?:\d{6,}|BNET\s+\d{6,}|BB\d{6,}|[A-Z0-9]{16,})", "", cleaned).strip()
    cleaned = _REFERENCE_RE.sub("", cleaned).strip()
    cleaned = _GENERIC_REFERENCE_RE.sub("", cleaned).strip()
    cleaned = _FOLIO_RE.sub("", cleaned).strip()
    cleaned = _GENERIC_FOLIO_RE.sub("", cleaned).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" -")
    return cleaned


def _is_bbva_footer_start(line: str) -> bool:
    upper = line.upper()
    return (
        "INFORMACION FINANCIERA MONEDA NACIONAL" in upper
        or upper.startswith("BBVA MEXICO, S.A.")
    )


def _should_skip_bbva_line(line: str) -> bool:
    upper = line.upper()
    return (
        upper.startswith("NO. CUENTA")
        or upper.startswith("NO. CLIENTE")
        or upper.startswith("ESTADO DE CUENTA")
        or upper.startswith("PAGINA ")
        or upper.startswith("MAESTRA PYME BBVA")
        or upper.startswith("FECHA SALDO")
        or upper.startswith("OPER LIQ COD.")
        or upper.startswith("BBVA MEXICO, S.A.")
        or upper.startswith("AV. PASEO DE LA REFORMA")
        or upper.startswith("DETALLE DE MOVIMIENTOS REALIZADOS")
        or upper.startswith("INFORMACION FINANCIERA")
        or upper.startswith("LA GAT REAL")
        or upper.startswith("DOMICILIO FISCAL")
    )


def _should_skip_generic_line(line: str) -> bool:
    upper = line.upper()
    return any(upper.startswith(prefix) for prefix in _GENERIC_SKIP_PREFIXES)


def _split_bbva_amounts(rest: str) -> dict[str, object]:
    match = _TRAILING_AMOUNTS_RE.match(rest)
    if not match:
        raise BankStatementParseError(f"No pudimos detectar el monto del movimiento: '{rest}'.")
    description = _humanize_bbva_description(match.group("prefix"))
    amounts = [_parse_decimal(token) for token in _MONEY_RE.findall(match.group("amounts"))]
    return {"description": description, "amounts": amounts}


def _split_generic_amounts(text: str) -> dict[str, object]:
    match = _GENERIC_TRAILING_AMOUNTS_RE.match(text)
    if not match:
        raise BankStatementParseError(
            f"No pudimos detectar los montos del movimiento bancario: '{text}'."
        )
    description = _normalize_line(match.group("prefix"))
    amounts = [_parse_decimal(token) for token in _GENERIC_MONEY_RE.findall(match.group("amounts"))]
    amount_candidates = amounts[:-1] if len(amounts) >= 2 else amounts
    return {
        "description": description,
        "amounts": amounts,
        "amount_candidates": amount_candidates,
    }


def _humanize_bbva_description(text: str) -> str:
    cleaned = _normalize_line(text)
    cleaned = re.sub(r"(RECIBIDO)([A-Z])", r"\1 \2", cleaned)
    cleaned = re.sub(r"(ENVIADO)([A-Z])", r"\1 \2", cleaned)
    cleaned = re.sub(r"(PRACTIC)([A-Z])", r"\1 \2", cleaned)
    return cleaned


def _parse_short_bbva_date(token: str, *, period_start: date, period_end: date) -> date:
    day = int(token[:2])
    month_code = token[3:].upper()
    month = _MONTHS.get(month_code)
    if month is None:
        raise BankStatementParseError(f"No pudimos interpretar el mes del movimiento '{token}'.")

    if period_start.year == period_end.year:
        year = period_end.year
    else:
        year = period_start.year if month >= period_start.month else period_end.year
    return date(year, month, day)


def _parse_statement_date(
    token: str | None, *, period_start: date | None, period_end: date | None
) -> date:
    if not token:
        raise BankStatementParseError("No pudimos interpretar la fecha de un movimiento.")
    normalized = token.strip().upper().replace("-", "/")
    parts = normalized.split("/")
    if len(parts) < 2:
        raise BankStatementParseError(f"No pudimos interpretar la fecha '{token}'.")

    day = int(parts[0])
    month_token = parts[1]
    month = int(month_token) if month_token.isdigit() else _MONTHS.get(month_token[:3])
    if month is None:
        raise BankStatementParseError(f"No pudimos interpretar el mes de la fecha '{token}'.")

    if len(parts) >= 3:
        year = int(parts[2])
        if year < 100:
            year += 2000
    elif period_start and period_end:
        year = period_start.year if month >= period_start.month else period_end.year
    else:
        year = timezone_safe_today().year
    return date(year, month, day)


def _parse_date_string(value: str) -> date:
    normalized = value.replace("-", "/")
    return _parse_statement_date(normalized, period_start=None, period_end=None)


def _parse_decimal(value: str) -> Decimal:
    cleaned = str(value).replace("$", "").replace(",", "").strip()
    try:
        return Decimal(cleaned)
    except InvalidOperation as exc:
        raise BankStatementParseError(f"No pudimos interpretar el monto '{value}'.") from exc


def _extract_reference(lines: list[str]) -> str | None:
    for line in lines:
        match = _REFERENCE_RE.search(line)
        if match:
            return match.group(1)
    return None


def _extract_generic_reference(lines: list[str]) -> str | None:
    legacy = _extract_reference(lines)
    if legacy:
        return legacy
    for line in lines:
        match = _GENERIC_REFERENCE_RE.search(line)
        if match:
            return match.group(1)
    return None


def _extract_folio(lines: list[str]) -> str | None:
    for line in lines:
        match = _FOLIO_RE.search(line)
        if match:
            return match.group(1)
    for line in lines:
        match = _LEADING_FOLIO_RE.match(line)
        if match:
            return match.group(1)
    return None


def _extract_generic_folio(lines: list[str]) -> str | None:
    legacy = _extract_folio(lines)
    if legacy:
        return legacy
    for line in lines:
        match = _GENERIC_FOLIO_RE.search(line)
        if match:
            return match.group(1)
    return None


def _extract_counterparty_name(lines: list[str]) -> str | None:
    for line in lines:
        if _looks_like_counterparty_name(line):
            return line.title()
    return None


def _extract_narrative_detail(lines: list[str]) -> str | None:
    for line in lines:
        if _looks_like_counterparty_name(line):
            continue
        if _TRACKING_LINE_RE.match(line.replace(" ", "")):
            continue
        if len(line) < 4:
            continue
        return line
    return None


def _looks_like_counterparty_name(line: str) -> bool:
    return bool(_NAME_LIKE_RE.match(line.upper())) and not line.upper().startswith("REF")


def _build_concept(*, main_description: str, narrative: str | None, counterparty: str | None) -> str:
    parts: list[str] = []
    if main_description:
        parts.append(main_description)
    if narrative and narrative.lower() not in main_description.lower():
        parts.append(narrative)
    if counterparty and counterparty.lower() not in " ".join(parts).lower():
        parts.append(counterparty)
    concept = " | ".join(part for part in parts if part).strip()
    if not concept:
        concept = "Movimiento bancario"
    return concept[:255]


def _infer_bbva_movement_type(
    *,
    bank_code: str,
    main_description: str,
    detail_lines: list[str],
) -> str:
    code = bank_code.upper()
    if code in _BBVA_INGRESO_CODES:
        return "INGRESO"
    if code in _BBVA_EGRESO_CODES:
        return "EGRESO"

    context = " ".join([main_description, *detail_lines]).upper()
    if any(keyword in context for keyword in ("RECIBIDO", "DEPOSITO", "ABONO", "COMPENSACION")):
        return "INGRESO"
    if any(keyword in context for keyword in ("ENVIADO", "COMISION", "IVA", "RETIRO", "CARGO", "PARC")):
        return "EGRESO"
    return "INGRESO"


def _infer_generic_movement_type(*, text: str, amount_candidates: list[Decimal]) -> str:
    upper = text.upper()
    if any(amount < 0 for amount in amount_candidates):
        return "EGRESO"
    if any(keyword in upper for keyword in _GENERIC_INGRESO_KEYWORDS):
        return "INGRESO"
    if any(keyword in upper for keyword in _GENERIC_EGRESO_KEYWORDS):
        return "EGRESO"
    return "INGRESO"


def _resolve_generic_amount_and_balance(
    *, amounts: list[Decimal], amount_candidates: list[Decimal], movement_type: str
) -> tuple[Decimal, Decimal | None]:
    if not amounts:
        raise BankStatementParseError("No pudimos determinar el monto del movimiento.")
    if len(amounts) == 1:
        return (abs(amounts[0]), None)

    saldo_resultante = amounts[-1]
    candidates = amount_candidates or amounts[:-1]
    if not candidates:
        return (abs(saldo_resultante), None)
    if len(candidates) == 1:
        return (abs(candidates[0]), saldo_resultante)

    non_zero = [amount for amount in candidates if amount != 0]
    if not non_zero:
        return (abs(candidates[0]), saldo_resultante)
    if movement_type == "INGRESO":
        return (abs(non_zero[-1]), saldo_resultante)
    return (abs(non_zero[0]), saldo_resultante)


def _estimate_generic_confidence(
    *,
    bank_name: str | None,
    period_start: date | None,
    period_end: date | None,
    numero_cuenta: str | None,
    clabe: str | None,
    saldo_inicial: Decimal | None,
    saldo_final: Decimal | None,
    movimientos: list[dict[str, object]],
) -> float:
    confidence = 0.35
    if bank_name:
        confidence += 0.1
    if period_start and period_end:
        confidence += 0.12
    if numero_cuenta:
        confidence += 0.1
    if clabe:
        confidence += 0.1
    if saldo_inicial is not None:
        confidence += 0.08
    if saldo_final is not None:
        confidence += 0.08
    if movimientos:
        confidence += min(0.17, len(movimientos) * 0.03)
    return round(min(confidence, 0.95), 2)


def _decimal_to_string(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None


def timezone_safe_today() -> date:
    return datetime.utcnow().date()


__all__ = [
    "BankStatementParseError",
    "ParsedBankStatement",
    "detect_bank_name",
    "detect_bank_parser",
    "extract_pdf_pages",
    "parse_bank_statement_pdf",
    "parse_bbva_statement_pages",
    "parse_generic_statement_pages",
]
