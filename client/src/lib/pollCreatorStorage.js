import { readStoredMap, saveStoredMapEntry } from './browserStorage.js'

// The poll creator's token, kept out of the address bar so the poll's URL
// can be shared with voters as-is (like organizerLinkStorage for events).
const POLL_CREATOR_TOKENS_KEY = 'ruin-poll-creator-tokens'
const MAX_SAVED_POLL_CREATOR_TOKENS = 30

export function getSavedPollCreatorToken(pollId) {
  const token = readStoredMap(POLL_CREATOR_TOKENS_KEY)[pollId]

  return typeof token === 'string' ? token : ''
}

export function savePollCreatorToken(pollId, token) {
  if (!pollId || !token) {
    return
  }

  saveStoredMapEntry(POLL_CREATOR_TOKENS_KEY, pollId, token, MAX_SAVED_POLL_CREATOR_TOKENS)
}
