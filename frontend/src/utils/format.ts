export const formatCurrency = (value: string | number | null): string => {
  if (value === null || value === undefined) return '—'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '—'
  return '₹' + num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export const formatPercent = (value: string | number | null): string => {
  if (value === null || value === undefined) return '—'
  return `${value}%`
}

export const formatDate = (date: string | null): string => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export const isProfit = (value: string | number | null): boolean => {
  if (!value) return false
  return parseFloat(String(value)) > 0
}

export const isLoss = (value: string | number | null): boolean => {
  if (!value) return false
  return parseFloat(String(value)) < 0
}