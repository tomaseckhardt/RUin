import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhotoGallery from '../components/PhotoGallery.jsx'
import { axe, toHaveNoViolations } from 'jest-axe'
import {
  addEventPhotoComment,
  deleteEventPhoto,
  deleteEventPhotoComment,
  deleteOwnEventPhoto,
  getEventPhotoComments,
  getEventPhotoLikes,
  getEventPhotos,
  recordEventPhoto,
  toggleEventPhotoLike,
  uploadEventPhoto,
} from '../lib/api.js'
import { getPhotoDeleteToken, savePhotoDeleteToken } from '../lib/photoDeleteTokens.js'

jest.mock('../lib/api.js', () => ({
  addEventPhotoComment: jest.fn(),
  deleteEventPhoto: jest.fn(),
  deleteEventPhotoComment: jest.fn(),
  deleteOwnEventPhoto: jest.fn(),
  getEventPhotoComments: jest.fn(),
  getEventPhotoLikes: jest.fn(),
  getEventPhotoUrl: jest.fn((path) => `https://photos.example/${path}`),
  getEventPhotos: jest.fn(),
  recordEventPhoto: jest.fn(),
  toggleEventPhotoLike: jest.fn(),
  uploadEventPhoto: jest.fn(),
}))

jest.mock('../lib/realtimeTick.js', () => ({
  subscribeToEventTicks: jest.fn(() => () => {}),
}))

expect.extend(toHaveNoViolations)

const PHOTOS = [
  { id: 1, storage_path: 'event-1/mine.jpg', uploaded_by: 'Alice', created_at: '2026-01-02T00:00:00Z' },
  { id: 2, storage_path: 'event-1/theirs.jpg', uploaded_by: 'Bob', created_at: '2026-01-01T00:00:00Z' },
]

const THREE_PHOTOS = [...PHOTOS, { id: 3, storage_path: 'event-1/third.jpg', uploaded_by: 'Cyril', created_at: '2025-12-31T00:00:00Z' }]

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.removeItem('ruin-photo-delete-tokens')
  getEventPhotos.mockResolvedValue(PHOTOS)
  getEventPhotoLikes.mockResolvedValue([])
  getEventPhotoComments.mockResolvedValue([])
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

describe('PhotoGallery likes and comments', () => {
  const COMMENTS = [
    { id: 10, photo_id: 1, author_name: 'Bob', message: 'Pěkná!', created_at: '2026-01-02T10:00:00Z' },
    { id: 11, photo_id: 1, author_name: 'Cyril', message: 'Kde to je?', created_at: '2026-01-02T11:00:00Z' },
  ]

  it('shows like and comment counts on the thumbnails', async () => {
    getEventPhotoLikes.mockResolvedValue([
      { photo_id: 1, liker_name: 'Bob' },
      { photo_id: 1, liker_name: 'Cyril' },
    ])
    getEventPhotoComments.mockResolvedValue(COMMENTS)

    const { container } = render(<PhotoGallery eventId="event-1" currentName="Alice" />)

    await screen.findByAltText('Fotka od Alice')
    const [alicesTile, bobsTile] = container.querySelectorAll('.aspect-square')
    expect(alicesTile).toHaveTextContent('♥ 2')
    expect(alicesTile).toHaveTextContent('💬 2')
    expect(bobsTile).not.toHaveTextContent('♥')
  })

  it('likes a photo under the viewer’s name and takes the like back', async () => {
    const user = userEvent.setup()
    getEventPhotoLikes.mockResolvedValue([{ photo_id: 1, liker_name: 'Bob' }])
    toggleEventPhotoLike.mockResolvedValueOnce({ success: true, liked: true }).mockResolvedValueOnce({ success: true, liked: false })

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)
    await user.click(await screen.findByAltText('Fotka od Alice'))
    const lightbox = screen.getByRole('dialog')
    const likeButton = within(lightbox).getByRole('button', { name: 'Líbí se mi' })
    expect(likeButton).toHaveAttribute('aria-pressed', 'false')

    await user.click(likeButton)

    expect(toggleEventPhotoLike).toHaveBeenCalledWith('event-1', 1, 'Alice')
    expect(likeButton).toHaveAttribute('aria-pressed', 'true')
    expect(within(lightbox).getByText('2 lajky')).toBeInTheDocument()
    expect(within(lightbox).getByText('Líbí se: Bob, Alice')).toBeInTheDocument()

    await user.click(likeButton)

    expect(likeButton).toHaveAttribute('aria-pressed', 'false')
    expect(within(lightbox).getByText('1 lajk')).toBeInTheDocument()
  })

  it('asks for a name before a like or a comment', async () => {
    const user = userEvent.setup()

    render(<PhotoGallery eventId="event-1" currentName="" />)
    await user.click(await screen.findByAltText('Fotka od Alice'))
    const lightbox = screen.getByRole('dialog')

    await user.click(within(lightbox).getByRole('button', { name: 'Líbí se mi' }))
    await user.type(within(lightbox).getByLabelText('Komentář k fotce'), 'Ahoj')
    await user.click(within(lightbox).getByRole('button', { name: 'Přidat komentář' }))

    expect(toggleEventPhotoLike).not.toHaveBeenCalled()
    expect(addEventPhotoComment).not.toHaveBeenCalled()
  })

  it('adds a comment to the open photo and clears the draft', async () => {
    const user = userEvent.setup()
    addEventPhotoComment.mockImplementation(async (_eventId, photoId, authorName, message) => ({
      id: 20,
      photo_id: photoId,
      author_name: authorName,
      message,
      created_at: '2026-01-03T09:00:00Z',
    }))

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)
    await user.click(await screen.findByAltText('Fotka od Bob'))
    const lightbox = screen.getByRole('dialog')
    expect(within(lightbox).getByText('Zatím bez komentářů. Napiš první.')).toBeInTheDocument()

    const commentInput = within(lightbox).getByLabelText('Komentář k fotce')
    await user.type(commentInput, 'Super fotka')
    await user.click(within(lightbox).getByRole('button', { name: 'Přidat komentář' }))

    expect(addEventPhotoComment).toHaveBeenCalledWith('event-1', 2, 'Alice', 'Super fotka')
    expect(await within(lightbox).findByText('Super fotka')).toBeInTheDocument()
    expect(commentInput).toHaveValue('')
    expect(commentInput).toHaveFocus()
  })

  it('keeps the draft when the comment can’t be saved', async () => {
    const user = userEvent.setup()
    addEventPhotoComment.mockRejectedValue(new Error('Komentáře posíláš moc rychle, chvilku počkej.'))

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)
    await user.click(await screen.findByAltText('Fotka od Bob'))
    const commentInput = within(screen.getByRole('dialog')).getByLabelText('Komentář k fotce')
    await user.type(commentInput, 'Super fotka')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Přidat komentář' }))

    await waitFor(() => {
      expect(addEventPhotoComment).toHaveBeenCalled()
    })
    expect(commentInput).toHaveValue('Super fotka')
  })

  it('doesn’t switch photos when arrow keys are used while typing a comment', async () => {
    const user = userEvent.setup()

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)
    await user.click(await screen.findByAltText('Fotka od Alice'))
    const lightbox = screen.getByRole('dialog')

    await user.type(within(lightbox).getByLabelText('Komentář k fotce'), 'Ahoj{ArrowLeft}{ArrowRight}')

    expect(within(lightbox).getByText('Fotka od Alice · 1 / 2')).toBeInTheDocument()
  })

  it('lets only the organizer delete comments', async () => {
    const user = userEvent.setup()
    getEventPhotoComments.mockResolvedValue(COMMENTS)
    deleteEventPhotoComment.mockResolvedValue({ success: true })

    const { unmount } = render(<PhotoGallery eventId="event-1" currentName="Alice" />)
    await user.click(await screen.findByAltText('Fotka od Alice'))
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Smazat komentář od Bob' })).not.toBeInTheDocument()
    unmount()

    render(<PhotoGallery eventId="event-1" currentName="Organizátor" isOrganizer organizerToken="organizer-token" />)
    await user.click(await screen.findByAltText('Fotka od Alice'))
    const lightbox = screen.getByRole('dialog')
    await user.click(within(lightbox).getByRole('button', { name: 'Smazat komentář od Bob' }))

    expect(deleteEventPhotoComment).toHaveBeenCalledWith('event-1', 'organizer-token', 10)
    await waitFor(() => {
      expect(within(lightbox).queryByText('Pěkná!')).not.toBeInTheDocument()
    })
    expect(within(lightbox).getByText('Kde to je?')).toBeInTheDocument()
    expect(within(lightbox).getByLabelText('Komentář k fotce')).toHaveFocus()
  })

  it('still shows the photos when likes and comments can’t be loaded', async () => {
    getEventPhotoLikes.mockRejectedValue(new Error('Lajky u fotek se nepodařilo načíst.'))
    getEventPhotoComments.mockRejectedValue(new Error('Komentáře u fotek se nepodařilo načíst.'))

    render(<PhotoGallery eventId="event-1" currentName="Alice" />)

    expect(await screen.findByAltText('Fotka od Alice')).toBeInTheDocument()
  })

  it('has no axe violations in the lightbox with comments', async () => {
    const user = userEvent.setup()
    getEventPhotoComments.mockResolvedValue(COMMENTS)

    render(<PhotoGallery eventId="event-1" currentName="Organizátor" isOrganizer organizerToken="organizer-token" />)
    await user.click(await screen.findByAltText('Fotka od Alice'))

    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations()
  })
})
