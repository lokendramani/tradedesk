"""AMFI scheme catalogue parsing and transactional persistence."""

import csv
import io
import logging
import re
import ssl
from threading import Lock
import urllib.request
from dataclasses import dataclass
from uuid import uuid4

import certifi
from django.db import transaction
from django.utils import timezone

from .models import MutualFundScheme, SchemeCatalogueImportLog, SchemeCatalogueRunLock

logger = logging.getLogger(__name__)

SOURCE_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt'
DOWNLOAD_TIMEOUT_SECONDS = 30
MINIMUM_VALID_RECORDS = 10
MAX_REJECTED_RATIO = 0.35
_process_operation_lock = Lock()
FAILURE_SUMMARIES = {
    'locking': 'Catalogue operation could not acquire its run lock.',
    'download': 'AMFI source download failed.',
    'parsing': 'AMFI source parsing failed.',
    'validation': 'AMFI source validation failed.',
    'persistence': 'Catalogue persistence failed.',
}
METADATA_FIELDS = (
    'scheme_name', 'fund_house', 'category_name', 'asset_class', 'plan_type',
    'option_type', 'isin_growth', 'isin_div_payout', 'isin_div_reinvestment',
)


@dataclass
class ParseResult:
    records: list[dict]
    parsed_count: int
    rejected_count: int
    errors: list[str]


class CatalogueError(Exception):
    """Safe, user-displayable catalogue import error."""


def download_source():
    request = urllib.request.Request(SOURCE_URL, headers={'User-Agent': 'WealthOnCruise/1.0'})
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(
            request,
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
            context=ssl_context,
        ) as response:
            content = response.read(20 * 1024 * 1024 + 1)
    except Exception as exc:
        raise CatalogueError('Could not download the AMFI scheme catalogue.') from exc
    if len(content) > 20 * 1024 * 1024:
        raise CatalogueError('The AMFI source exceeded the maximum supported file size.')
    return content.decode('utf-8-sig', errors='replace')


def _clean_isin(value):
    value = (value or '').strip()
    if not value or value == '-' or value.lower() in {'na', 'n/a', 'none'}:
        return None
    return value if re.fullmatch(r'[A-Z]{3}[A-Z0-9]{9}', value, re.I) else None


def _plan_type(plan, scheme_name):
    value = f'{plan} {scheme_name}'.lower()
    if re.search(r'\bdirect\s+plan\b', value):
        return MutualFundScheme.PlanType.DIRECT
    if re.search(r'\bregular\s+plan\b', value):
        return MutualFundScheme.PlanType.REGULAR
    return MutualFundScheme.PlanType.UNKNOWN


def _option_type(option, scheme_name):
    value = f'{option} {scheme_name}'.lower()
    if re.search(r'\bgrowth(?:\s+option)?\b', value):
        return MutualFundScheme.OptionType.GROWTH
    if 'idcw' in value or 'dividend' in value or 'income distribution' in value:
        return MutualFundScheme.OptionType.IDCW
    if option.strip() or re.search(r'\bbonus\b', scheme_name, re.I):
        return MutualFundScheme.OptionType.OTHER
    return MutualFundScheme.OptionType.UNKNOWN


def _asset_class(category):
    value = category.lower()
    if 'equity' in value:
        return MutualFundScheme.AssetClass.EQUITY
    if 'debt' in value:
        return MutualFundScheme.AssetClass.DEBT
    if 'hybrid' in value:
        return MutualFundScheme.AssetClass.HYBRID
    if 'scheme' in value:
        return MutualFundScheme.AssetClass.OTHER
    return MutualFundScheme.AssetClass.UNKNOWN


def _header_indexes(row):
    normalized = [re.sub(r'[^a-z0-9]+', ' ', cell.strip().lower()).strip() for cell in row]
    if not normalized or 'scheme code' not in normalized[0]:
        return None
    indexes = {'code': 0}
    for i, value in enumerate(normalized):
        if value in {'scheme name', 'name of scheme'}:
            indexes['name'] = i
        elif value == 'plan':
            indexes['plan'] = i
        elif value == 'option':
            indexes['option'] = i
        elif 'isin div payout' in value or 'isin growth' in value:
            indexes['isin_primary'] = i
        elif 'isin div reinvestment' in value:
            indexes['isin_reinvest'] = i
    return indexes if 'name' in indexes else None


def parse_source(text):
    """Parse current AMFI NAVAll text while ignoring NAV and date values."""
    text = text.lstrip('\ufeff')
    reader = csv.reader(io.StringIO(text), delimiter=';')
    category = ''
    fund_house = ''
    indexes = None
    records = []
    seen_codes = set()
    parsed_count = rejected_count = 0
    errors = []

    for line_number, raw in enumerate(reader, 1):
        row = [cell.strip() for cell in raw]
        if not row or not any(row):
            continue
        if indexes is None:
            detected = _header_indexes(row)
            if detected:
                indexes = detected
                continue

        line = row[0]
        if line.lower().startswith('open ended schemes') or line.lower().startswith('close ended schemes'):
            match = re.search(r'\((.*?)\)\s*$', line)
            category = match.group(1).strip() if match else ''
            continue

        if len(row) == 1 and line.lower().endswith('mutual fund'):
            fund_house = line
            continue

        if not re.fullmatch(r'\d{1,12}', line):
            continue
        parsed_count += 1
        try:
            if indexes:
                code = row[indexes['code']]
                name = row[indexes['name']]
                plan = row[indexes['plan']] if 'plan' in indexes and indexes['plan'] < len(row) else ''
                option = row[indexes['option']] if 'option' in indexes and indexes['option'] < len(row) else ''
                primary_isin = row[indexes['isin_primary']] if 'isin_primary' in indexes and indexes['isin_primary'] < len(row) else ''
                reinvest_isin = row[indexes['isin_reinvest']] if 'isin_reinvest' in indexes and indexes['isin_reinvest'] < len(row) else ''
            elif len(row) >= 8:
                code, primary_isin, reinvest_isin, name, plan, option = row[:6]
            elif len(row) >= 4:
                code, name, primary_isin, reinvest_isin = row[:4]
                plan = option = ''
            else:
                raise ValueError('too few fields')
            code, name = code.strip(), name.strip()
            if not code.isdigit() or not name:
                raise ValueError('missing scheme code or name')
            if code in seen_codes:
                rejected_count += 1
                errors.append(f'line {line_number}: duplicate scheme code')
                continue
            seen_codes.add(code)

            option_type = _option_type(option, name)
            primary = _clean_isin(primary_isin)
            reinvest = _clean_isin(reinvest_isin)
            growth_isin = primary if option_type == MutualFundScheme.OptionType.GROWTH else None
            payout_isin = primary if option_type == MutualFundScheme.OptionType.IDCW else None
            records.append({
                'scheme_code': code,
                'scheme_name': name,
                'fund_house': fund_house,
                'category_name': category,
                'asset_class': _asset_class(category),
                'plan_type': _plan_type(plan, name),
                'option_type': option_type,
                'isin_growth': growth_isin,
                'isin_div_payout': payout_isin,
                'isin_div_reinvestment': reinvest,
            })
        except (IndexError, ValueError):
            rejected_count += 1
            errors.append(f'line {line_number}: malformed scheme record')

    return ParseResult(records, parsed_count, rejected_count, errors[:20])


def validate_source(result):
    if len(result.records) < MINIMUM_VALID_RECORDS:
        raise CatalogueError('The AMFI source did not contain enough valid scheme records.')
    if not result.parsed_count:
        raise CatalogueError('The AMFI source contained no scheme records.')
    rejected_ratio = result.rejected_count / result.parsed_count
    if rejected_ratio > MAX_REJECTED_RATIO:
        raise CatalogueError('The AMFI source appears incomplete or malformed; no catalogue changes were made.')
    return result


def _save_log(operation, status, result=None, **counts):
    now = timezone.now()
    return SchemeCatalogueImportLog.objects.create(
        operation=operation,
        status=status,
        source=SOURCE_URL,
        completed_at=now,
        parsed_count=result.parsed_count if result else counts.get('parsed_count', 0),
        valid_count=len(result.records) if result else counts.get('valid_count', 0),
        rejected_count=result.rejected_count if result else counts.get('rejected_count', 0),
        inserted_count=counts.get('inserted_count', 0),
        updated_count=counts.get('updated_count', 0),
        unchanged_count=counts.get('unchanged_count', 0),
        error_summary=counts.get('error_summary', ''),
    )


def _import(operation):
    """Run under the singleton row lock and transaction; changes are atomic."""
    run_id = uuid4().hex
    stage = 'locking'
    try:
        with transaction.atomic():
            SchemeCatalogueRunLock.objects.get_or_create(pk=1)
            SchemeCatalogueRunLock.objects.select_for_update().get(pk=1)

            if operation == SchemeCatalogueImportLog.Operation.INITIAL and MutualFundScheme.objects.exists():
                log = _save_log(operation, SchemeCatalogueImportLog.Status.SKIPPED,
                                error_summary='Catalogue already contains schemes; source was not downloaded.')
                return {'status': 'SKIPPED', 'reason': 'Catalogue already contains schemes.', 'log_id': log.pk,
                        'inserted': 0, 'updated': 0, 'unchanged': 0}

            stage = 'download'
            source = download_source()
            stage = 'parsing'
            parsed = parse_source(source)
            stage = 'validation'
            result = validate_source(parsed)

            stage = 'persistence'
            now = timezone.now()
            existing = {scheme.scheme_code: scheme for scheme in MutualFundScheme.objects.all()}
            to_create, changed_rows = [], []
            inserted = updated = unchanged = 0
            for data in result.records:
                data = {**data, 'last_seen_at': now}
                scheme = existing.get(data['scheme_code'])
                if scheme is None:
                    to_create.append(MutualFundScheme(**data))
                    inserted += 1
                    continue
                changed = any(getattr(scheme, field) != data[field] for field in METADATA_FIELDS)
                if changed:
                    for field in METADATA_FIELDS:
                        setattr(scheme, field, data[field])
                    scheme.updated_at = now
                    updated += 1
                else:
                    unchanged += 1
                if changed:
                    scheme.last_seen_at = now
                    changed_rows.append(scheme)

            if to_create:
                MutualFundScheme.objects.bulk_create(to_create, batch_size=500)
            if changed_rows:
                MutualFundScheme.objects.bulk_update(
                    changed_rows, list(METADATA_FIELDS) + ['last_seen_at', 'updated_at'], batch_size=500,
                )
            log = _save_log(
                operation, SchemeCatalogueImportLog.Status.SUCCESS, result,
                inserted_count=inserted, updated_count=updated, unchanged_count=unchanged,
            )
            return {'status': 'SUCCESS', 'log_id': log.pk, 'parsed': result.parsed_count,
                    'valid': len(result.records), 'rejected': result.rejected_count,
                    'inserted': inserted, 'updated': updated, 'unchanged': unchanged}
    except Exception as exc:
        # Log the original exception and chain before translating it for API/CLI use.
        logger.exception(
            'Scheme catalogue operation failed: operation=%s stage=%s run_id=%s',
            operation,
            stage,
            run_id,
        )
        summary = f'{stage}: {FAILURE_SUMMARIES[stage]} run_id={run_id}'
        try:
            _save_log(operation, SchemeCatalogueImportLog.Status.FAILED, error_summary=summary)
        except Exception:
            # A database outage may prevent recording the failure; keep the API/CLI error sanitized.
            pass
        if isinstance(exc, CatalogueError):
            raise
        raise CatalogueError('The catalogue operation failed; no partial catalogue changes were retained.') from exc


def initialize_scheme_catalogue():
    with _process_operation_lock:
        return _import(SchemeCatalogueImportLog.Operation.INITIAL)


def refresh_scheme_catalogue():
    with _process_operation_lock:
        return _import(SchemeCatalogueImportLog.Operation.REFRESH)
