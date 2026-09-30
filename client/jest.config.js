import process from 'node:process'

// Tests run in a device timezone that is not Europe/Prague, so code that
// wrongly uses the viewer's local date instead of Prague's shows up. Set here,
// before Jest starts its workers, which inherit it.
process.env.TZ = 'America/Los_Angeles'

export default {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/tests/componentsTests/setup.ts'],
}
