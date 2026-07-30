import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import JSZip from 'jszip'
import { deleteEventPhoto, getEventPhotoUrl, getEventPhotos, recordEventPhoto, uploadEventPhoto } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'

function normalizeName(value) {
  return (value || '').trim().toLocaleLowerCase('cs-CZ')
}

function PhotoGallery({ eventId, currentName, isOrganizer = false, organizerToken = null }) {
  const [photos, setPhotos] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (lightboxIndex === null) {
      return undefined
    }

    function handleKeyDown(event) {
      if (event.key === 'ArrowRight') {
        setLightboxIndex((current) => (current + 1) % photos.length)
      } else if (event.key === 'ArrowLeft') {
        setLightboxIndex((current) => (current - 1 + photos.length) % photos.length)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [lightboxIndex, photos.length])

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

  async function handleDelete(photo) {
    try {
      const { error: storageError } = await supabase.storage.from('event-photos').remove([photo.storage_path])

      if (storageError) {
        toast.warning('Fotku se nepodařilo smazat z úložiště, záznam ale zmizí.')
      }

      await deleteEventPhoto(eventId, organizerToken, photo.id)
      await loadPhotos()
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function handleDownloadAll() {
    const normalizedCurrentName = normalizeName(currentName)
    const othersPhotos = photos.filter(
      (photo) => normalizeName(photo.uploaded_by) !== normalizedCurrentName,
    )

    if (othersPhotos.length === 0) {
      toast.error('Není co stáhnout, zbylé fotky jsi nahrál/a ty.')
      return
    }

    setIsDownloading(true)

    try {
      const zip = new JSZip()

      await Promise.all(
        othersPhotos.map(async (photo) => {
          const response = await fetch(getEventPhotoUrl(photo.storage_path))

          if (!response.ok) {
            throw new Error(`Fotku od ${photo.uploaded_by} se nepodařilo stáhnout.`)
          }

          const blob = await response.blob()
          const fileName = photo.storage_path.split('/').pop() || `${photo.id}.jpg`
          zip.file(fileName, blob)
        }),
      )

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `fotky-${eventId}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`Staženo ${othersPhotos.length} fotek.`)
    } catch (error) {
      toast.error(error.message || 'Fotky se nepodařilo stáhnout.')
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
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.24em]">Album</p>
          <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">Fotky z akce</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {photos.length > 0 ? (
            <button type="button" className="secondary-button" disabled={isDownloading} onClick={handleDownloadAll}>
              {isDownloading ? 'Stahuju…' : 'Stáhnout fotky'}
            </button>
          ) : null}
          <button type="button" className="secondary-button" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
            {isUploading ? 'Nahrávám…' : '📷 Přidat fotku'}
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>

      {photos.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Zatím žádné fotky. První může přidat kdokoli z účastníků.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo, index) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setLightboxIndex(index)}
                className="block h-full w-full cursor-zoom-in"
              >
                <img src={getEventPhotoUrl(photo.storage_path)} alt={`Fotka od ${photo.uploaded_by}`} className="h-full w-full object-cover" loading="lazy" />
              </button>
              {isOrganizer ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleDelete(photo)
                  }}
                  className="absolute right-1.5 top-1.5 rounded-full bg-slate-950/60 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100"
                >
                  Smazat
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {lightboxIndex !== null && photos[lightboxIndex] ? (
        <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90dvh] w-full max-w-3xl flex-col items-center gap-4 p-4">
            <div className="flex w-full items-center justify-between gap-3 text-slate-100">
              <p className="text-sm">
                Fotka od {photos[lightboxIndex].uploaded_by} · {lightboxIndex + 1} / {photos.length}
              </p>
              <button type="button" className="secondary-button" onClick={() => setLightboxIndex(null)}>
                Zavřít
              </button>
            </div>

            <div className="relative flex w-full flex-1 items-center justify-center">
              {photos.length > 1 ? (
                <button
                  type="button"
                  aria-label="Předchozí fotka"
                  onClick={() => setLightboxIndex((current) => (current - 1 + photos.length) % photos.length)}
                  className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/60 text-xl text-white sm:-left-14"
                >
                  ‹
                </button>
              ) : null}

              <img
                src={getEventPhotoUrl(photos[lightboxIndex].storage_path)}
                alt={`Fotka od ${photos[lightboxIndex].uploaded_by}`}
                className="max-h-[70dvh] max-w-full rounded-xl object-contain"
              />

              {photos.length > 1 ? (
                <button
                  type="button"
                  aria-label="Další fotka"
                  onClick={() => setLightboxIndex((current) => (current + 1) % photos.length)}
                  className="absolute right-0 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950/60 text-xl text-white sm:-right-14"
                >
                  ›
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </section>
  )
}

export default PhotoGallery
