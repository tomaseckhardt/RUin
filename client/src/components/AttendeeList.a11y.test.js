import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import AttendeeList from '../components/AttendeeList.jsx'

expect.extend(toHaveNoViolations)

describe('AttendeeList - Accessibility', () => {
  const mockAttendees = [
    {
      id: 1,
      name: 'Alice',
      status: 'confirmed',
      excuse_reason: null,
      ping_count: 0,
      phone: null,
    },
    {
      id: 2,
      name: 'Bob',
      status: 'excused',
      excuse_reason: 'Busy',
      ping_count: 1,
      phone: null,
    },
    {
      id: 3,
      name: 'Charlie',
      status: 'excused_rejected',
      excuse_reason: null,
      ping_count: 0,
      phone: null,
    },
  ]

  const mockSummary = {
    confirmed: 1,
    excused: 1,
    rejected: 1,
  }

  it('should not have accessibility violations', async () => {
    const { container } = render(
      <AttendeeList attendees={mockAttendees} summary={mockSummary} />
    )
    
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('should have a descriptive title', () => {
    render(
      <AttendeeList attendees={mockAttendees} summary={mockSummary} />
    )
    
    const title = screen.getByText('Guest roster')
    expect(title).toBeInTheDocument()
  })

  it('should list attendees with their names', () => {
    render(
      <AttendeeList attendees={mockAttendees} summary={mockSummary} />
    )
    
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/Bob/)).toBeInTheDocument()
    expect(screen.getByText(/Charlie/)).toBeInTheDocument()
  })

  it('should display attendee status information', () => {
    render(
      <AttendeeList attendees={mockAttendees} summary={mockSummary} />
    )
    
    // Status chips should be visible with text
    const chipTexts = screen.getAllByText(/✅|⏳|⚪/)
    expect(chipTexts.length).toBeGreaterThan(0)
  })

  it('should have proper summary statistics', () => {
    render(
      <AttendeeList attendees={mockAttendees} summary={mockSummary} />
    )
    
    expect(screen.getByText('1 přijde · 1 se omluvili')).toBeInTheDocument()
    expect(screen.getByText(/omluvenk/)).toBeInTheDocument()
  })

  it('should have accessible buttons for interactions', () => {
    const mockOnPing = jest.fn()
    const { container } = render(
      <AttendeeList
        attendees={mockAttendees}
        summary={mockSummary}
        showPing
        onPing={mockOnPing}
        pingBusyId={null}
        currentName="Alice"
        canPing={true}
      />
    )
    
    const buttons = container.querySelectorAll('button')
    buttons.forEach((button) => {
      // Buttons should have either text content or aria-label
      expect(
        button.textContent.trim() || button.getAttribute('aria-label')
      ).toBeTruthy()
    })
  })
})
