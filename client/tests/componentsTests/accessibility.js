import { render } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

/**
 * Accessibility test helper that renders a component and checks for violations.
 * @param {React.ReactElement} component - The component to test
 * @param {Object} options - Optional render options
 * @returns {Promise<void>}
 */
export async function testA11y(component, options = {}) {
  const { container } = render(component, options)
  const results = await axe(container)
  expect(results).toHaveNoViolations()
}
