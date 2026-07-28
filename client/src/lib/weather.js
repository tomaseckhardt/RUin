import { parseLocalDateTime } from './format.js'

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const MAX_FORECAST_DAYS = 16

const WEATHER_CODE_INFO = {
  0: { label: 'Jasno', icon: '☀️' },
  1: { label: 'Skoro jasno', icon: '🌤️' },
  2: { label: 'Polojasno', icon: '⛅' },
  3: { label: 'Zataženo', icon: '☁️' },
  45: { label: 'Mlha', icon: '🌫️' },
  48: { label: 'Mlha s jinovatkou', icon: '🌫️' },
  51: { label: 'Slabé mrholení', icon: '🌦️' },
  53: { label: 'Mrholení', icon: '🌦️' },
  55: { label: 'Vydatné mrholení', icon: '🌦️' },
  56: { label: 'Mrznoucí mrholení', icon: '🌧️' },
  57: { label: 'Mrznoucí mrholení', icon: '🌧️' },
  61: { label: 'Slabý déšť', icon: '🌧️' },
  63: { label: 'Déšť', icon: '🌧️' },
  65: { label: 'Vydatný déšť', icon: '🌧️' },
  66: { label: 'Mrznoucí déšť', icon: '🌧️' },
  67: { label: 'Mrznoucí déšť', icon: '🌧️' },
  71: { label: 'Slabé sněžení', icon: '🌨️' },
  73: { label: 'Sněžení', icon: '🌨️' },
  75: { label: 'Vydatné sněžení', icon: '🌨️' },
  77: { label: 'Sněhové zrno', icon: '🌨️' },
  80: { label: 'Přeháňky', icon: '🌦️' },
  81: { label: 'Přeháňky', icon: '🌦️' },
  82: { label: 'Silné přeháňky', icon: '🌧️' },
  85: { label: 'Sněhové přeháňky', icon: '🌨️' },
  86: { label: 'Sněhové přeháňky', icon: '🌨️' },
  95: { label: 'Bouřky', icon: '⛈️' },
  96: { label: 'Bouřky s kroupami', icon: '⛈️' },
  99: { label: 'Bouřky s kroupami', icon: '⛈️' },
}

function describeWeatherCode(code) {
  return WEATHER_CODE_INFO[code] || { label: 'Počasí', icon: '🌡️' }
}

function buildGeocodeCandidates(location) {
  const firstSegment = location.split(',')[0]?.trim()
  const withoutDistrictNumber = firstSegment?.replace(/\s+\d+\s*$/, '').trim()

  return [...new Set([location, firstSegment, withoutDistrictNumber].filter(Boolean))]
}

async function geocodeLocation(location) {
  const candidates = buildGeocodeCandidates(location)

  for (const query of candidates) {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=1&language=cs&format=json`

    try {
      const response = await fetch(url)

      if (!response.ok) {
        console.warn(`[weather] geocoding "${query}" failed with HTTP ${response.status}`)
        continue
      }

      const data = await response.json()
      const match = data?.results?.[0]

      if (match) {
        return { latitude: match.latitude, longitude: match.longitude, name: match.name }
      }

      console.warn(`[weather] geocoding "${query}" returned no results`)
    } catch (fetchError) {
      console.warn(`[weather] geocoding "${query}" threw`, fetchError)
    }
  }

  return null
}

export async function fetchEventWeather(location, datetimeString) {
  if (!location || !datetimeString) {
    return null
  }

  const eventDate = parseLocalDateTime(datetimeString)

  if (!eventDate) {
    return null
  }

  const eventDayStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate()).getTime()
  const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()
  const daysUntilEvent = Math.round((eventDayStart - todayStart) / 86400000)

  if (daysUntilEvent < 0 || daysUntilEvent >= MAX_FORECAST_DAYS) {
    return null
  }

  const place = await geocodeLocation(location)

  if (!place) {
    console.warn(`[weather] could not geocode location "${location}"`)
    return null
  }

  const forecastUrl = `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${MAX_FORECAST_DAYS}`
  let response

  try {
    response = await fetch(forecastUrl)
  } catch (fetchError) {
    console.warn('[weather] forecast fetch threw', fetchError)
    return null
  }

  if (!response.ok) {
    console.warn(`[weather] forecast fetch failed with HTTP ${response.status}`)
    return null
  }

  const data = await response.json()
  const targetDateKey = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`
  const dayIndex = data?.daily?.time?.indexOf(targetDateKey)

  if (dayIndex === undefined || dayIndex < 0) {
    console.warn(`[weather] target date ${targetDateKey} not found in forecast response`, data?.daily?.time)
    return null
  }

  const code = data.daily.weathercode[dayIndex]
  const { label, icon } = describeWeatherCode(code)

  return {
    label,
    icon,
    tempMax: Math.round(data.daily.temperature_2m_max[dayIndex]),
    tempMin: Math.round(data.daily.temperature_2m_min[dayIndex]),
    locationName: place.name,
  }
}
