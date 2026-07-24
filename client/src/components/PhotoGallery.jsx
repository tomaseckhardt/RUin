import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { deleteEventPhoto, getEventPhotoUrl, getEventPhotos, recordEventPhoto, uploadEventPhoto } from '../lib/api.js'

function PhotoGallery({ eventId, currentName, isOrganizer = false, organizerToken = null }) {
  const [photos, setPhotos] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef(null)

  async function loadPhotos() {
    try {
      setPhotos(await getEventPhotos(eventId))
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Fetch-on-mount-and-eventId-change; there's no external system to
    // "subscribe" to here, just an initial load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPhotos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!currentName?.trim() && !isOrganizer) {
      toast.error('Napiš svoje jméno v RSVP, ať víme, od koho fotka je.')
      return
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Nahraj prosím obrázek.')
      return
    }

    setIsUploading(true)

    try {
      const storagePath = await uploadEventPhoto(eventId, file)
      await recordEventPhoto(eventId, storagePath, currentName || 'Organizátor')
      await loadPhotos()
      toast.success('Fotka nahraná.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsUploading(false)
    }
  }

  async function handleDelete(photoId) {
    try {
      await deleteEventPhoto(eventId, organizerToken, photoId)
      await loadPhotos()
    } catch (error) {
      toast.error(error.message)
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <section className="panel">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.24em]">Album</p>
          <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">Fotky z akce</h3>
        </div>
        <button type="button" className="secondary-button" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
          {isUploading ? 'Nahrávám…' : '📷 Přidat fotku'}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Zatím žádné fotky. První může přidat kdokoli z účastníků.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
              <img src={getEventPhotoUrl(photo.storage_path)} alt={`Fotka od ${photo.uploaded_by}`} className="h-full w-full object-cover" loading="lazy" />
              {isOrganizer ? (
                <button
                  type="button"
                  onClick={() => handleDelete(photo.id)}
                  className="absolute right-1.5 top-1.5 rounded-full bg-slate-950/60 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100"
                >
                  Smazat
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default PhotoGallery
