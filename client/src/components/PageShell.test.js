import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PageShell from './PageShell.jsx'
import { getLocale, setLocale } from '../lib/i18n.js'

afterEach(() => {
  act(() => setLocale('cs'))
})

describe('PageShell language toggle', () => {
  it('switches the UI to English and back', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <PageShell eyebrow="Section" title="Main Title" subtitle="Subtitle" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Tmavý režim' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'English' }))

    expect(getLocale()).toBe('en')
    expect(screen.getByRole('button', { name: 'Dark mode' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Čeština' }))

    expect(getLocale()).toBe('cs')
    expect(screen.getByRole('button', { name: 'Tmavý režim' })).toBeInTheDocument()
  })

  it('labels the toggle in the language it switches to', () => {
    render(
      <MemoryRouter>
        <PageShell eyebrow="Section" title="Main Title" subtitle="Subtitle" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('lang', 'en')
  })
})
