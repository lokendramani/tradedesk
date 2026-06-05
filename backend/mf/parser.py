"""
CAS (Consolidated Account Statement) parser.

Designed to handle CAMS and KFintech formats generically:
  - Transactions detected by structure (date + 4 numeric tokens at end)
    rather than by hardcoded descriptions or fund names.
  - Stamp-duty orphan lines (date + single small number) are skipped.
  - Date-only lines (SIP mandate registration dates) are skipped.
  - Negative values in parentheses like (42,000.00) are handled.
  - Multi-line scheme headers are merged before parsing.

Adding a new registrar/format requires at most adjusting the folio/scheme
regex patterns; the transaction detection is format-agnostic.
"""

import re
import io
from decimal import Decimal, InvalidOperation
from datetime import datetime

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False


# ── Helpers ────────────────────────────────────────────────────────────────────

DATE_RE       = re.compile(r'^\d{1,2}-[A-Za-z]{3}-\d{4}$')
NUMERIC_RE    = re.compile(r'^\(?[\d,]+\.[\d]+\)?$')
DATE_FORMATS  = ['%d-%b-%Y', '%d-%B-%Y']


def _parse_date(s: str):
    s = s.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_decimal(s: str):
    s = s.strip()
    negative = s.startswith('(') and s.endswith(')')
    s = s.strip('()').replace(',', '')
    try:
        val = Decimal(s)
        return -val if negative else val
    except (InvalidOperation, ValueError):
        return None


def _is_numeric(token: str) -> bool:
    return bool(NUMERIC_RE.match(token.strip()))


# ── Transaction type classifier ────────────────────────────────────────────────

def _classify_txn(description: str) -> str:
    d = description.upper()
    if ('STP' in d or 'SYSTEMATIC TRANSFER') and 'SWITCH IN' in d:
        return 'SWITCH_IN'
    if ('STP' in d or 'SYSTEMATIC TRANSFER') and 'SWITCH OUT' in d:
        return 'SWITCH_OUT'
    if 'SWITCH IN' in d:
        return 'SWITCH_IN'
    if 'SWITCH OUT' in d:
        return 'SWITCH_OUT'
    if 'SIP' in d:
        return 'SIP'
    if 'SYSTEMATIC' in d and ('PURCHASE' in d or 'NORMAL' in d):
        return 'SIP'
    if 'REDEMPTION' in d or 'REDEEM' in d:
        return 'REDEMPTION'
    if 'PURCHASE' in d or 'BUY' in d:
        return 'PURCHASE'
    if 'DIVIDEND' in d or 'IDCW' in d:
        return 'DIVIDEND'
    if 'BONUS' in d:
        return 'BONUS'
    return 'OTHER'


# ── Scheme metadata extractors ─────────────────────────────────────────────────

def _detect_plan(text: str) -> str:
    if re.search(r'\bDIRECT\b', text, re.I):
        return 'DIRECT'
    return 'REGULAR'


def _detect_option(text: str) -> str:
    if re.search(r'\b(IDCW|DIVIDEND)\b', text, re.I):
        return 'IDCW'
    return 'GROWTH'


def _extract_scheme_info(header_line: str, isin_line: str = '') -> dict:
    """
    Parse:
      "HGFGT-HDFC Balanced Advantage Fund - Direct Plan - Growth Option (formerly ...) Registrar : CAMS"
      "(Non-Demat) - ISIN: INF179K01WA6(Advisor: DIRECT)"
    Returns dict with scheme_code, scheme_name, isin, registrar, plan, option.
    """
    full = header_line + ' ' + isin_line

    # Scheme code: leading all-caps segment before the first dash + uppercase letter
    code_m = re.match(r'^([A-Z0-9]{2,10})-([A-Z])', header_line)
    scheme_code = code_m.group(1) if code_m else ''

    # Scheme name: strip code prefix, strip everything from "Registrar" onwards,
    # and strip parenthetical "formerly ..." notes
    name = header_line
    if scheme_code:
        name = name[len(scheme_code) + 1:]          # remove "CODE-"
    name = re.sub(r'\s*\(formerly[^)]*\)', '', name, flags=re.I)
    name = re.sub(r'\s*\(erstwhile[^)]*\)', '', name, flags=re.I)
    name = re.sub(r'\s*Registrar\s*:.*$', '', name, flags=re.I | re.S)
    name = re.sub(r'\s*\(Non-Demat\).*$', '', name, flags=re.I | re.S)
    name = name.strip(' -,()')

    # Registrar: CAMS / KFintech / etc.
    reg_m = re.search(r'Registrar\s*:\s*(\S+)', full, re.I)
    registrar = reg_m.group(1).strip() if reg_m else ''

    # ISIN: INF… (may be split across a line break, e.g. INF109K | 016E5…)
    isin_m = re.search(r'ISIN\s*:\s*(IN[A-Z0-9]+)', full, re.I)
    isin = isin_m.group(1) if isin_m else ''
    if isin and len(isin) < 12 and isin_line:
        cont = re.match(r'^([A-Z0-9]+)', isin_line.strip())
        if cont:
            isin = isin + cont.group(1)

    return {
        'scheme_code': scheme_code,
        'scheme_name': name,
        'isin':        isin,
        'registrar':   registrar,
        'plan':        _detect_plan(name),
        'option':      _detect_option(name),
    }


def _extract_closing_info(line: str) -> dict:
    """
    Parse: Closing Unit Balance: 4,386.775 NAV on 27-May-2026: INR 556.380
           Total Cost Value: 2,400,000.00 Market Value on 27-May-2026: INR 2,440,713.87
    """
    result = {}
    m = re.search(r'Closing Unit Balance:\s*([\d,]+\.[\d]+)', line)
    if m:
        result['closing_units'] = _parse_decimal(m.group(1))

    m = re.search(r'NAV on ([\d]+-[A-Za-z]+-[\d]+)\s*:\s*INR\s*([\d,]+\.[\d]+)', line)
    if m:
        result['closing_nav_date'] = _parse_date(m.group(1))
        result['closing_nav']      = _parse_decimal(m.group(2))

    m = re.search(r'Total Cost Value:\s*([\d,]+\.[\d]+)', line)
    if m:
        result['cost_value'] = _parse_decimal(m.group(1))

    m = re.search(r'Market Value on [^:]+:\s*INR\s*([\d,]+\.[\d]+)', line)
    if m:
        result['market_value'] = _parse_decimal(m.group(1))

    return result


# ── Transaction line parser ────────────────────────────────────────────────────

def _try_parse_txn(line: str) -> dict | None:
    """
    Attempt to parse a line as a transaction.
    A valid transaction line looks like:
      DD-Mon-YYYY  <description text>  <amount>  <units>  <nav>  <balance>
    where the last 4 tokens are numeric (with optional commas, parentheses).
    Returns dict or None.
    """
    parts = line.split()
    if len(parts) < 6:
        return None

    if _parse_date(parts[0]) is None:
        return None

    # Collect consecutive numeric tokens from the right
    right_nums = []
    for tok in reversed(parts[1:]):
        if _is_numeric(tok):
            right_nums.insert(0, tok)
        else:
            break

    if len(right_nums) < 4:
        return None  # not enough columns (stamp-duty or date-only lines fall here)

    # Use exactly the last 4 numeric tokens
    last4       = right_nums[-4:]
    first_num_i = parts.index(last4[0], 1)
    description = ' '.join(parts[1:first_num_i]).strip()

    if not description:
        return None  # stamp-duty orphan line

    amount      = _parse_decimal(last4[0])
    units       = _parse_decimal(last4[1])
    nav         = _parse_decimal(last4[2])
    unit_balance = _parse_decimal(last4[3])

    if any(v is None for v in [amount, units, nav, unit_balance]):
        return None

    date = _parse_date(parts[0])

    return {
        'date':         date,
        'description':  description,
        'amount':       amount,
        'units':        units,
        'nav':          nav,
        'unit_balance': unit_balance,
        'txn_type':     _classify_txn(description),
    }


# ── Line classifiers ───────────────────────────────────────────────────────────

def _is_folio_line(line: str) -> bool:
    return bool(re.match(r'Folio No\s*:', line, re.I))


def _is_scheme_header_line(line: str) -> bool:
    # Scheme codes always START with a letter (e.g. HGFGT-, P8145-, LD074G-).
    # Dates (28-Nov-2024) start with digits — they must NOT match.
    return bool(re.match(r'^[A-Z][A-Z0-9]{1,9}-[A-Z]', line))


def _is_closing_line(line: str) -> bool:
    return line.startswith('Closing Unit Balance:')


def _is_opening_line(line: str) -> bool:
    return line.startswith('Opening Unit Balance:')


def _is_isin_line(line: str) -> bool:
    return bool(re.search(r'ISIN\s*:', line, re.I)) and not _is_scheme_header_line(line)


_SKIP_PREFIXES = (
    'Consolidated Account Statement',
    'Page ',
    'Date ',
    'Email Id',
    'Mobile:',
    'Nominee',
    'This Consolidated',
    'PORTFOLIO SUMMARY',
    'Cost Value',
    'Mutual Fund',
    'Total ',
    '*',
    'Entry Load',
    'Exit Load',
    'Current Load',
    'Current :',
    'Stamp Duty',
    'GST Identification',
    '"Please',
    'Please ensure',
    'Scheme Name of',
)


def _should_skip(line: str) -> bool:
    for prefix in _SKIP_PREFIXES:
        if line.startswith(prefix):
            return True
    # Page header date range line: "03-Nov-2006 To 28-May-2026"
    if re.match(r'^\d{2}-[A-Za-z]{3}-\d{4}\s+To\s+\d{2}-[A-Za-z]{3}-\d{4}$', line):
        return True
    # Column header line
    if re.match(r'^Date\s+Transaction\s+Amount', line):
        return True
    return False


# ── Folio info extractor ───────────────────────────────────────────────────────

def _extract_folio_info(line: str) -> tuple:
    """Returns (folio_number, pan)."""
    m = re.search(r'Folio No\s*:\s*([\w\s/]+?)(?:\s{2,}|PAN:|$)', line, re.I)
    folio = m.group(1).strip() if m else None

    m = re.search(r'PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])', line)
    pan = m.group(1) if m else ''

    return folio, pan


# ── Fund house detection ───────────────────────────────────────────────────────

def _is_fund_house_line(line: str) -> bool:
    """
    A fund-house header is a short line containing "Mutual Fund" or "Asset Management"
    that doesn't look like a folio/scheme/transaction line.
    """
    if len(line) > 120:
        return False
    if re.search(r'\b(Mutual Fund|Asset Management)\b', line, re.I):
        # Exclude lines that also have folio / ISIN / Registrar / transaction markers
        if not re.search(r'(Folio|ISIN|Registrar|Opening|Closing|INR|Purchase|Redemption|SIP|Switch)', line, re.I):
            if not _is_scheme_header_line(line):
                return True
    return False


# ── Main parse function ────────────────────────────────────────────────────────

def parse_cas_pdf(file_obj) -> dict:
    """
    Parse a CAS PDF file (file-like object or path).
    Returns:
    {
        'investor': {'name': ..., 'pan': ..., 'email': ...},
        'folios': [
            {
                'folio_number': ...,
                'fund_house':   ...,
                'holder_name':  ...,
                'pan':          ...,
                'schemes': [
                    {
                        'scheme_name': ..., 'scheme_code': ...,
                        'isin': ..., 'registrar': ...,
                        'plan': ..., 'option': ...,
                        'closing_units': ..., 'closing_nav': ...,
                        'closing_nav_date': ..., 'cost_value': ...,
                        'market_value': ...,
                        'transactions': [
                            {'date': ..., 'txn_type': ..., 'description': ...,
                             'amount': ..., 'units': ..., 'nav': ..., 'unit_balance': ...}
                        ]
                    }
                ]
            }
        ]
    }
    """
    if not HAS_PDFPLUMBER:
        raise RuntimeError("pdfplumber is not installed. Run: pip install pdfplumber")

    # ── Extract all lines from PDF ───────────────────────────────────────────
    all_lines = []
    with pdfplumber.open(file_obj) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                for raw in text.split('\n'):
                    line = raw.strip()
                    if line:
                        all_lines.append(line)

    # ── Investor info (from first ~25 lines) ────────────────────────────────
    investor = {'name': '', 'pan': '', 'email': ''}
    for line in all_lines[:25]:
        m = re.search(r'Email\s+Id\s*:\s*(\S+)', line, re.I)
        if m:
            investor['email'] = m.group(1)
        m = re.search(r'Mobile\s*:\s*(\+?[\d\s-]+)', line, re.I)
        if m:
            investor['mobile'] = m.group(1).strip()
        m = re.search(r'PAN\s*:\s*([A-Z]{5}\d{4}[A-Z])', line)
        if m and not investor['pan']:
            investor['pan'] = m.group(1)

    # ── State machine ────────────────────────────────────────────────────────
    current_fund_house   = ''
    current_folio_num    = None
    current_folio_pan    = ''
    current_holder       = ''
    pending_holder       = False   # next non-empty non-skip line after folio = holder name

    current_scheme       = None    # dict being built
    current_txns         = []      # transactions for current scheme

    folios               = {}      # keyed by folio_number

    def _save_scheme():
        nonlocal current_scheme, current_txns
        if current_scheme and current_folio_num and current_folio_num in folios:
            key = current_scheme.get('isin') or current_scheme['scheme_name']
            folios[current_folio_num]['schemes'][key] = {
                **current_scheme,
                'transactions': current_txns,
            }
        current_scheme = None
        current_txns   = []

    i = 0
    while i < len(all_lines):
        line = all_lines[i]

        # ── Skip boilerplate ─────────────────────────────────────────────────
        if _should_skip(line):
            i += 1
            continue

        # ── Holder name capture (line right after folio line) ────────────────
        if pending_holder:
            if not re.search(r'(Folio|KYC|PAN\s*:|ISIN|Registrar|Opening|Closing)', line, re.I):
                current_holder = line.strip()
                if current_folio_num in folios:
                    folios[current_folio_num]['holder_name'] = current_holder
                    if not investor['name']:
                        investor['name'] = current_holder
            pending_holder = False

        # ── Fund house header ────────────────────────────────────────────────
        if _is_fund_house_line(line):
            current_fund_house = line.strip()
            i += 1
            continue

        # ── Folio line ───────────────────────────────────────────────────────
        if _is_folio_line(line):
            _save_scheme()
            folio_num, pan = _extract_folio_info(line)
            if folio_num:
                current_folio_num  = folio_num
                current_folio_pan  = pan
                pending_holder     = True
                if folio_num not in folios:
                    folios[folio_num] = {
                        'folio_number': folio_num,
                        'fund_house':   current_fund_house,
                        'holder_name':  '',
                        'pan':          pan,
                        'schemes':      {},
                    }
            i += 1
            continue

        # ── Scheme header ────────────────────────────────────────────────────
        if _is_scheme_header_line(line) and current_folio_num:
            _save_scheme()
            # Peek at next line — it often contains ISIN
            isin_line = all_lines[i + 1] if i + 1 < len(all_lines) else ''
            current_scheme = _extract_scheme_info(line, isin_line)
            current_txns   = []
            i += 1
            continue

        # ── ISIN continuation line (already consumed as peek above, skip) ───
        if _is_isin_line(line):
            i += 1
            continue

        # ── Opening balance line (skip) ─────────────────────────────────────
        if _is_opening_line(line):
            i += 1
            continue

        # ── Closing balance line ─────────────────────────────────────────────
        if _is_closing_line(line):
            if current_scheme:
                current_scheme.update(_extract_closing_info(line))
            _save_scheme()
            i += 1
            continue

        # ── Transaction line ─────────────────────────────────────────────────
        txn = _try_parse_txn(line)
        if txn and current_scheme is not None:
            current_txns.append(txn)
            i += 1
            continue

        # ── Date-only lines and stamp-duty orphans fall through here (skip) ──
        i += 1

    # Flush any open scheme
    _save_scheme()

    return {
        'investor': investor,
        'folios':   [
            {**f, 'schemes': list(f['schemes'].values())}
            for f in folios.values()
        ],
    }
