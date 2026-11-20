import csv
import io
import json
import logging
import re
import ssl
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

import certifi
from django.db import transaction
from django.utils import timezone

from .holdings import wealth_folio_position_summary
from .models import (
    MutualFundScheme,
    WealthMFNAVHistory,
    WealthMFNAVHistoryLoad,
    WealthMFNAVUpdateLock,
    WealthMFNAVUpdateRun,
)


logger = logging.getLogger(__name__)

AMFI_NAVALL_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt'
MFAPI_SCHEME_URL = 'https://api.mfapi.in/mf/{scheme_code}'
DOWNLOAD_TIMEOUT_SECONDS = 30
MAX_SOURCE_BYTES = 20 * 1024 * 1024
MINIMUM_VALID_AMFI_ROWS = 10
MAX_AMFI_REJECTED_RATIO = Decimal('0.35')
RUN_LOCK_STALE_AFTER = timedelta(minutes=30)
_process_update_lock = threading.Lock()


class NAVUpdateError(Exception):
    """Safe, user-facing NAV update error."""


class NAVUpdateBusy(NAVUpdateError):
    pass


def _download_text(url, *, maximum_bytes=MAX_SOURCE_BYTES):
    request = urllib.request.Request(url, headers={'User-Agent': 'WealthOnCruise/1.0'})
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urllib.request.urlopen(
            request,
            timeout=DOWNLOAD_TIMEOUT_SECONDS,
            context=ssl_context,
        ) as response:
            content = response.read(maximum_bytes + 1)
    except Exception as exc:
        raise NAVUpdateError('The NAV source could not be downloaded. Please retry.') from exc
    if len(content) > maximum_bytes:
        raise NAVUpdateError('The NAV source exceeded the supported file size.')
    try:
        return content.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise NAVUpdateError('The NAV source could not be decoded.') from exc


def _parse_nav(value):
    try:
        nav = Decimal(str(value).strip())
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not nav.is_finite() or nav <= 0:
        return None
    return nav


def _parse_nav_date(value, formats):
    for date_format in formats:
        try:
            return datetime.strptime(str(value).strip(), date_format).date()
        except (TypeError, ValueError):
            continue
    return None


def parse_mfapi_history(payload, requested_scheme_code):
    """Validate and normalize one MFAPI history response without touching the DB."""
    if not isinstance(payload, dict) or payload.get('status') != 'SUCCESS':
        raise NAVUpdateError('MFAPI did not return a successful NAV history response.')
    metadata = payload.get('meta')
    if not isinstance(metadata, dict) or str(metadata.get('scheme_code', '')).strip() != str(requested_scheme_code):
        raise NAVUpdateError('MFAPI returned a different scheme than requested.')
    rows = payload.get('data')
    if not isinstance(rows, list) or not rows:
        raise NAVUpdateError('MFAPI returned no historical NAV records.')

    by_date = {}
    invalid_count = 0
    for row in rows:
        if not isinstance(row, dict):
            invalid_count += 1
            continue
        nav_date = _parse_nav_date(row.get('date'), ('%d-%m-%Y',))
        nav = _parse_nav(row.get('nav'))
        if nav_date is None or nav is None or nav_date > timezone.localdate():
            invalid_count += 1
            continue
        # MFAPI sends newest first; retaining the first value resolves duplicate dates.
        by_date.setdefault(nav_date, nav)
    if invalid_count or not by_date:
        raise NAVUpdateError('MFAPI returned invalid or unusable historical NAV records.')
    return [{'nav_date': nav_date, 'nav': nav} for nav_date, nav in sorted(by_date.items())]


def parse_amfi_navall(text):
    """Parse NAV/date rows from NAVAll, independently of catalogue parsing."""
    reader = csv.reader(io.StringIO(text.lstrip('\ufeff')), delimiter=';')
    indexes = None
    records = {}
    rejected_codes = set()
    recognized_rows = 0
    rejected_rows = 0

    for raw in reader:
        row = [cell.strip() for cell in raw]
        if not row or not any(row):
            continue
        normalized = [re.sub(r'[^a-z0-9]+', ' ', cell.lower()).strip() for cell in row]
        if normalized and normalized[0] == 'scheme code':
            candidates = {}
            for index, heading in enumerate(normalized):
                if heading in {'net asset value', 'nav'}:
                    candidates['nav'] = index
                elif heading == 'date':
                    candidates['date'] = index
            if 'nav' in candidates and 'date' in candidates:
                candidates['scheme_code'] = 0
                indexes = candidates
            continue
        if not indexes or not re.fullmatch(r'\d{1,12}', row[0]):
            continue

        recognized_rows += 1
        code = row[0]
        try:
            raw_nav = row[indexes['nav']]
            raw_date = row[indexes['date']]
        except IndexError:
            rejected_rows += 1
            rejected_codes.add(code)
            continue
        nav = _parse_nav(raw_nav)
        nav_date = _parse_nav_date(raw_date, ('%d-%b-%Y', '%d-%b-%y', '%d-%m-%Y'))
        if nav is None or nav_date is None or nav_date > timezone.localdate():
            rejected_rows += 1
            rejected_codes.add(code)
            continue
        existing = records.get(code)
        if existing is None or nav_date > existing['nav_date']:
            records[code] = {'nav_date': nav_date, 'nav': nav}
        rejected_codes.discard(code)

    if recognized_rows < MINIMUM_VALID_AMFI_ROWS or len(records) < MINIMUM_VALID_AMFI_ROWS:
        raise NAVUpdateError('The AMFI NAV file was empty or incomplete.')
    if Decimal(rejected_rows) / Decimal(recognized_rows) > MAX_AMFI_REJECTED_RATIO:
        raise NAVUpdateError('The AMFI NAV file contains too many invalid records.')
    rejected_codes.difference_update(records)
    return records, rejected_codes


def _upsert_history_rows(rows):
    """Upsert validated history rows and report inserted/updated counts."""
    if not rows:
        return 0, 0
    scheme_ids = {row['scheme_id'] for row in rows}
    dates = {row['nav_date'] for row in rows}
    existing = {
        (scheme_id, nav_date): source
        for scheme_id, nav_date, source in WealthMFNAVHistory.objects.filter(
            scheme_id__in=scheme_ids,
            nav_date__in=dates,
        ).values_list('scheme_id', 'nav_date', 'source')
    }
    # AMFI is authoritative for an overlapping date, regardless of update order.
    protected = {
        (row['scheme_id'], row['nav_date'])
        for row in rows
        if row['source'] == WealthMFNAVHistory.Source.MFAPI
        and existing.get((row['scheme_id'], row['nav_date'])) == WealthMFNAVHistory.Source.AMFI
    }
    rows = [row for row in rows if (row['scheme_id'], row['nav_date']) not in protected]
    if not rows:
        return 0, 0
    now = timezone.now()
    values = [
        WealthMFNAVHistory(
            scheme_id=row['scheme_id'],
            nav_date=row['nav_date'],
            nav=row['nav'],
            source=row['source'],
            updated_at=now,
        )
        for row in rows
    ]
    WealthMFNAVHistory.objects.bulk_create(
        values,
        update_conflicts=True,
        update_fields=['nav', 'source', 'updated_at'],
        unique_fields=['scheme', 'nav_date'],
    )
    updated = sum((row['scheme_id'], row['nav_date']) in existing for row in rows)
    return len(rows) - updated, updated


def ensure_scheme_history_loaded(scheme):
    """Fetch and store one scheme's full MFAPI history once, with retryable failures."""
    state, _ = WealthMFNAVHistoryLoad.objects.get_or_create(scheme=scheme)
    try:
        with transaction.atomic():
            state = WealthMFNAVHistoryLoad.objects.select_for_update().get(scheme=scheme)
            if state.history_loaded_at:
                return False
            state.last_attempt_at = timezone.now()
            state.error_summary = ''
            state.save(update_fields=['last_attempt_at', 'error_summary'])
            try:
                payload_text = _download_text(
                    MFAPI_SCHEME_URL.format(scheme_code=scheme.scheme_code),
                    maximum_bytes=MAX_SOURCE_BYTES,
                )
                payload = json.loads(payload_text)
                rows = parse_mfapi_history(payload, scheme.scheme_code)
            except NAVUpdateError:
                raise
            except (json.JSONDecodeError, TypeError, ValueError) as exc:
                raise NAVUpdateError('MFAPI returned an invalid history response.') from exc

            _upsert_history_rows([
                {
                    'scheme_id': scheme.pk,
                    'nav_date': row['nav_date'],
                    'nav': row['nav'],
                    'source': WealthMFNAVHistory.Source.MFAPI,
                }
                for row in rows
            ])
            state.history_loaded_at = timezone.now()
            state.error_summary = ''
            state.save(update_fields=['history_loaded_at', 'error_summary'])
        return True
    except NAVUpdateError:
        with transaction.atomic():
            state = WealthMFNAVHistoryLoad.objects.select_for_update().get(scheme=scheme)
            state.last_attempt_at = timezone.now()
            state.error_summary = 'MFAPI history could not be fetched or validated.'
            state.save(update_fields=['last_attempt_at', 'error_summary'])
        logger.warning('MFAPI history load failed for scheme=%s', scheme.scheme_code, exc_info=True)
        raise


def _run_payload(run):
    run_age_seconds = max(0, int((timezone.now() - run.started_at).total_seconds()))
    return {
        'run_id': str(run.pk),
        'trigger_type': run.trigger_type,
        'status': run.status,
        'started_at': run.started_at,
        'run_age_seconds': run_age_seconds,
        'completed_at': run.completed_at,
        'held_schemes': run.held_scheme_count,
        'inserted': run.inserted_count,
        'updated': run.updated_count,
        'skipped': run.skipped_count,
        'failed': run.failed_count,
        'error_summary': run.error_summary,
    }


def latest_nav_update_summary():
    latest = WealthMFNAVUpdateRun.objects.first()
    last_success = WealthMFNAVUpdateRun.objects.filter(status=WealthMFNAVUpdateRun.Status.SUCCESS).first()
    return {
        'stale_after_seconds': int(RUN_LOCK_STALE_AFTER.total_seconds()),
        'last_successful_update': last_success.completed_at if last_success else None,
        'latest_run': _run_payload(latest) if latest else None,
    }


def _nav_update_lock_queryset():
    """Lock the singleton updater row without locking its nullable active_run join."""
    return WealthMFNAVUpdateLock.objects.select_for_update(of=('self',)).select_related('active_run')


def run_amfi_nav_update(*, triggered_by=None, trigger_type='ADMIN_MANUAL'):
    """Run the independent held-scheme AMFI NAV updater once, with DB/process locks."""
    started_at = time.monotonic()
    if not _process_update_lock.acquire(blocking=False):
        raise NAVUpdateBusy('An AMFI NAV update is already running.')

    run = None
    negative_position_count = 0
    try:
        with transaction.atomic():
            WealthMFNAVUpdateLock.objects.get_or_create(pk=1)
            lock = _nav_update_lock_queryset().get(pk=1)
            if lock.active_run and lock.active_run.status == WealthMFNAVUpdateRun.Status.RUNNING:
                stale_before = timezone.now() - RUN_LOCK_STALE_AFTER
                if lock.active_run.started_at >= stale_before:
                    raise NAVUpdateBusy('An AMFI NAV update is already running.')
                lock.active_run.status = WealthMFNAVUpdateRun.Status.FAILED
                lock.active_run.completed_at = timezone.now()
                lock.active_run.error_summary = 'Previous NAV update expired before completion.'
                lock.active_run.save(update_fields=['status', 'completed_at', 'error_summary'])
            run = WealthMFNAVUpdateRun.objects.create(
                trigger_type=trigger_type,
                triggered_by=triggered_by,
            )
            lock.active_run = run
            lock.save(update_fields=['active_run', 'updated_at'])

        try:
            position_summary = wealth_folio_position_summary()
            held_scheme_ids = position_summary['positive_scheme_ids']
            negative_position_count = position_summary['negative_folio_positions']
            held_schemes = list(
                MutualFundScheme.objects.filter(pk__in=held_scheme_ids).only('id', 'scheme_code')
            )
            run.held_scheme_count = len(held_schemes)
            source = _download_text(AMFI_NAVALL_URL)
            records, rejected_codes = parse_amfi_navall(source)
            held_codes = {scheme.scheme_code for scheme in held_schemes}
            failed_codes = held_codes & rejected_codes
            missing_codes = held_codes - records.keys() - failed_codes
            nav_rows = [
                {
                    'scheme_id': scheme.pk,
                    'nav_date': records[scheme.scheme_code]['nav_date'],
                    'nav': records[scheme.scheme_code]['nav'],
                    'source': WealthMFNAVHistory.Source.AMFI,
                }
                for scheme in held_schemes
                if scheme.scheme_code in records
            ]
            for scheme in held_schemes:
                WealthMFNAVHistoryLoad.objects.get_or_create(scheme=scheme)
            with transaction.atomic():
                # Serialize AMFI and MFAPI writes per scheme so AMFI's precedence also
                # holds when both sources return the same date concurrently.
                list(
                    WealthMFNAVHistoryLoad.objects.select_for_update()
                    .filter(scheme_id__in=held_scheme_ids)
                    .order_by('scheme_id')
                    .values_list('scheme_id', flat=True)
                )
                inserted, updated = _upsert_history_rows(nav_rows)
                run.inserted_count = inserted
                run.updated_count = updated
                run.skipped_count = len(missing_codes)
                run.failed_count = len(failed_codes)
                run.status = (
                    WealthMFNAVUpdateRun.Status.PARTIAL
                    if missing_codes or failed_codes
                    else WealthMFNAVUpdateRun.Status.SUCCESS
                )
                run.completed_at = timezone.now()
                run.error_summary = (
                    f'{len(missing_codes)} held scheme(s) had no valid NAV; '
                    f'{len(failed_codes)} held scheme(s) had invalid NAV rows.'
                    if missing_codes or failed_codes else ''
                )
                run.save()
        except NAVUpdateError as exc:
            logger.warning('AMFI NAV update failed run_id=%s', run.pk, exc_info=True)
            run.status = WealthMFNAVUpdateRun.Status.FAILED
            run.completed_at = timezone.now()
            run.error_summary = str(exc)
            run.inserted_count = 0
            run.updated_count = 0
            run.failed_count = run.held_scheme_count
            run.save()
        except Exception:
            logger.exception('AMFI NAV update failed run_id=%s', run.pk)
            run.status = WealthMFNAVUpdateRun.Status.FAILED
            run.completed_at = timezone.now()
            run.error_summary = 'The AMFI NAV update failed unexpectedly. Please retry.'
            run.inserted_count = 0
            run.updated_count = 0
            run.failed_count = run.held_scheme_count
            run.save()
        return _run_payload(run)
    finally:
        try:
            if run is not None:
                with transaction.atomic():
                    lock = WealthMFNAVUpdateLock.objects.select_for_update().filter(pk=1).first()
                    if lock and lock.active_run_id == run.pk:
                        lock.active_run = None
                        lock.save(update_fields=['active_run', 'updated_at'])
        finally:
            if run is not None:
                logger.info(
                    'AMFI NAV update finished run_id=%s status=%s duration_seconds=%.3f '
                    'held_schemes=%s inserted=%s updated=%s skipped=%s failed=%s negative_folio_positions=%s',
                    run.pk,
                    run.status,
                    time.monotonic() - started_at,
                    run.held_scheme_count,
                    run.inserted_count,
                    run.updated_count,
                    run.skipped_count,
                    run.failed_count,
                    negative_position_count,
                )
            _process_update_lock.release()
