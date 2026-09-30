import { installErrorReporting } from '../../src/lib/errorReporting.js'
import { supabase } from '../../src/lib/supabase.js'

jest.mock('../../src/lib/supabase.js', () => ({
  supabase: { rpc: jest.fn(() => Promise.resolve({ data: null, error: null })) },
}))

function throwUncaught(message: string) {
  window.dispatchEvent(new ErrorEvent('error', { message, error: new Error(message) }))
}

describe('installErrorReporting', () => {
  it('reports without tokens, each message once, at most five per page load', () => {
    window.location.hash = '#/event/abc/manage?token=secret123'
    installErrorReporting()

    throwUncaught('boom token=secret123')
    throwUncaught('boom token=secret123')
    expect(supabase.rpc).toHaveBeenCalledTimes(1)

    const [name, args] = jest.mocked(supabase.rpc).mock.calls[0] as unknown as [string, Record<string, string>]
    expect(name).toBe('log_client_error')
    expect(args.p_url).toBe('http://localhost/#/event/abc/manage')
    expect(args.p_message).toBe('boom token=…')
    expect(JSON.stringify(args)).not.toContain('secret123')

    for (let i = 0; i < 10; i += 1) {
      throwUncaught(`error ${i}`)
    }
    expect(supabase.rpc).toHaveBeenCalledTimes(5)
  })
})
