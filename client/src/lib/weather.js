import { parseLocalDateTime } from './format.js'

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const MAX_FORECAST_DAYS = 16

const WEATHER_CODE_INFO = {
  0: { condition: 'clear', icon: '☀️' },
  1: { condition: 'mostlyClear', icon: '🌤️' },
  2: { condition: 'partlyCloudy', icon: '⛅' },
  3: { condition: 'overcast', icon: '☁️' },
  45: { condition: 'fog', icon: '🌫️' },
  48: { condition: 'rimeFog', icon: '🌫️' },
  51: { condition: 'lightDrizzle', icon: '🌦️' },
  53: { condition: 'drizzle', icon: '🌦️' },
  55: { condition: 'heavyDrizzle', icon: '🌦️' },
  56: { condition: 'freezingDrizzle', icon: '🌧️' },
  57: { condition: 'freezingDrizzle', icon: '🌧️' },
  61: { condition: 'lightRain', icon: '🌧️' },
  63: { condition: 'rain', icon: '🌧️' },
  65: { condition: 'heavyRain', icon: '🌧️' },
  66: { condition: 'freezingRain', icon: '🌧️' },
  67: { condition: 'freezingRain', icon: '🌧️' },
  71: { condition: 'lightSnow', icon: '🌨️' },
  73: { condition: 'snow', icon: '🌨️' },
  75: { condition: 'heavySnow', icon: '🌨️' },
  77: { condition: 'snowGrains', icon: '🌨️' },
  80: { condition: 'showers', icon: '🌦️' },
  81: { condition: 'showers', icon: '🌦️' },
  82: { condition: 'heavyShowers', icon: '🌧️' },
  85: { condition: 'snowShowers', icon: '🌨️' },
  86: { condition: 'snowShowers', icon: '🌨️' },
  95: { condition: 'thunderstorm', icon: '⛈️' },
  96: { condition: 'thunderstormHail', icon: '⛈️' },
  99: { condition: 'thunderstormHail', icon: '⛈️' },
}

function describeWeatherCode(code) {
  return WEATHER_CODE_INFO[code] || { condition: 'unknown', icon: '🌡️' }
}

function buildGeocodeCandidates(location) {
  const firstSegment = location.split(',')[0]?.trim()
  const withoutDistrictNumber = firstSegment?.replace(/\s+\d+\s*$/, '').trim()

  return [...new Set([location, firstSegment, withoutDistrictNumber].filter(Boolean))]
}

async function geocodeLocation(location, language) {
  const candidates = buildGeocodeCandidates(location)

  for (const query of candidates) {
    const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=1&language=${language}&format=json`

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

// `condition` is a key under weather.conditions in the locale dictionaries;
// `language` (an app locale code) only picks the language of the returned
// place name.
export async function fetchEventWeather(location, datetimeString, language) {
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

  const place = await geocodeLocation(location, language)

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
  const { condition, icon } = describeWeatherCode(code)

  return {
    condition,
    icon,
    tempMax: Math.round(data.daily.temperature_2m_max[dayIndex]),
    tempMin: Math.round(data.daily.temperature_2m_min[dayIndex]),
    locationName: place.name,
  }
}
