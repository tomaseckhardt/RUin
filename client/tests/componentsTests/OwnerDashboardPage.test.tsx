import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import OwnerDashboardPage from '../../src/pages/OwnerDashboardPage.jsx'
import {
  addContactGroupMember,
  createContactGroup,
  deleteContactGroup,
  deleteEventTemplate,
  getOwnerPayload,
  removeContactGroupMember,
} from '../../src/lib/api.js'
import { t } from '../../src/lib/i18n.js'
import { getSavedOwner, saveOwnerIdentity } from '../../src/lib/ownerLinkStorage.js'

jest.mock('../../src/lib/api.js', () => ({
  accessOwnerAccount: jest.fn(),
  addContactGroupMember: jest.fn(),
  createContactGroup: jest.fn(),
  deleteContactGroup: jest.fn(),
  deleteEventTemplate: jest.fn(),
  getOwnerPayload: jest.fn(),
  removeContactGroupMember: jest.fn(),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

const PAYLOAD = {
  groups: [{ id: 7, name: 'Badminton', members: [{ id: 70, name: 'Petr', phone: '+420 777 000 001' }] }],
  templates: [{ id: 9, name: 'Páteční pivo', eventName: 'Pivo', location: 'U Fleků', requirePhone: false }],
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <OwnerDashboardPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.removeItem('ruin-owner-identity')
  jest.spyOn(window, 'confirm').mockReturnValue(true)
  jest.mocked(getOwnerPayload).mockResolvedValue(PAYLOAD)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('OwnerDashboardPage without a saved owner', () => {
  it('asks to sign in and loads nothing', () => {
    renderDashboard()

    expect(screen.getByRole('heading', { level: 1, name: t('owner.signInTitle') })).toBeInTheDocument()
    expect(getOwnerPayload).not.toHaveBeenCalled()
  })
})

describe('OwnerDashboardPage with a saved owner', () => {
  beforeEach(() => {
    saveOwnerIdentity('owner-1', 'owner-token')
  })

  it('loads the owner’s groups and templates', async () => {
    renderDashboard()

    expect(await screen.findByRole('heading', { name: 'Badminton' })).toBeInTheDocument()
    expect(screen.getByText('Páteční pivo')).toBeInTheDocument()
    expect(getOwnerPayload).toHaveBeenCalledWith('owner-1', 'owner-token')
  })

  it('creates a group, clears the field and reloads', async () => {
    const user = userEvent.setup()
    jest.mocked(createContactGroup).mockResolvedValue({ success: true })
    renderDashboard()

    const field = await screen.findByLabelText(t('owner.newGroup'))
    await user.type(field, 'Hokej')
    await user.click(screen.getByRole('button', { name: t('owner.create') }))

    expect(createContactGroup).toHaveBeenCalledWith('owner-1', 'owner-token', 'Hokej')
    await waitFor(() => expect(getOwnerPayload).toHaveBeenCalledTimes(2))
    expect(field).toHaveValue('')
  })

  it('adds a member only with both a name and a phone', async () => {
    const user = userEvent.setup()
    jest.mocked(addContactGroupMember).mockResolvedValue({ success: true })
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: /Badminton/ }))
    await user.type(screen.getByLabelText(t('common.name')), 'Jana')
    await user.click(screen.getByRole('button', { name: t('common.add') }))

    expect(toast.error).toHaveBeenCalledWith(t('owner.fillNameAndPhone'))
    expect(addContactGroupMember).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(t('common.phone')), '+420 777 000 002')
    await user.click(screen.getByRole('button', { name: t('common.add') }))

    expect(addContactGroupMember).toHaveBeenCalledWith('owner-1', 'owner-token', 7, { name: 'Jana', phone: '+420 777 000 002' })
  })

  it('deletes a group only after confirming', async () => {
    const user = userEvent.setup()
    jest.mocked(deleteContactGroup).mockResolvedValue({ success: true })
    jest.mocked(window.confirm).mockReturnValueOnce(false)
    renderDashboard()

    const deleteButton = await screen.findByRole('button', { name: t('owner.deleteGroup') })
    await user.click(deleteButton)
    expect(deleteContactGroup).not.toHaveBeenCalled()

    await user.click(deleteButton)
    expect(deleteContactGroup).toHaveBeenCalledWith('owner-1', 'owner-token', 7)
  })

  it('removes a member from a group and reloads', async () => {
    const user = userEvent.setup()
    jest.mocked(removeContactGroupMember).mockResolvedValue({ success: true })
    renderDashboard()

    await user.click(await screen.findByRole('button', { name: /Badminton/ }))
    const member = screen.getByText('Petr').closest('li') as HTMLElement
    await user.click(within(member).getByRole('button', { name: t('common.delete') }))

    expect(removeContactGroupMember).toHaveBeenCalledWith('owner-1', 'owner-token', 7, 70)
    await waitFor(() => expect(getOwnerPayload).toHaveBeenCalledTimes(2))
  })

  it('deletes a template only after confirming', async () => {
    const user = userEvent.setup()
    jest.mocked(deleteEventTemplate).mockResolvedValue({ success: true })
    jest.mocked(window.confirm).mockReturnValueOnce(false)
    renderDashboard()

    const template = (await screen.findByText('Páteční pivo')).closest('li') as HTMLElement
    const deleteButton = within(template).getByRole('button', { name: t('common.delete') })
    await user.click(deleteButton)
    expect(window.confirm).toHaveBeenCalledWith(t('owner.confirmDeleteTemplate', { name: 'Páteční pivo' }))
    expect(deleteEventTemplate).not.toHaveBeenCalled()

    await user.click(deleteButton)
    expect(deleteEventTemplate).toHaveBeenCalledWith('owner-1', 'owner-token', 9)
    expect(toast.success).toHaveBeenCalledWith(t('owner.templateDeleted'))
  })

  it('forgets a rejected token and asks to sign in again', async () => {
    jest.mocked(getOwnerPayload).mockRejectedValue(Object.assign(new Error('Invalid access token.'), { serverMessage: 'Neplatný přístupový token.' }))
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1, name: t('owner.signInTitle') })).toBeInTheDocument()
    expect(getSavedOwner()).toBeNull()
  })

  it('shows any other load failure without signing out', async () => {
    jest.mocked(getOwnerPayload).mockRejectedValue(new Error('Síť nefunguje.'))
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1, name: t('owner.loadFailedTitle') })).toBeInTheDocument()
    expect(screen.getByText('Síť nefunguje.')).toBeInTheDocument()
    expect(getSavedOwner()).toEqual({ ownerId: 'owner-1', token: 'owner-token' })
  })
})
