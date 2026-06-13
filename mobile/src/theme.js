// src/theme.js — mirrors web CSS tokens exactly
export const colors = {
  bg:          '#090b14',
  bgDeep:      '#05070f',
  surface:     '#0f1221',
  surface2:    '#161929',
  surface3:    '#1c2035',
  border:      'rgba(139,120,255,0.10)',
  borderHi:    'rgba(139,120,255,0.22)',
  borderGold:  'rgba(240,180,41,0.20)',
  accent:      '#7b6ef6',
  accentDim:   'rgba(123,110,246,0.12)',
  accentGlow:  'rgba(123,110,246,0.20)',
  gold:        '#f0b429',
  goldDim:     'rgba(240,180,41,0.10)',
  text:        '#e2e0ff',
  textMuted:   '#6b6899',
  textDim:     '#352f5a',
  success:     '#3ecf8e',
  successDim:  'rgba(62,207,142,0.08)',
  danger:      '#f04b4b',
  dangerDim:   'rgba(240,75,75,0.08)',
  warning:     '#f0b429',
  warningDim:  'rgba(240,180,41,0.08)',
  energyNormal:   '#7b6ef6',
  energyReduced:  '#f0b429',
  energyMin:      '#f04b4b',
  energyRecovery: '#7f1d1d',
}

export const type = {
  anchor:    { icon: '⚓', color: '#f0b429' },
  mandatory: { icon: '⚔', color: '#f04b4b' },
  project:   { icon: '📋', color: '#7b6ef6' },
  bonus:     { icon: '⭐', color: '#3ecf8e' },
  habit:     { icon: '🔄', color: '#7b6ef6' },
  routine:   { icon: '🌿', color: '#6b6899' },
}

export const priority = {
  P0: '#f04b4b',
  P1: '#f0b429',
  P2: '#7b6ef6',
  P3: '#6b6899',
}

// Energy color based on current value
export function energyColor(current, max) {
  const pct = (current / max) * 100
  if (pct < 10) return colors.energyRecovery
  if (pct < 30) return colors.energyMin
  if (pct < 60) return colors.energyReduced
  return colors.energyNormal
}