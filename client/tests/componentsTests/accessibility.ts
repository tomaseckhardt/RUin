import type { ReactElement } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

// Renders the element and fails the test on any axe violation.
export async function testA11y(component: ReactElement, options: RenderOptions = {}): Promise<void> {
  const { container } = render(component, options)
  const results = await axe(container)
  expect(results).toHaveNoViolations()
}
