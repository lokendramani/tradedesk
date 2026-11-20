import type { MutualFundScheme } from '../api/schemeCatalogue'

function displayVariantField(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.toUpperCase() === 'UNKNOWN') return ''
  if (normalized.toUpperCase() === 'IDCW') return 'IDCW'
  return normalized.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatSchemePlanOption(
  planType: string | null | undefined,
  optionType: string | null | undefined,
): string {
  const plan = displayVariantField(planType)
  const option = displayVariantField(optionType)
  return [plan, option].filter(Boolean).join(' · ') || 'Plan/option unavailable'
}

export function getSchemePickerDisplay(scheme: MutualFundScheme) {
  return {
    schemeName: scheme.scheme_name,
    planOption: formatSchemePlanOption(scheme.plan_type, scheme.option_type),
    schemeCode: scheme.scheme_code,
  }
}
