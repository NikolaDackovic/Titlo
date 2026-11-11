/** Titlo mark: a "T" over two subtitle lines (same drawing as public/favicon.svg). */
export function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="100%" height="100%">
        <path d="M9 6.5h14v3h-5.4V17h-3.2V9.5H9z" fill="currentColor" />
        <rect x="6" y="20.5" width="20" height="2.6" rx="1.3" fill="currentColor" />
        <rect x="10" y="25" width="12" height="2.6" rx="1.3" fill="currentColor" opacity=".65" />
      </svg>
    </div>
  )
}
