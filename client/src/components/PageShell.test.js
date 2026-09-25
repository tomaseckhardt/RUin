import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PageShell from './PageShell.jsx'
import { getLocale, setLocale } from '../lib/i18n.js'

function renderShell() {
  return render(
    <MemoryRouter>
      <PageShell eyebrow="Section" title="Main Title" subtitle="Subtitle" />
    </MemoryRouter>,
  )
}

afterEach(() => {
  act(() => setLocale('cs'))
  document.documentElement.classList.remove('dark')
  window.localStorage.removeItem('ruin-theme')
})

describe('PageShell language switch', () => {
  it('flips between Czech and English on every click', async () => {
    const user = userEvent.setup()
    renderShell()

    const languageSwitch = screen.getByRole('switch', { name: 'English' })
    expect(languageSwitch).toHaveAttribute('aria-checked', 'false')
    expect(languageSwitch).toHaveAttribute('lang', 'en')

    await user.click(languageSwitch)

    expect(getLocale()).toBe('en')
    expect(languageSwitch).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeInTheDocument()

    await user.click(languageSwitch)

    expect(getLocale()).toBe('cs')
    expect(screen.getByRole('switch', { name: 'Tmavý režim' })).toBeInTheDocument()
  })

  it('flips even when the already active side is clicked', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByText('CZ'))

    expect(getLocale()).toBe('en')
  })
})

describe('PageShell theme switch', () => {
  it('flips between light and dark mode and remembers the choice', async () => {
    const user = userEvent.setup()
    renderShell()

    const themeSwitch = screen.getByRole('switch', { name: 'Tmavý režim' })
    expect(themeSwitch).toHaveAttribute('aria-checked', 'false')

    await user.click(themeSwitch)

    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem('ruin-theme')).toBe('dark')
    expect(themeSwitch).toHaveAttribute('aria-checked', 'true')

    await user.click(themeSwitch)

    expect(document.documentElement).not.toHaveClass('dark')
    expect(window.localStorage.getItem('ruin-theme')).toBe('light')
  })
})
