import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { getIntlLocale, useI18n } from '../lib/i18n.js'

const COMMENT_MAX = 500

function toCommentTimeLabel(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleString(getIntlLocale(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Likes and comments for the photo open in the lightbox. authorName is who
// likes/comments ('' when the viewer hasn't given a name yet); the gallery
// owns the data and the requests.
function PhotoComments({ likerNames, comments, authorName, isLiked, isLikePending, canModerate, onToggleLike, onAddComment, onDeleteComment }) {
  const { t } = useI18n()
  const [messageInput, setMessageInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  // Focus goes back here whenever the focused control disappears or gets
  // disabled, so it doesn't fall out of the lightbox.
  const messageInputRef = useRef(null)

  async function handleSubmit(event) {
    event.preventDefault()

    if (!authorName) {
      toast.error(t('photos.commentNeedsName'))
      return
    }

    if (!messageInput.trim()) {
      return
    }

    setIsSending(true)

    try {
      await onAddComment(messageInput)
      setMessageInput('')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSending(false)
      messageInputRef.current?.focus()
    }
  }

  async function handleDeleteComment(comment) {
    if (await onDeleteComment(comment)) {
      messageInputRef.current?.focus()
    }
  }

  return (
    <section
      aria-labelledby="photo-comments-title"
      className="flex min-h-0 max-h-[45dvh] w-full flex-col overflow-hidden rounded-2xl bg-white/95 p-4 text-slate-900 shadow-xl dark:bg-slate-900/95 dark:text-slate-100 lg:max-h-[78dvh] lg:w-80 lg:shrink-0">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={isLiked}
          aria-busy={isLikePending}
          onClick={onToggleLike}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition aria-busy:opacity-60 ${isLiked ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/50 dark:text-rose-200' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}>
          <span aria-hidden="true">{isLiked ? '♥' : '♡'}</span>
          {t('photos.like')}
        </button>
        <span className="text-sm text-slate-600 dark:text-slate-300">{t('photos.likeCount', { count: likerNames.length })}</span>
      </div>
      {likerNames.length > 0 ? (
        <p className="mt-2 shrink-0 text-xs text-slate-500 dark:text-slate-400">{t('photos.likedBy', { names: likerNames.join(', ') })}</p>
      ) : null}

      <h4 id="photo-comments-title" className="mt-4 shrink-0 text-sm font-semibold">
        {t('photos.commentsTitle')} <span className="font-normal text-slate-500 dark:text-slate-400">({comments.length})</span>
      </h4>

      {comments.length === 0 ? (
        <p className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain text-sm text-slate-500 dark:text-slate-400">{t('photos.noComments')}</p>
      ) : (
        <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-xl border border-slate-200 bg-white/80 p-2.5 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{comment.author_name}</p>
                <time dateTime={comment.created_at} className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {toCommentTimeLabel(comment.created_at)}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">{comment.message}</p>
              {canModerate ? (
                <button
                  type="button"
                  aria-label={t('photos.deleteComment', { name: comment.author_name })}
                  onClick={() => handleDeleteComment(comment)}
                  className="mt-1 text-xs font-medium text-rose-700 hover:underline dark:text-rose-300">
                  {t('common.delete')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form className="mt-3 shrink-0 space-y-2" onSubmit={handleSubmit}>
        <label htmlFor="photo-comment-input" className="sr-only">
          {t('photos.commentLabel')}
        </label>
        <textarea
          ref={messageInputRef}
          id="photo-comment-input"
          className="field min-h-20 text-sm"
          value={messageInput}
          onChange={(event) => setMessageInput(event.target.value.slice(0, COMMENT_MAX))}
          placeholder={t('photos.commentPlaceholder')}
          readOnly={isSending}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('common.charactersLeft', { count: COMMENT_MAX - messageInput.length })}</p>
          <button type="submit" className="primary-button px-4 py-2 text-sm" disabled={isSending || !messageInput.trim()}>
            {isSending ? t('common.sending') : t('photos.addComment')}
          </button>
        </div>
      </form>
    </section>
  )
}

export default PhotoComments
