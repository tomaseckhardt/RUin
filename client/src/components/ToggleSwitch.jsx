// Two-option pill switch for the page header (language, theme): a click
// anywhere on it flips to the other option, and a highlight slides under the
// active one. Styled for the header's dark background. `label` names the
// switch for assistive tech and describes its "on" state - the second option.
// Options: [{ value, content, lang? }, { value, content, lang? }].
function ToggleSwitch({ label, title, lang, options, value, onChange }) {
  const [first, second] = options
  const isSecondActive = value === second.value

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isSecondActive}
      aria-label={label}
      title={title}
      lang={lang}
      onClick={() => onChange(isSecondActive ? first.value : second.value)}
      className="group relative inline-flex cursor-pointer items-center rounded-full border p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-soft)]"
      style={{ borderColor: 'var(--hero-ring)', background: 'rgba(255, 255, 255, 0.06)' }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full transition-transform duration-300 motion-reduce:transition-none"
        style={{
          transform: isSecondActive ? 'translateX(100%)' : 'translateX(0)',
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
          // The app's brand violet (theme-color); white on it is ~5:1.
          background: '#6f4cff',
          boxShadow: '0 4px 12px -4px rgba(111, 76, 255, 0.6)',
        }}
      />
      {options.map((option) => (
        <span
          key={option.value}
          aria-hidden="true"
          lang={option.lang}
          className={`relative inline-flex h-7 w-10 items-center justify-center text-xs font-semibold tracking-[0.14em] transition-colors duration-200 ${
            option.value === value ? 'text-white' : 'text-white/55 group-hover:text-white/90'
          }`}
        >
          {option.content}
        </span>
      ))}
    </button>
  )
}

export default ToggleSwitch
