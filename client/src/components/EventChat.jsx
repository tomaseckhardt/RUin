import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getEventChatMessages, sendEventChatMessage } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'

const CHAT_MESSAGE_MAX = 500

function normalizeName(value) {
  return value.trim().toLocaleLowerCase('cs-CZ')
}

function toTimeLabel(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function upsertMessage(messages, incomingMessage) {
  if (!incomingMessage?.id) {
    return messages
  }

  const exists = messages.some((message) => message.id === incomingMessage.id)

  if (exists) {
    return messages
  }

  return [...messages, incomingMessage].sort((a, b) => {
    const dateA = new Date(a.created_at).getTime()
    const dateB = new Date(b.created_at).getTime()

    if (dateA === dateB) {
      return a.id - b.id
    }

    return dateA - dateB
  })
}

function EventChat({ eventId, currentName, canSend }) {
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadMessages() {
      try {
        const nextMessages = await getEventChatMessages(eventId)

        if (!cancelled) {
          setMessages(nextMessages)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error.message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadMessages()

    return () => {
      cancelled = true
    }
  }, [eventId])

  useEffect(() => {
    const channel = supabase
      .channel(`event-chat:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_chat_messages',
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          setMessages((previousMessages) => upsertMessage(previousMessages, payload.new))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [eventId])

  const remainingCharacters = useMemo(
    () => CHAT_MESSAGE_MAX - messageInput.length,
    [messageInput.length],
  )

  async function handleSubmit(event) {
    event.preventDefault()

    if (!canSend) {
      toast.error('Pro chat nejdřív odešli RSVP pod svým jménem.')
      return
    }

    if (!currentName?.trim()) {
      toast.error('Chybí jméno pro chat.')
      return
    }

    if (!messageInput.trim()) {
      return
    }

    setIsSending(true)

    try {
      const savedMessage = await sendEventChatMessage(eventId, currentName, messageInput)
      setMessages((previousMessages) => upsertMessage(previousMessages, savedMessage))
      setMessageInput('')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <section className="panel">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.24em]">Live chat</p>
          <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">Pokec účastníků</h3>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-300">
          {canSend ? 'Mluvte spolu přímo pod pozvánkou.' : 'Pro psaní do chatu nejdřív odešli RSVP.'}
        </p>
      </div>

      <div className="max-h-80 space-y-3 overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white/65 p-4 dark:border-slate-700 dark:bg-slate-950/45">
        {isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-300">Načítám chat…</p>
        ) : null}

        {!isLoading && messages.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-300">Zatím ticho. Hoď první zprávu.</p>
        ) : null}

        {messages.map((message) => {
          const isOwnMessage = currentName && normalizeName(message.sender_name) === normalizeName(currentName)

          return (
            <article
              key={message.id}
              className={`rounded-2xl border p-3 ${isOwnMessage ? 'border-fuchsia-300/60 bg-fuchsia-50/80 dark:border-fuchsia-500/50 dark:bg-fuchsia-950/35' : 'border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/55'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{message.sender_name}</p>
                <time className="text-xs text-slate-500 dark:text-slate-300">{toTimeLabel(message.created_at)}</time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{message.message}</p>
            </article>
          )
        })}
      </div>

      <form className="mt-4 space-y-2" onSubmit={handleSubmit}>
        <textarea
          className="field min-h-24"
          value={messageInput}
          onChange={(event) => setMessageInput(event.target.value.slice(0, CHAT_MESSAGE_MAX))}
          placeholder={canSend ? 'Napiš zprávu ostatním…' : 'Nejdřív potvrď účast nebo pošli omluvenku.'}
          disabled={!canSend || isSending}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-300">Zbývá {remainingCharacters} znaků</p>
          <button type="submit" className="primary-button" disabled={!canSend || isSending || !messageInput.trim()}>
            {isSending ? 'Odesílám…' : 'Poslat zprávu'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default EventChat
