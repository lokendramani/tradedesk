"""
yfinance-backed price fetcher with SIPPriceCache as a write-through cache.

Ticker conventions:
  - NSE equities: append ".NS"  e.g. "GOLDBEES" → "GOLDBEES.NS"
  - Nifty 50 index:   "^NSEI"
  - Nifty 500 index:  "^CRSLDX"

Performance note:
  Use bulk_prefetch_history(tickers, start, end) before any loop that calls
  get_historical_friday_close repeatedly — it populates the cache in O(N tickers)
  HTTP calls instead of O(N tickers × M weeks).
"""
import logging
from datetime import date, timedelta
from decimal import Decimal

import yfinance as yf

from .models import SIPPriceCache

logger = logging.getLogger(__name__)

EQUITY_SUFFIX = '.NS'
BENCHMARK_TICKERS = {'^NSEI', '^CRSLDX'}


def _yf_ticker(ticker: str) -> str:
    if ticker in BENCHMARK_TICKERS or ticker.startswith('^'):
        return ticker
    if ticker.endswith(EQUITY_SUFFIX):
        return ticker
    return ticker + EQUITY_SUFFIX


def _cache_get(ticker: str, price_date: date):
    try:
        return SIPPriceCache.objects.get(ticker=ticker, price_date=price_date)
    except SIPPriceCache.DoesNotExist:
        return None


def _cache_set(ticker: str, price_date: date, price: float, is_stale: bool = False) -> None:
    SIPPriceCache.objects.update_or_create(
        ticker=ticker,
        price_date=price_date,
        defaults={'close_price': Decimal(str(round(price, 4))), 'is_stale': is_stale},
    )


def _flatten_close(close_df_or_series, yf_sym: str | None = None):
    """Safely extract a 1-D price Series from yfinance's MultiIndex or plain output."""
    if hasattr(close_df_or_series, 'columns'):
        # MultiIndex DataFrame — pick by yf_sym if given, else first column
        if yf_sym and yf_sym in close_df_or_series.columns:
            return close_df_or_series[yf_sym]
        return close_df_or_series.iloc[:, 0]
    return close_df_or_series


# ─── Bulk historical prefetch ──────────────────────────────────────────────────

def bulk_prefetch_history(tickers: list, start: date, end: date) -> None:
    """
    One yfinance download per ticker (or one multi-ticker download) covering the
    full date range.  Populates SIPPriceCache for every trading day in the range.
    Call this before the week-by-week loop so all get_historical_friday_close
    calls are pure cache hits.
    """
    if not tickers:
        return

    yf_syms = [_yf_ticker(t) for t in tickers]
    # extend end by 1 day so yfinance includes the end date
    end_ext = end + timedelta(days=1)

    try:
        hist = yf.download(
            yf_syms,
            start=start.isoformat(),
            end=end_ext.isoformat(),
            auto_adjust=True,
            progress=False,
        )
        if hist.empty:
            logger.warning('bulk_prefetch_history: empty result for %s', tickers)
            return

        hist.index = hist.index.date  # type: ignore[assignment]
        raw_close = hist['Close'] if 'Close' in hist.columns else hist

        bulk: list = []
        existing_keys = set(
            SIPPriceCache.objects.filter(
                ticker__in=tickers,
                price_date__gte=start,
                price_date__lte=end,
            ).values_list('ticker', 'price_date')
        )

        for ticker, yf_sym in zip(tickers, yf_syms):
            series = _flatten_close(raw_close, yf_sym if len(yf_syms) > 1 else None)
            series = series.dropna()
            for price_date, price in series.items():
                if (ticker, price_date) not in existing_keys:
                    bulk.append(SIPPriceCache(
                        ticker=ticker,
                        price_date=price_date,
                        close_price=Decimal(str(round(float(price), 4))),
                        is_stale=False,
                    ))

        if bulk:
            SIPPriceCache.objects.bulk_create(bulk, ignore_conflicts=True)

    except Exception as e:
        logger.warning('bulk_prefetch_history failed for %s: %s', tickers, e)


# ─── Current price (today's CMP) ──────────────────────────────────────────────

def get_current_price(ticker: str) -> tuple:
    """Returns (price: Decimal | None, is_stale: bool)."""
    today = date.today()
    cached = _cache_get(ticker, today)
    if cached and not cached.is_stale:
        return cached.close_price, cached.is_stale

    try:
        t = yf.Ticker(_yf_ticker(ticker))
        hist = t.history(period='5d', auto_adjust=True)
        if hist.empty:
            raise ValueError('empty history')
        price = float(hist['Close'].iloc[-1])
        _cache_set(ticker, today, price, is_stale=False)
        return Decimal(str(round(price, 4))), False
    except Exception as e:
        logger.warning('get_current_price %s failed: %s', ticker, e)
        last = (
            SIPPriceCache.objects.filter(ticker=ticker)
            .order_by('-price_date')
            .first()
        )
        if last:
            return last.close_price, True
        return None, True


# ─── Historical Friday close (cache-first) ────────────────────────────────────

def get_historical_friday_close(ticker: str, target_date: date) -> tuple:
    """
    Returns the closing price on or just before target_date.
    Checks SIPPriceCache first — fast path after bulk_prefetch_history has run.
    Falls back to a narrow yfinance window only if cache misses.
    Returns (price: Decimal | None, is_stale: bool).
    """
    friday = target_date - timedelta(days=(target_date.weekday() - 4) % 7)

    # fast path: exact cache hit on the friday
    cached = _cache_get(ticker, friday)
    if cached:
        return cached.close_price, cached.is_stale

    # second fast path: any cached date on or before friday
    near = (
        SIPPriceCache.objects.filter(ticker=ticker, price_date__lte=friday)
        .order_by('-price_date')
        .first()
    )
    # if cached entry is within 5 trading days, use it
    if near and (friday - near.price_date).days <= 7:
        return near.close_price, near.is_stale

    # slow path: narrow yfinance fetch
    try:
        yf_sym = _yf_ticker(ticker)
        start  = friday - timedelta(days=5)
        end    = friday + timedelta(days=2)
        hist   = yf.download(yf_sym, start=start.isoformat(), end=end.isoformat(),
                             auto_adjust=True, progress=False)
        if hist.empty:
            raise ValueError('empty history')

        hist.index = hist.index.date  # type: ignore[assignment]
        valid = hist[hist.index <= friday]
        if valid.empty:
            raise ValueError('no data on or before friday')

        close_series = _flatten_close(valid['Close'] if 'Close' in valid.columns else valid)
        price = float(close_series.iloc[-1])
        actual_date = valid.index[-1]
        _cache_set(ticker, actual_date, price, is_stale=False)
        if actual_date != friday:
            _cache_set(ticker, friday, price, is_stale=False)
        return Decimal(str(round(price, 4))), False
    except Exception as e:
        logger.warning('get_historical_friday_close %s %s failed: %s', ticker, target_date, e)
        if near:
            return near.close_price, True
        return None, True


# ─── Batch current prices ─────────────────────────────────────────────────────

def batch_fetch_current(tickers: list) -> dict:
    """
    Returns {ticker: (price: Decimal | None, is_stale: bool)} for all tickers.
    Uses a single yfinance download for efficiency.
    """
    today = date.today()
    result: dict = {}
    missing = []

    for ticker in tickers:
        cached = _cache_get(ticker, today)
        if cached and not cached.is_stale:
            result[ticker] = (cached.close_price, cached.is_stale)
        else:
            missing.append(ticker)

    if not missing:
        return result

    try:
        yf_syms = [_yf_ticker(t) for t in missing]
        hist = yf.download(yf_syms, period='5d', auto_adjust=True, progress=False)
        raw_close = hist['Close'] if 'Close' in hist.columns else hist

        for ticker, yf_sym in zip(missing, yf_syms):
            try:
                series = _flatten_close(raw_close, yf_sym if len(yf_syms) > 1 else None)
                price = float(series.dropna().iloc[-1])
                _cache_set(ticker, today, price, is_stale=False)
                result[ticker] = (Decimal(str(round(price, 4))), False)
            except Exception as e:
                logger.warning('batch_fetch_current %s parse failed: %s', ticker, e)
                result[ticker] = _fallback(ticker)
    except Exception as e:
        logger.warning('batch_fetch_current bulk download failed: %s', e)
        for ticker in missing:
            result[ticker] = _fallback(ticker)

    return result


def _fallback(ticker: str) -> tuple:
    last = (
        SIPPriceCache.objects.filter(ticker=ticker)
        .order_by('-price_date')
        .first()
    )
    if last:
        return last.close_price, True
    return None, True
