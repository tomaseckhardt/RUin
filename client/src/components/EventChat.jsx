import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getChatReactions, getEventChatMessages, sendEventChatMessage, toggleChatReaction } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'

const CHAT_MESSAGE_MAX = 500
const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🍻']

function groupReactions(reactions) {
  const groups = new Map()

  for (const reaction of reactions) {
    const existing = groups.get(reaction.emoji) || []
    existing.push(reaction.sender_name)
    groups.set(reaction.emoji, existing)
  }

  return [...groups.entries()].map(([emoji, senderNames]) => ({ emoji, senderNames }))
}

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
  const [reactionsByMessage, setReactionsByMessage] = useState({})
  const [messageInput, setMessageInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [openPickerFor, setOpenPickerFor] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadMessages() {
      try {
        const nextMessages = await getEventChatMessages(eventId)

        if (cancelled) {
          return
        }

        setMessages(nextMessages)

        const reactions = await getChatReactions(nextMessages.map((message) => message.id))

        if (cancelled) {
          return
        }

        const grouped = {}

        for (const reaction of reactions) {
          if (!grouped[reaction.message_id]) {
            grouped[reaction.message_id] = []
          }

          grouped[reaction.message_id].push(reaction)
        }

        setReactionsByMessage(grouped)
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

  useEffect(() => {
    const channel = supabase
      .channel(`event-chat-reactions:${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'event_chat_message_reactions' },
        (payload) => {
          const reaction = payload.new

          setReactionsByMessage((current) => {
            const existing = current[reaction.message_id] || []

            if (existing.some((item) => item.id === reaction.id)) {
              return current
            }

            return { ...current, [reaction.message_id]: [...existing, reaction] }
          })
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'event_chat_message_reactions' },
        (payload) => {
          const removedId = payload.old?.id

          setReactionsByMessage((current) => {
            const next = {}

            for (const [messageId, list] of Object.entries(current)) {
              next[messageId] = list.filter((item) => item.id !== removedId)
            }

            return next
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [eventId])

  async function handleToggleReaction(messageId, emoji) {
    if (!currentName?.trim()) {
      toast.error('Pro reakci se nejdřív pod svým jménem.')
      return
    }

    setOpenPickerFor(null)

    try {
      await toggleChatReaction(messageId, currentName, emoji)
    } catch (error) {
      toast.error(error.message)
    }
  }

  const remainingCharacters = useMemo(
    () => CHAT_MESSAGE_MAX - messageInput.length,
    [messageInput.length],
  )

  async function handleSubmit(event) {
    event.preventDefault()

    if (!canSend) {
      toast.error('Pro chat se nejdřív pod svým jménem.')
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
          const reactionGroups = groupReactions(reactionsByMessage[message.id] || [])
          const normalizedCurrentName = currentName ? normalizeName(currentName) : ''

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

              <div className="relative mt-2 flex flex-wrap items-center gap-1.5">
                {reactionGroups.map((group) => {
                  const reactedByMe = normalizedCurrentName && group.senderNames.some((name) => normalizeName(name) === normalizedCurrentName)

                  return (
                    <button
                      key={group.emoji}
                      type="button"
                      onClick={() => handleToggleReaction(message.id, group.emoji)}
                      title={group.senderNames.join(', ')}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${reactedByMe ? 'border-fuchsia-300 bg-fuchsia-100 dark:border-fuchsia-500/60 dark:bg-fuchsia-950/50' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'}`}
                    >
                      <span>{group.emoji}</span>
                      <span className="text-slate-600 dark:text-slate-300">{group.senderNames.length}</span>
                    </button>
                  )
                })}

                <button
                  type="button"
                  onClick={() => setOpenPickerFor((current) => (current === message.id ? null : message.id))}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-xs text-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                >
                  +
                </button>

                {openPickerFor === message.id ? (
                  <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => handleToggleReaction(message.id, emoji)}
                        className="rounded-full px-1.5 py-0.5 text-base hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
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
