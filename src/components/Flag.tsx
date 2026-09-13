import type { CountryCode } from '../types'

const LABEL: Record<CountryCode, string> = {
  england: 'England',
  italy: 'Italy',
}

/**
 * Small national flag shown beside a coach's NAF name. Drawn inline at a 3:2
 * ratio; a CSS hairline keeps the white fields from bleeding into the dark
 * board background.
 */
export function Flag({ country }: { country: CountryCode | null }) {
  if (!country) return null
  return (
    <svg
      className="flag"
      viewBox="0 0 15 10"
      role="img"
      aria-label={LABEL[country]}
      focusable="false"
    >
      {country === 'england' ? (
        <>
          <rect width="15" height="10" fill="#f2f2f0" />
          <rect x="6" width="3" height="10" fill="#ce1124" />
          <rect y="3.5" width="15" height="3" fill="#ce1124" />
        </>
      ) : (
        <>
          <rect width="5" height="10" fill="#008c45" />
          <rect x="5" width="5" height="10" fill="#f2f2f0" />
          <rect x="10" width="5" height="10" fill="#cd212a" />
        </>
      )}
    </svg>
  )
}
