import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App.jsx'

describe('unknown routes', () => {
  it('show the 404 page with hungover RUdy and a link home', async () => {
    render(
      <MemoryRouter initialEntries={['/tohle-neexistuje']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Tady nic není' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'RUdy po kocovině' })).toHaveAttribute('src', expect.stringContaining('RUdy-hungover.gif'))
    expect(screen.getByRole('link', { name: 'Zpět na úvod' })).toHaveAttribute('href', '/')
  })
})
