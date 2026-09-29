import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installEnterToSubmit } from '../../src/lib/enterToSubmit.js'

function MessageForm({ onSend, isSending = false, withTextarea = true }) {
  const [message, setMessage] = useState('')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSend(message)
      }}>
      {withTextarea ? <textarea aria-label="Zpráva" value={message} onChange={(event) => setMessage(event.target.value)} /> : null}
      <button type="button">Jiná akce</button>
      <button type="submit" disabled={isSending || !message.trim()}>
        Odeslat
      </button>
    </form>
  )
}

let uninstall

beforeEach(() => {
  uninstall = installEnterToSubmit()
})

afterEach(() => {
  uninstall()
})

describe('Enter in a multi-line field', () => {
  it('sends the form instead of starting a new line', async () => {
    const user = userEvent.setup()
    const onSend = jest.fn()
    render(<MessageForm onSend={onSend} />)

    await user.type(screen.getByLabelText('Zpráva'), 'Ahoj{Enter}')

    expect(onSend).toHaveBeenCalledWith('Ahoj')
    expect(screen.getByLabelText('Zpráva')).toHaveValue('Ahoj')
  })

  it('starts a new line with Shift+Enter', async () => {
    const user = userEvent.setup()
    const onSend = jest.fn()
    render(<MessageForm onSend={onSend} />)

    await user.type(screen.getByLabelText('Zpráva'), 'Ahoj{Shift>}{Enter}{/Shift}světe')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Zpráva')).toHaveValue('Ahoj\nsvěte')
  })

  it('does nothing while the submit button is disabled', async () => {
    const user = userEvent.setup()
    const onSend = jest.fn()
    render(<MessageForm onSend={onSend} isSending />)

    await user.type(screen.getByLabelText('Zpráva'), 'Ahoj{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Zpráva')).toHaveValue('Ahoj')
  })

  it('leaves an Enter that finishes an IME composition alone', () => {
    const onSend = jest.fn()
    render(<MessageForm onSend={onSend} />)
    const field = screen.getByLabelText('Zpráva')
    fireEvent.change(field, { target: { value: 'にほん' } })

    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('leaves a field that handled Enter itself alone', () => {
    const onSend = jest.fn()
    render(<MessageForm onSend={onSend} />)
    const field = screen.getByLabelText('Zpráva')
    fireEvent.change(field, { target: { value: 'Ahoj' } })
    field.addEventListener('keydown', (event) => event.preventDefault())

    fireEvent.keyDown(field, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('tells phone keyboards that Enter sends', () => {
    render(<MessageForm onSend={jest.fn()} />)
    const field = screen.getByLabelText('Zpráva')

    fireEvent.focusIn(field)

    expect(field).toHaveAttribute('enterkeyhint', 'send')
  })

  it('keeps Enter as a new line in a textarea outside any form', async () => {
    const user = userEvent.setup()
    render(<textarea aria-label="Poznámka" />)

    await user.type(screen.getByLabelText('Poznámka'), 'a{Enter}b')

    expect(screen.getByLabelText('Poznámka')).toHaveValue('a\nb')
  })
})
