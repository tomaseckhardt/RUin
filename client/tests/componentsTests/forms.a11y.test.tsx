import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import EventFormFields from '../../src/components/EventFormFields.jsx'
import PinUnlockFormComponent from '../../src/components/PinUnlockForm.jsx'
import { t } from '../../src/lib/i18n.js'
import { withOptionalProps } from './withOptionalProps.ts'

const PinUnlockForm = withOptionalProps(PinUnlockFormComponent)

expect.extend(toHaveNoViolations)

const EMPTY_EVENT_FORM = {
  name: '',
  location: '',
  datetime: '',
  description: '',
  requirePhone: false,
  enableBringList: true,
  enableCarpool: true,
  enableStops: true,
}

// The create form and the edit modal keep the fields' state like this.
function EventForm() {
  const [form, setForm] = useState(EMPTY_EVENT_FORM)

  return (
    <form>
      <EventFormFields form={form} onChange={(patch: Partial<typeof EMPTY_EVENT_FORM>) => setForm((current) => ({ ...current, ...patch }))} />
    </form>
  )
}

describe('EventFormFields - Accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(<EventForm />)

    expect(await axe(container)).toHaveNoViolations()
  })

  it('names every text field by its label and marks the required ones', () => {
    render(<EventForm />)

    for (const key of ['eventForm.name', 'eventForm.location', 'eventForm.description']) {
      expect(screen.getByLabelText(t(key))).toBeRequired()
    }
  })

  it('names the feature checkboxes and lets the keyboard toggle them', async () => {
    const user = userEvent.setup()
    render(<EventForm />)

    const bringList = screen.getByRole('checkbox', { name: new RegExp(t('eventForm.bringList')) })
    expect(bringList).toBeChecked()
    bringList.focus()
    await user.keyboard(' ')
    expect(bringList).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: new RegExp(t('eventForm.requirePhone')) })).not.toBeChecked()
  })

  it('reaches the name field first with Tab', async () => {
    const user = userEvent.setup()
    render(<EventForm />)

    await user.tab()
    expect(screen.getByLabelText(t('eventForm.name'))).toHaveFocus()
  })
})

describe('PinUnlockForm - Accessibility', () => {
  it('has no axe violations, alone or with Cancel', async () => {
    const { container, rerender } = render(<PinUnlockForm onSubmit={jest.fn()} isUnlocking={false} />)
    expect(await axe(container)).toHaveNoViolations()

    rerender(<PinUnlockForm onSubmit={jest.fn()} isUnlocking={false} onCancel={jest.fn()} />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('labels the PIN field, focuses it and submits the typed PIN with Enter', async () => {
    const user = userEvent.setup()
    const onSubmit = jest.fn()
    render(<PinUnlockForm onSubmit={onSubmit} isUnlocking={false} />)

    const pin = screen.getByLabelText(t('pin.label'))
    expect(pin).toHaveFocus()
    expect(pin).toBeRequired()
    expect(pin).toHaveAttribute('inputmode', 'numeric')

    await user.type(pin, '1234{Enter}')
    expect(onSubmit).toHaveBeenCalledWith('1234')
  })

  it('names the busy submit button and disables it while unlocking', () => {
    render(<PinUnlockForm onSubmit={jest.fn()} isUnlocking />)

    expect(screen.getByRole('button', { name: t('common.verifying') })).toBeDisabled()
  })
})
