import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe, toHaveNoViolations } from 'jest-axe'
import PageShell from '../components/PageShell.jsx'

expect.extend(toHaveNoViolations)

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('PageShell - Accessibility', () => {
  it('should have proper heading hierarchy', async () => {
    const { container } = renderWithRouter(
      <PageShell eyebrow="Section" title="Main Title" subtitle="Subtitle">
        <p>Content</p>
      </PageShell>
    )

    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('should have correct heading hierarchy', () => {
    renderWithRouter(
      <PageShell eyebrow="Section" title="Main Title" subtitle="Subtitle">
        <p>Content</p>
      </PageShell>
    )

    const h1 = screen.getByRole('heading', { level: 1, name: 'Main Title' })
    expect(h1).toBeInTheDocument()
  })

  it('should have accessible page structure', () => {
    const { container } = renderWithRouter(
      <PageShell eyebrow="Section" title="Main Title" subtitle="Subtitle">
        <p>Content goes here</p>
      </PageShell>
    )

    // Should have main landmark
    const main = container.querySelector('main')
    expect(main).toBeInTheDocument()
  })

  it('should have descriptive eyebrow text', () => {
    renderWithRouter(
      <PageShell eyebrow="Important Section" title="Title" subtitle="Subtitle">
        <p>Content</p>
      </PageShell>
    )

    const eyebrow = screen.getByText('Important Section')
    expect(eyebrow).toBeInTheDocument()
  })
})
