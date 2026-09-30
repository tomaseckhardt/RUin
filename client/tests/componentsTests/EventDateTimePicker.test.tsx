import { fireEvent, render, screen } from '@testing-library/react'
import EventDateTimePicker from '../../src/components/EventDateTimePicker.jsx'
import { getEventTimeZoneNow, toDateTimeLocalValue } from '../../src/lib/format.js'

// A viewer in Los Angeles (jest.config.js sets TZ) at 16:30 on 1 June, when it
// is already 01:30 on 2 June in Prague: the picker must offer Prague's today.
beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-06-01T23:30:00Z') })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('EventDateTimePicker in Europe/Prague', () => {
  it('runs in a non-Prague device timezone', () => {
    expect(new Date().getDate()).toBe(1)
  })

  it('getEventTimeZoneNow gives the Prague wall-clock time', () => {
    expect(toDateTimeLocalValue(getEventTimeZoneNow())).toBe('2026-06-02T01:30')
  })

  it('marks Prague today, disables the day before and presets Prague dates', () => {
    const onChange = jest.fn()
    render(<EventDateTimePicker value="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vyber datum' }))

    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'date')

    fireEvent.click(screen.getByRole('button', { name: 'Dnes 18:00' }))
    expect(onChange).toHaveBeenCalledWith('2026-06-02T18:00')
  })
})
