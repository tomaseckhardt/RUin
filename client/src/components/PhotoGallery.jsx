import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import JSZip from 'jszip'
import ModalOverlay from './ModalOverlay.jsx'
import PhotoComments from './PhotoComments.jsx'
import {
  addEventPhotoComment,
  deleteEventPhoto,
  deleteEventPhotoComment,
  deleteOwnEventPhoto,
  getEventPhotoComments,
  getEventPhotoLikes,
  getEventPhotoUrl,
  getEventPhotos,
  recordEventPhoto,
  PHOTO_EXTENSIONS,
  toggleEventPhotoLike,
  uploadEventPhoto,
} from '../lib/api.js'
import { downloadBlob } from '../lib/download.js'
import { useI18n } from '../lib/i18n.js'
import { clearPhotoDeleteToken, getPhotoDeleteTokens, savePhotoDeleteToken } from '../lib/photoDeleteTokens.js'
import { subscribeToEventTicks } from '../lib/realtimeTick.js'
import { normalizeName } from '../lib/normalizeName.js'

const NO_ROWS = []

function groupByPhoto(rows, pick) {
  const groups = new Map()

  for (const row of rows) {
    const group = groups.get(row.photo_id) || []
    group.push(pick(row))
    groups.set(row.photo_id, group)
  }

  return groups
}

/**
 * @param {object} props
 * @param {string} props.eventId
 * @param {string} [props.currentName] the viewer's RSVP name, credited on uploads, likes and comments
 * @param {boolean} [props.isOrganizer]
 * @param {string | null} [props.organizerToken] lets the organizer delete any photo or comment
 */
function PhotoGallery({ eventId, currentName, isOrganizer = false, organizerToken = null }) {
  const { t } = useI18n()
  const [photos, setPhotos] = useState([])
  const [likes, setLikes] = useState([])
  const [comments, setComments] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  // The lightbox follows a photo, not a position, so it stays on the right
  // one when the list changes under it (and closes when that photo is gone).
  const [lightboxPhotoId, setLightboxPhotoId] = useState(null)
  const [deletingPhotoId, setDeletingPhotoId] = useState(null)
  const [likePendingPhotoId, setLikePendingPhotoId] = useState(null)
  const isDeletingRef = useRef(false)
  const latestLoadIdRef = useRef(0)
  const fileInputRef = useRef(null)
  const addButtonRef = useRef(null)
  const lightboxCloseButtonRef = useRef(null)
  const lightboxIndex = lightboxPhotoId === null ? -1 : photos.findIndex((photo) => photo.id === lightboxPhotoId)
  const lightboxPhoto = lightboxIndex === -1 ? null : photos[lightboxIndex]
  // Read once per render; a guest can delete only photos uploaded from this
  // browser, which hold a delete token.
  const deleteTokens = isOrganizer ? {} : getPhotoDeleteTokens()
  // Who likes and comments; the organizer page may not know a name.
  const authorName = currentName?.trim() || (isOrganizer ? t('common.organizer') : '')
  const likerNamesByPhoto = groupByPhoto(likes, (like) => like.liker_name)
  const commentsByPhoto = groupByPhoto(comments, (comment) => comment)

  function isLikedByViewer(photoId) {
    return authorName !== '' && (likerNamesByPhoto.get(photoId) || NO_ROWS).some((name) => normalizeName(name) === normalizeName(authorName))
  }

  function canDelete(photo) {
    return isOrganizer || typeof deleteTokens[photo.storage_path] === 'string'
  }

  function showPhotoAt(index) {
    setLightboxPhotoId(photos[(index + photos.length) % photos.length].id)
  }

  useEffect(() => {
    if (lightboxIndex === -1) {
      return undefined
    }

    function handleKeyDown(event) {
      // Arrow keys move the cursor while typing a comment.
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) {
        return
      }

      if (event.key === 'ArrowRight') {
        setLightboxPhotoId(photos[(lightboxIndex + 1) % photos.length].id)
      } else if (event.key === 'ArrowLeft') {
        setLightboxPhotoId(photos[(lightboxIndex - 1 + photos.length) % photos.length].id)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [lightboxIndex, photos])

  async function loadPhotos() {
    const loadId = ++latestLoadIdRef.current
    // Likes and comments are extras: the album still shows when they fail.
    const results = await Promise.allSettled([getEventPhotos(eventId), getEventPhotoLikes(eventId), getEventPhotoComments(eventId)])

    if (loadId !== latestLoadIdRef.current) {
      return
    }

    const [photosResult, likesResult, commentsResult] = results

    if (photosResult.status === 'fulfilled') {
      setPhotos(photosResult.value)
    }

    if (likesResult.status === 'fulfilled') {
      setLikes(likesResult.value)
    }

    if (commentsResult.status === 'fulfilled') {
      setComments(commentsResult.value)
    }

    const failure = results.find((result) => result.status === 'rejected')

    if (failure) {
      toast.error(failure.reason.message)
    }

    setIsLoading(false)
  }

  useEffect(() => {
    // Load now, and again whenever a realtime tick says the photos changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPhotos()
    return subscribeToEventTicks(eventId, ['photo', 'photo_like', 'photo_comment'], loadPhotos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  async function handleFileChange(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''

    if (files.length === 0) {
      return
    }

    if (!currentName?.trim() && !isOrganizer) {
      toast.error(t('photos.nameRequired'))
      return
    }

    setIsUploading(true)

    let successCount = 0

    try {
      for (const file of files) {
        if (!PHOTO_EXTENSIONS[file.type]) {
          toast.error(t('photos.imageOnly'))
          continue
        }

        try {
          const deleteToken = crypto.randomUUID()
          const storagePath = await uploadEventPhoto(eventId, file, deleteToken)
          // Saved before recording: if the record goes through but its
          // response is lost, the token must not be lost with it.
          savePhotoDeleteToken(storagePath, deleteToken)
          await recordEventPhoto(eventId, storagePath, currentName || t('common.organizer'), deleteToken)
          successCount += 1
        } catch (error) {
          toast.error(error.message)
        }
      }

      await loadPhotos()

      if (successCount > 0) {
        toast.success(files.length === 1 ? t('photos.uploadedOne') : t('photos.uploadedMany', { uploaded: successCount, total: files.length }))
      }
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDelete(photo) {
    if (isDeletingRef.current || !window.confirm(t('photos.confirmDelete'))) {
      return
    }

    isDeletingRef.current = true
    setDeletingPhotoId(photo.id)

    try {
      if (isOrganizer) {
        await deleteEventPhoto(eventId, organizerToken, photo.id)
      } else {
        await deleteOwnEventPhoto(eventId, photo.id, deleteTokens[photo.storage_path])
      }

      clearPhotoDeleteToken(photo.storage_path)

      // Gone right away rather than after the reload below. An open lightbox
      // moves on to the photo that takes the deleted one's place, or closes
      // when none is left.
      const remaining = photos.filter((item) => item.id !== photo.id)
      const staysOpen = lightboxPhotoId !== null && remaining.length > 0

      if (lightboxPhotoId === photo.id) {
        setLightboxPhotoId(staysOpen ? remaining[Math.min(lightboxIndex, remaining.length - 1)].id : null)
      }

      setPhotos((current) => current.filter((item) => item.id !== photo.id))
      // The focused Delete button may be about to disappear; keep focus in the
      // lightbox, or on the album when there's no lightbox left.
      const focusTarget = staysOpen ? lightboxCloseButtonRef.current : addButtonRef.current
      focusTarget?.focus()
    } catch (error) {
      toast.error(error.message)
    } finally {
      isDeletingRef.current = false
      setDeletingPhotoId(null)
    }

    await loadPhotos()
  }

  async function handleToggleLike(photo) {
    if (!authorName) {
      toast.error(t('photos.likeNeedsName'))
      return
    }

    if (likePendingPhotoId !== null) {
      return
    }

    setLikePendingPhotoId(photo.id)

    try {
      const result = await toggleEventPhotoLike(eventId, photo.id, authorName)
      const isViewersLike = (like) => like.photo_id === photo.id && normalizeName(like.liker_name) === normalizeName(authorName)

      setLikes((current) => {
        const others = current.filter((like) => !isViewersLike(like))
        return result?.liked ? [...others, { photo_id: photo.id, liker_name: authorName }] : others
      })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLikePendingPhotoId(null)
    }
  }

  // Errors go back to PhotoComments, which keeps the draft and shows them.
  async function handleAddComment(photo, message) {
    const savedComment = await addEventPhotoComment(eventId, photo.id, authorName, message)

    if (savedComment) {
      setComments((current) => (current.some((comment) => comment.id === savedComment.id) ? current : [...current, savedComment]))
    }
  }

  // Resolves to whether the comment is gone.
  async function handleDeleteComment(comment) {
    if (!window.confirm(t('photos.confirmDeleteComment'))) {
      return false
    }

    try {
      await deleteEventPhotoComment(eventId, organizerToken, comment.id)
      setComments((current) => current.filter((item) => item.id !== comment.id))
      return true
    } catch (error) {
      toast.error(error.message)
      return false
    }
  }

  async function handleDownloadAll() {
    const normalizedCurrentName = normalizeName(currentName)
    const othersPhotos = photos.filter((photo) => normalizeName(photo.uploaded_by) !== normalizedCurrentName)

    if (othersPhotos.length === 0) {
      toast.error(t('photos.nothingToDownload'))
      return
    }

    setIsDownloading(true)

    try {
      const zip = new JSZip()

      await Promise.all(
        othersPhotos.map(async (photo) => {
          const response = await fetch(getEventPhotoUrl(photo.storage_path))

          if (!response.ok) {
            throw new Error(t('photos.downloadOneFailed', { name: photo.uploaded_by }))
          }

          const blob = await response.blob()
          const fileName = photo.storage_path.split('/').pop() || `${photo.id}.jpg`
          zip.file(fileName, blob)
        }),
      )

      downloadBlob(await zip.generateAsync({ type: 'blob' }), t('photos.zipFileName', { id: eventId }))

      toast.success(t('photos.downloaded', { count: othersPhotos.length }))
    } catch (error) {
      toast.error(error.message || t('photos.downloadFailed'))
    } finally {
      setIsDownloading(false)
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <section className="panel">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.24em]">{t('photos.eyebrow')}</p>
          <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">{t('photos.title')}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {photos.length > 0 ? (
            <button type="button" className="secondary-button" disabled={isDownloading} onClick={handleDownloadAll}>
              {isDownloading ? t('photos.downloading') : t('photos.download')}
            </button>
          ) : null}
          <button ref={addButtonRef} type="button" className="secondary-button" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
            {isUploading ? t('photos.uploading') : t('photos.add')}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('photos.empty')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo) => {
            const likeCount = (likerNamesByPhoto.get(photo.id) || NO_ROWS).length
            const commentCount = (commentsByPhoto.get(photo.id) || NO_ROWS).length

            return (
              <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
                <button type="button" onClick={() => setLightboxPhotoId(photo.id)} className="block h-full w-full cursor-zoom-in">
                  <img
                    src={getEventPhotoUrl(photo.storage_path)}
                    alt={t('photos.photoBy', { name: photo.uploaded_by })}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
                {canDelete(photo) ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDelete(photo)
                    }}
                    className="absolute right-1.5 top-1.5 rounded-full bg-slate-950/60 px-2 py-1 text-xs text-white transition">
                    {deletingPhotoId === photo.id ? t('photos.deleting') : t('common.delete')}
                  </button>
                ) : null}
                {likeCount > 0 || commentCount > 0 ? (
                  // The lightbox has the same numbers for screen readers.
                  <div aria-hidden="true" className="pointer-events-none absolute bottom-1.5 left-1.5 flex gap-1 text-xs text-white">
                    {likeCount > 0 ? <span className="rounded-full bg-slate-950/60 px-2 py-0.5">♥ {likeCount}</span> : null}
                    {commentCount > 0 ? <span className="rounded-full bg-slate-950/60 px-2 py-0.5">💬 {commentCount}</span> : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {lightboxPhoto ? (
        <ModalOverlay open onClose={() => setLightboxPhotoId(null)} labelledBy="photo-lightbox-title">
          <div className="flex max-h-[92dvh] w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 lg:overflow-hidden">
            <div className="flex w-full items-center justify-between gap-3 text-slate-100">
              <p id="photo-lightbox-title" className="text-sm">
                {t('photos.lightboxTitle', { name: lightboxPhoto.uploaded_by, index: lightboxIndex + 1, total: photos.length })}
              </p>
              <div className="flex shrink-0 gap-2">
                {canDelete(lightboxPhoto) ? (
                  <button type="button" className="secondary-button danger-button" onClick={() => handleDelete(lightboxPhoto)}>
                    {deletingPhotoId === lightboxPhoto.id ? t('photos.deleting') : t('common.delete')}
                  </button>
                ) : null}
                <button ref={lightboxCloseButtonRef} type="button" className="secondary-button" onClick={() => setLightboxPhotoId(null)}>
                  {t('common.close')}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
              <div className="relative flex min-w-0 flex-1 items-center justify-center">
                {photos.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t('photos.previous')}
                    onClick={() => showPhotoAt(lightboxIndex - 1)}
                    className="absolute left-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/60 text-xl text-white">
                    ‹
                  </button>
                ) : null}

                <img
                  src={getEventPhotoUrl(lightboxPhoto.storage_path)}
                  alt={t('photos.photoBy', { name: lightboxPhoto.uploaded_by })}
                  className="max-h-[55dvh] max-w-full rounded-xl object-contain lg:max-h-[78dvh]"
                />

                {photos.length > 1 ? (
                  <button
                    type="button"
                    aria-label={t('photos.next')}
                    onClick={() => showPhotoAt(lightboxIndex + 1)}
                    className="absolute right-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/60 text-xl text-white">
                    ›
                  </button>
                ) : null}
              </div>

              <PhotoComments
                key={lightboxPhoto.id}
                likerNames={likerNamesByPhoto.get(lightboxPhoto.id) || NO_ROWS}
                comments={commentsByPhoto.get(lightboxPhoto.id) || NO_ROWS}
                authorName={authorName}
                isLiked={isLikedByViewer(lightboxPhoto.id)}
                isLikePending={likePendingPhotoId === lightboxPhoto.id}
                canModerate={isOrganizer}
                onToggleLike={() => handleToggleLike(lightboxPhoto)}
                onAddComment={(message) => handleAddComment(lightboxPhoto, message)}
                onDeleteComment={handleDeleteComment}
              />
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </section>
  )
}

export default PhotoGallery
