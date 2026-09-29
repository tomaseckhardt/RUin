import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhotoGallery from '../components/PhotoGallery.jsx'
import { deleteEventPhoto, deleteOwnEventPhoto, getEventPhotos, recordEventPhoto, uploadEventPhoto } from '../lib/api.js'
import { getPhotoDeleteToken, savePhotoDeleteToken } from '../lib/photoDeleteTokens.js'

jest.mock('../lib/api.js', () => ({
  deleteEventPhoto: jest.fn(),
  deleteOwnEventPhoto: jest.fn(),
  getEventPhotoUrl: jest.fn((path) => `https://photos.example/${path}`),
  getEventPhotos: jest.fn(),
  recordEventPhoto: jest.fn(),
  uploadEventPhoto: jest.fn(),
}))

const PHOTOS = [
  { id: 1, storage_path: 'event-1/mine.jpg', uploaded_by: 'Alice', created_at: '2026-01-02T00:00:00Z' },
  { id: 2, storage_path: 'event-1/theirs.jpg', uploaded_by: 'Bob', created_at: '2026-01-01T00:00:00Z' },
]

const THREE_PHOTOS = [...PHOTOS, { id: 3, storage_path: 'event-1/third.jpg', uploaded_by: 'Cyril', created_at: '2025-12-31T00:00:00Z' }]

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.removeItem('ruin-photo-delete-tokens')
  getEventPhotos.mockResolvedValue(PHOTOS)
  deleteEventPhoto.mockResolvedValue({ success: true })
  deleteOwnEventPhoto.mockResolvedValue({ success: true })
  jest.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  window.confirm.mockRestore()
})

describe('PhotoGallery delete permissions', () => {
  it('shows a guest the delete button only on the photo they uploaded from this browser', async () => {
    savePhotoDeleteToken('event-1/mine.jpg', 'delete-token-1')

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)

    await screen.findByAltText('Fotka od Alice')
    expect(screen.getAllByRole('button', { name: 'Smazat' })).toHaveLength(1)
  })

  it('deletes a guest’s own photo with its delete token and forgets the token', async () => {
    const user = userEvent.setup()
    savePhotoDeleteToken('event-1/mine.jpg', 'delete-token-1')

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)
    await user.click(await screen.findByRole('button', { name: 'Smazat' }))

    await waitFor(() => {
      expect(deleteOwnEventPhoto).toHaveBeenCalledWith('event-1', 1, 'delete-token-1')
    })
    expect(deleteEventPhoto).not.toHaveBeenCalled()
    expect(getPhotoDeleteToken('event-1/mine.jpg')).toBe('')
  })

  it('lets the organizer delete any photo with the organizer token', async () => {
    const user = userEvent.setup()

    render(<PhotoGallery eventId="event-1" currentName="Organizátor" isOrganizer organizerToken="organizer-token" />)

    await screen.findByAltText('Fotka od Bob')
    const deleteButtons = screen.getAllByRole('button', { name: 'Smazat' })
    expect(deleteButtons).toHaveLength(2)

    await user.click(deleteButtons[1])

    await waitFor(() => {
      expect(deleteEventPhoto).toHaveBeenCalledWith('event-1', 'organizer-token', 2)
    })
    expect(deleteOwnEventPhoto).not.toHaveBeenCalled()
  })

  it('offers delete in the lightbox only for a photo the viewer may delete', async () => {
    const user = userEvent.setup()
    savePhotoDeleteToken('event-1/mine.jpg', 'delete-token-1')

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)

    await user.click(await screen.findByAltText('Fotka od Alice'))
    let lightbox = screen.getByRole('dialog')
    expect(within(lightbox).getByRole('button', { name: 'Smazat' })).toBeInTheDocument()

    await user.click(within(lightbox).getByRole('button', { name: 'Další fotka' }))
    lightbox = screen.getByRole('dialog')
    expect(within(lightbox).getByText('Fotka od Bob · 2 / 2')).toBeInTheDocument()
    expect(within(lightbox).queryByRole('button', { name: 'Smazat' })).not.toBeInTheDocument()
  })

  it('moves the lightbox to the next photo right after a delete, keeping focus inside it', async () => {
    const user = userEvent.setup()
    getEventPhotos.mockResolvedValueOnce(THREE_PHOTOS).mockReturnValueOnce(new Promise(() => {}))

    render(<PhotoGallery eventId="event-1" currentName="Organizátor" isOrganizer organizerToken="organizer-token" />)

    await user.click(await screen.findByAltText('Fotka od Bob'))
    const lightbox = screen.getByRole('dialog')
    expect(within(lightbox).getByText('Fotka od Bob · 2 / 3')).toBeInTheDocument()

    await user.click(within(lightbox).getByRole('button', { name: 'Smazat' }))

    // The reload never answers here: the photo must already be gone.
    expect(await within(screen.getByRole('dialog')).findByText('Fotka od Cyril · 2 / 2')).toBeInTheDocument()
    expect(screen.queryByAltText('Fotka od Bob')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement)
  })

  it('shows the new last photo after deleting the last one, even when the reload returns fewer photos', async () => {
    const user = userEvent.setup()
    // Someone else deleted Bob's photo meanwhile.
    getEventPhotos.mockResolvedValueOnce(THREE_PHOTOS).mockResolvedValueOnce([PHOTOS[0]])

    render(<PhotoGallery eventId="event-1" currentName="Organizátor" isOrganizer organizerToken="organizer-token" />)

    await user.click(await screen.findByAltText('Fotka od Cyril'))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Smazat' }))

    // Bob's photo took the deleted one's place, then vanished with the reload.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await user.keyboard('{ArrowRight}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends one delete even when Delete is clicked again while the first is running', async () => {
    const user = userEvent.setup()
    let finishDelete
    getEventPhotos.mockResolvedValueOnce(PHOTOS).mockResolvedValue([PHOTOS[0]])
    deleteEventPhoto.mockReturnValue(
      new Promise((resolve) => {
        finishDelete = resolve
      }),
    )

    render(<PhotoGallery eventId="event-1" currentName="Organizátor" isOrganizer organizerToken="organizer-token" />)

    await screen.findByAltText('Fotka od Bob')
    const bobsDeleteButton = screen.getAllByRole('button', { name: 'Smazat' })[1]
    await user.click(bobsDeleteButton)
    expect(bobsDeleteButton).toHaveTextContent('Mažu…')
    await user.click(bobsDeleteButton)

    finishDelete({ success: true })
    await waitFor(() => {
      expect(screen.queryByAltText('Fotka od Bob')).not.toBeInTheDocument()
    })
    expect(deleteEventPhoto).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledTimes(1)
  })
})

describe('PhotoGallery upload', () => {
  it('saves the photo’s delete token before recording it and sends the same token along', async () => {
    const user = userEvent.setup()
    getEventPhotos.mockResolvedValue([])
    uploadEventPhoto.mockResolvedValue('event-1/uploaded.jpg')
    recordEventPhoto.mockImplementation(async () => {
      expect(getPhotoDeleteToken('event-1/uploaded.jpg')).not.toBe('')
      return { success: true }
    })

    const { container } = render(<PhotoGallery eventId="event-1" currentName="Alice" />)
    await screen.findByText(/Zatím žádné fotky/)
    const file = new File(['image'], 'party.jpg', { type: 'image/jpeg' })
    await user.upload(container.querySelector('input[type="file"]'), file)

    await waitFor(() => {
      expect(recordEventPhoto).toHaveBeenCalled()
    })
    const deleteToken = getPhotoDeleteToken('event-1/uploaded.jpg')
    expect(deleteToken).not.toBe('')
    expect(uploadEventPhoto).toHaveBeenCalledWith('event-1', file, deleteToken)
    expect(recordEventPhoto).toHaveBeenCalledWith('event-1', 'event-1/uploaded.jpg', 'Alice', deleteToken)
  })
})
