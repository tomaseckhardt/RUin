import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.js'
import { fetchEventWeather } from '../lib/weather.js'

function WeatherWidget({ location, datetime, compact = false }) {
  const [weather, setWeather] = useState(null)
  const { locale, t } = useI18n()

  useEffect(() => {
    let cancelled = false

    fetchEventWeather(location, datetime, locale)
      .then((result) => {
        if (!cancelled) {
          setWeather(result)
        }
      })
      .catch((error) => {
        console.warn('[weather] widget failed to load forecast', error)

        if (!cancelled) {
          setWeather(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [location, datetime, locale])

  if (!weather) {
    return null
  }

  const label = t(`weather.conditions.${weather.condition}`)

  if (compact) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium"
        style={{ borderColor: 'var(--hero-ring)', color: 'var(--header-text)' }}
        title={`${label} · ${weather.locationName}`}
      >
        <span className="text-base leading-none">{weather.icon}</span>
        <span>{weather.tempMin}° / {weather.tempMax}°C</span>
      </span>
    )
  }

  return (
    <div className="stat-tile flex items-center gap-3">
      <span className="text-3xl leading-none">{weather.icon}</span>
      <div>
        <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">{t('weather.title')}</div>
        <div className="mt-1 text-lg font-black tracking-[-0.02em] text-slate-950 dark:text-slate-50">
          {weather.tempMin}° / {weather.tempMax}°C
        </div>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{label} · {weather.locationName}</p>
      </div>
    </div>
  )
}

export default WeatherWidget
