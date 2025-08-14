/**
 * Format number with thousand separators and fixed decimals, Latin digits
 * @param {number} value
 * @param {number} fractionDigits
 * @returns {string}
 */
export function formatNumber(value, fractionDigits = 2) {
  const n = Number(value ?? 0);
  const str = n.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return str;
}

// Backwards compatibility alias
export const formatNumberFa = formatNumber;

export function withUnit(value, unit) {
  return `${formatNumber(value)} ${unit}`;
}


