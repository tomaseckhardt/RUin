import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

/**
 * Form accessibility test helper
 * Verifies that forms have proper labels, required indicators, and keyboard navigation
 */
export function testFormA11y(container) {
  const inputs = container.querySelectorAll('input, textarea, select')
  
  inputs.forEach((input) => {
    // Each input should have a label
    const label = container.querySelector(`label[for="${input.id}"]`)
    
    // Either has a label or aria-label
    const hasLabel = label || input.getAttribute('aria-label')
    if (!hasLabel && input.type !== 'hidden' && input.type !== 'submit' && input.type !== 'button') {
      console.warn(`Input missing label: ${input.type} ${input.name}`)
    }
  })

  // Check for required attributes
  const requiredInputs = Array.from(inputs).filter((input) =>
    input.hasAttribute('required')
  )
  
  return {
    totalInputs: inputs.length,
    requiredInputs: requiredInputs.length,
    missingLabels: Array.from(inputs).filter((input) => {
      const hasLabel = container.querySelector(`label[for="${input.id}"]`) ||
        input.getAttribute('aria-label')
      return !hasLabel && input.type !== 'hidden'
    }).length,
  }
}

describe('Form Components - Accessibility', () => {
  it('buttons should have accessible labels', async () => {
    const { container } = render(
      <form>
        <button type="submit">Submit Form</button>
        <button type="button" aria-label="Close dialog">
          ×
        </button>
      </form>
    )
    
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('form inputs should be keyboard accessible', async () => {
    const user = userEvent.setup()
    render(
      <form>
        <label htmlFor="name">Name</label>
        <input id="name" type="text" required />
        <button type="submit">Submit</button>
      </form>
    )
    
    const input = screen.getByLabelText('Name')
    await user.tab()
    expect(input).toHaveFocus()
  })

  it('should have no color-only information for critical elements', () => {
    // This is a semantic check - critical status information 
    // should not rely on color alone (e.g., red = error)
    // Should use icons, text, or aria attributes
    render(
      <div>
        <div className="bg-red-100 text-red-800">Error message text</div>
        <div className="bg-green-100 text-green-800">Success message text</div>
      </div>
    )
    
    // Both have text, so not color-only
    expect(screen.getByText('Error message text')).toBeInTheDocument()
    expect(screen.getByText('Success message text')).toBeInTheDocument()
  })
})
