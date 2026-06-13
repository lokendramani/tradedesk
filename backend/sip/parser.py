"""
SIP CSV parser.

Expected columns (case-insensitive, stripped):
  Date, ETF, AssetClass, Ticker, Qty, Price, ExitDate, ExitPrice

Date format: DD-Mon-YY  (e.g. 02-Jan-24)
"""
import csv
import io
from datetime import datetime, date

REQUIRED_COLS = {'date', 'etf', 'assetclass', 'ticker', 'qty', 'price'}
DATE_FMT = '%d-%b-%y'


def _normalise_header(h: str) -> str:
    return h.strip().lower().replace(' ', '').replace('_', '').replace('-', '')


def _parse_date(raw: str) -> date:
    raw = raw.strip()
    for fmt in ('%d-%b-%Y', '%d-%b-%y', '%d/%m/%Y', '%d/%m/%y'):
        try:
            d = datetime.strptime(raw, fmt).date()
            # fix 2-digit century ambiguity
            current_year = datetime.now().year
            if d.year > current_year + 1:
                d = d.replace(year=d.year - 100)
            return d
        except ValueError:
            continue
    raise ValueError(f'Unrecognised date format: {raw}')


def parse_sip_csv(file_obj, user) -> tuple:
    """
    Returns (valid_rows: list[dict], errors: list[str], open_tickers: set[str]).
    valid_rows keys: trade_date, etf_name, asset_class, ticker, qty, price,
                     exit_date (date|None), exit_price (float|None)
    open_tickers: unique tickers for rows with no exit_date (used for batch CMP fetch).
    """
    from .models import SIPTrade

    try:
        content = file_obj.read()
        if isinstance(content, bytes):
            content = content.decode('utf-8-sig')  # handle BOM
        reader = csv.DictReader(io.StringIO(content))
    except Exception as e:
        return [], [f'Could not read CSV: {e}'], set()

    # normalise header keys
    if reader.fieldnames is None:
        return [], ['CSV has no header row'], set()

    header_map = {_normalise_header(h): h for h in reader.fieldnames}
    missing = REQUIRED_COLS - set(header_map.keys())
    if missing:
        return [], [f'Missing columns: {", ".join(sorted(missing))}'], set()

    # existing DB keys for dedup
    existing_keys = set(
        SIPTrade.objects.filter(user=user)
        .values_list('trade_date', 'ticker', 'qty', 'price')
    )

    valid_rows = []
    errors = []
    seen_in_batch: set = set()
    open_tickers: set = set()         # tickers for open positions — used for batch CMP fetch

    for i, raw_row in enumerate(reader, start=2):  # row 1 is header
        row = {_normalise_header(k): (v or '').strip() for k, v in raw_row.items()}

        try:
            trade_date = _parse_date(row.get('date', ''))
        except Exception:
            errors.append(f'Row {i}: invalid Date "{row.get("date", "")}"')
            continue

        etf_name    = row.get('etf', '')
        asset_class = row.get('assetclass', 'Equity')
        ticker      = row.get('ticker', '').upper()

        try:
            qty   = float(row.get('qty', ''))
            price = float(row.get('price', ''))
            if qty <= 0 or price <= 0:
                raise ValueError('must be positive')
        except Exception:
            errors.append(f'Row {i}: Qty/Price must be positive numbers')
            continue

        # CMP column is accepted without error but silently ignored —
        # live prices are fetched via yfinance batch call after import.

        exit_date_raw  = row.get('exitdate', '') or row.get('exit_date', '')
        exit_price_raw = row.get('exitprice', '') or row.get('exit_price', '')

        exit_date: date | None = None
        exit_price: float | None = None

        if exit_date_raw or exit_price_raw:
            if not (exit_date_raw and exit_price_raw):
                errors.append(f'Row {i}: ExitDate and ExitPrice must both be present or both absent')
                continue
            try:
                exit_date  = _parse_date(exit_date_raw)
                exit_price = float(exit_price_raw)
                if exit_price <= 0:
                    raise ValueError
            except Exception:
                errors.append(f'Row {i}: invalid ExitDate/ExitPrice')
                continue

        # dedup
        key = (trade_date, ticker, round(qty, 4), round(price, 4))
        if key in seen_in_batch or (trade_date, ticker, qty, price) in existing_keys:
            continue
        seen_in_batch.add(key)

        if exit_date is None:
            open_tickers.add(ticker)

        valid_rows.append({
            'trade_date': trade_date,
            'etf_name': etf_name,
            'asset_class': asset_class,
            'ticker': ticker,
            'qty': qty,
            'price': price,
            'exit_date': exit_date,
            'exit_price': exit_price,
        })

    # Normalise etf_name against ETF master so CSV abbreviations ("Pvt") match the
    # canonical name ("Private") — one batch SELECT, no per-row queries.
    if valid_rows:
        from .models import SIPETFMaster
        tickers_in_batch = {r['ticker'] for r in valid_rows}
        master_names = {
            e.ticker: e.etf_name
            for e in SIPETFMaster.objects.filter(ticker__in=tickers_in_batch)
        }
        for r in valid_rows:
            if r['ticker'] in master_names:
                r['etf_name'] = master_names[r['ticker']]

    return valid_rows, errors, open_tickers
