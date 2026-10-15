import type { CountryCode } from '../types'

const LABEL: Record<CountryCode, string> = {
  england: 'England',
  italy: 'Italy',
  finland: 'Finland',
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
      {/* Switched on the code rather than an if/else chain: an unknown nation
          used to fall through to whichever flag was last, which would have
          flown Italy's colours over Finland at the Eurobowl. */}
      {country === 'england' && (
        <>
          <rect width="15" height="10" fill="#f2f2f0" />
          <rect x="6" width="3" height="10" fill="#ce1124" />
          <rect y="3.5" width="15" height="3" fill="#ce1124" />
        </>
      )}
      {country === 'italy' && (
        <>
          <rect width="5" height="10" fill="#008c45" />
          <rect x="5" width="5" height="10" fill="#f2f2f0" />
          <rect x="10" width="5" height="10" fill="#cd212a" />
        </>
      )}
      {country === 'finland' && (
        <>
          <rect width="15" height="10" fill="#f2f2f0" />
          <rect x="4.2" width="2.6" height="10" fill="#003580" />
          <rect y="3.7" width="15" height="2.6" fill="#003580" />
        </>
      )}
    </svg>
  )
}
