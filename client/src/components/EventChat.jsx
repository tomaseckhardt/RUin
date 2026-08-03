import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getChatReactions, getEventChatMessages, sendEventChatMessage, toggleChatReaction } from '../lib/api.js'
import { subscribeToEventTicks } from '../lib/realtimeTick.js'

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

function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const dateA = new Date(a.created_at).getTime()
    const dateB = new Date(b.created_at).getTime()

    if (dateA === dateB) {
      return a.id - b.id
    }

    return dateA - dateB
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

  return sortMessages([...messages, incomingMessage])
}

function mergeMessages(previousMessages, fetchedMessages) {
  const merged = new Map()

  for (const message of previousMessages) {
    merged.set(message.id, message)
  }

  for (const message of fetchedMessages) {
    merged.set(message.id, message)
  }

  return sortMessages([...merged.values()])
}

function EventChat({ eventId, currentName, canSend }) {
  const [messages, setMessages] = useState([])
  const [reactionsByMessage, setReactionsByMessage] = useState({})
  const [messageInput, setMessageInput] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [openPickerFor, setOpenPickerFor] = useState(null)
  const [pendingReactions, setPendingReactions] = useState(() => new Set())
  const latestRequestIdRef = useRef(0)
  const scrollContainerRef = useRef(null)
  const shouldAutoScrollRef = useRef(true)

  async function loadMessages() {
    const requestId = ++latestRequestIdRef.current

    try {
      const nextMessages = await getEventChatMessages(eventId)

      if (requestId !== latestRequestIdRef.current) {
        return
      }

      setMessages((previousMessages) => mergeMessages(previousMessages, nextMessages))

      const reactions = await getChatReactions(eventId, nextMessages.map((message) => message.id))

      if (requestId !== latestRequestIdRef.current) {
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
      if (requestId === latestRequestIdRef.current) {
        toast.error(error.message)
      }
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    // Fetch-on-mount-and-eventId-change, refreshed again by the realtime
    // tick subscription below - there's no external system to "subscribe" to
    // for the initial load itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMessages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  useEffect(() => {
    return subscribeToEventTicks(eventId, ['chat_message', 'chat_reaction'], loadMessages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  useEffect(() => {
    if (shouldAutoScrollRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [messages])

  function handleMessagesScroll(event) {
    const container = event.currentTarget
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight

    shouldAutoScrollRef.current = distanceFromBottom < 48
  }

  async function handleToggleReaction(messageId, emoji) {
    if (!currentName?.trim()) {
      toast.error('Pro reakci se nejdřív pod svým jménem.')
      return
    }

    const pendingKey = `${messageId}:${emoji}`

    if (pendingReactions.has(pendingKey)) {
      return
    }

    setOpenPickerFor(null)
    setPendingReactions((current) => new Set(current).add(pendingKey))

    try {
      await toggleChatReaction(messageId, currentName, emoji)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setPendingReactions((current) => {
        const next = new Set(current)
        next.delete(pendingKey)
        return next
      })
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

      <div
        ref={scrollContainerRef}
        onScroll={handleMessagesScroll}
        className="max-h-80 space-y-3 overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white/65 p-4 dark:border-slate-700 dark:bg-slate-950/45"
      >
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
                      disabled={pendingReactions.has(`${message.id}:${group.emoji}`)}
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
                        disabled={pendingReactions.has(`${message.id}:${emoji}`)}
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
