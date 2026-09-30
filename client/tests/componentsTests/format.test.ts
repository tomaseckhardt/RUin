import { parseEventDateTime } from '../../src/lib/format.js'

// events.datetime is Prague wall-clock time; parseEventDateTime must give the
// real instant whatever the device's timezone, including around the DST
// switches (2026: 29 March 02:00 -> 03:00, 25 October 03:00 -> 02:00).
describe('parseEventDateTime (Europe/Prague)', () => {
  it.each([
    ['2026-01-15T18:30', '2026-01-15T17:30:00.000Z'],
    ['2026-07-01T18:30', '2026-07-01T16:30:00.000Z'],
    ['2026-03-29T01:30', '2026-03-29T00:30:00.000Z'],
    ['2026-03-29T03:30', '2026-03-29T01:30:00.000Z'],
    ['2026-10-25T01:30', '2026-10-24T23:30:00.000Z'],
    ['2026-10-25T04:00', '2026-10-25T03:00:00.000Z'],
    ['2026-12-31T23:59:59', '2026-12-31T22:59:59.000Z'],
  ])('%s in Prague is %s', (wallTime, instant) => {
    expect(parseEventDateTime(wallTime)?.toISOString()).toBe(instant)
  })

  it('still gives a time for 02:30 on the spring-forward day, which Prague skips', () => {
    // Moved past the gap, to 03:30 summer time.
    expect(parseEventDateTime('2026-03-29T02:30')?.toISOString()).toBe('2026-03-29T01:30:00.000Z')
  })

  it.each(['2026-02-30T10:00', '2026-13-01T10:00', '2026-01-01T24:00', 'tomorrow', ''])('rejects %p', (value) => {
    expect(parseEventDateTime(value)).toBeNull()
  })
})
