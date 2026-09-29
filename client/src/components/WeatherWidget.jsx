import { useEffect, useState } from 'react'
import { useI18n } from '../lib/i18n.js'
import { fetchEventWeather } from '../lib/weather.js'

function WeatherWidget({ location, datetime }) {
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

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium"
      style={{ borderColor: 'var(--hero-ring)', color: 'var(--header-text)' }}
      title={`${label} · ${weather.locationName}`}>
      <span className="text-base leading-none">{weather.icon}</span>
      <span>
        {weather.tempMin}° / {weather.tempMax}°C
      </span>
    </span>
  )
}

export default WeatherWidget
