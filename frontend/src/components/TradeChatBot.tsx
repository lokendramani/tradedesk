import { useState, useRef, useEffect } from 'react'
import apiClient from '../api/client'

interface Props {
  portfolioId: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Namaste! Main tumhara trading assistant hoon. Apne trades ke baare mein kuch bhi pooch sakte ho — best trade, win rate, segment analysis, ya koi bhi sawaal.',
  timestamp: new Date(),
}

const QUICK_CHIPS = [
  'Best trade kaunsa tha?',
  'Win rate batao',
  'Is mahine ka P&L?',
  'Open positions?',
]

// App colors (matches the light design system)
const C = {
  bgPrimary:   '#FFFFFF',
  bgSecondary: '#F4F6F9',
  bgTertiary:  '#F4F6F9',
  border:      '#E5E9F0',
  textPrimary: '#1A1F2B',
  textMuted:   '#8A93A6',
  textDim:     '#8A93A6',
  accent:      '#4C6FFF',
  accentText:  '#FFFFFF',
  green:       '#2ECC91',
}

const BOUNCE_STYLE = `
@keyframes td-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40%           { transform: translateY(-5px); }
}
`

export default function TradeChatBot({ portfolioId }: Props) {
  const [isOpen, setIsOpen]       = useState(false)
  const [messages, setMessages]   = useState<Message[]>([WELCOME])
  const [input, setInput]         = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || isLoading) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: msg,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    try {
      const history = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content }))
      const res = await apiClient.post(`/portfolios/${portfolioId}/trades/chat/`, { message: msg, history })
      const reply = res.data?.reply ?? 'Koi response nahi mila.'
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString() + 'a', role: 'assistant', content: reply, timestamp: new Date() },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString() + 'e',
          role: 'assistant',
          content: 'Sorry, kuch problem aa gayi. Thodi der baad try karo.',
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      <style>{BOUNCE_STYLE}</style>

      {/* Toggle button — hidden while panel is open (panel has its own × close) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open chat"
          style={{
            position:       'fixed',
            bottom:         '24px',
            right:          '24px',
            width:          '52px',
            height:         '52px',
            borderRadius:   '50%',
            background:     C.accent,
            border:         'none',
            cursor:         'pointer',
            zIndex:         9999,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            boxShadow:      '0 4px 20px rgba(76,111,255,0.3)',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div
          style={{
            position:      'fixed',
            bottom:        '24px',
            right:         '24px',
            width:         '360px',
            height:        '500px',
            borderRadius:  '16px',
            zIndex:        9998,
            background:    C.bgPrimary,
            border:        `1px solid ${C.border}`,
            display:       'flex',
            flexDirection: 'column',
            boxShadow:     '0 8px 32px rgba(0,0,0,0.12)',
            overflow:      'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding:      '13px 16px',
              background:   C.bgSecondary,
              borderBottom: `1px solid ${C.border}`,
              display:      'flex',
              alignItems:   'center',
              gap:          '8px',
              flexShrink:   0,
            }}
          >
            <span
              style={{
                width:        '8px',
                height:       '8px',
                borderRadius: '50%',
                background:   C.green,
                flexShrink:   0,
              }}
            />
            <span
              style={{
                fontWeight: 600,
                fontSize:   '13px',
                color:      C.textPrimary,
                flex:       1,
                fontFamily: 'inherit',
              }}
            >
              Trading Assistant
            </span>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close"
              style={{
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                color:      C.textDim,
                fontSize:   '20px',
                lineHeight: 1,
                padding:    '0',
                display:    'flex',
                alignItems: 'center',
              }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div
            style={{
              flex:          1,
              overflowY:     'auto',
              padding:       '14px 12px',
              display:       'flex',
              flexDirection: 'column',
              gap:           '10px',
              background:    C.bgPrimary,
            }}
          >
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  display:        'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth:     '82%',
                    padding:      '9px 13px',
                    whiteSpace:   'pre-wrap',
                    fontSize:     '13px',
                    lineHeight:   '1.55',
                    borderRadius: m.role === 'user'
                      ? '14px 14px 3px 14px'
                      : '14px 14px 14px 3px',
                    background:   m.role === 'user' ? C.accent    : C.bgTertiary,
                    color:        m.role === 'user' ? C.accentText : C.textPrimary,
                    fontFamily:   'inherit',
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {/* Loading dots */}
            {isLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    padding:      '10px 14px',
                    borderRadius: '14px 14px 14px 3px',
                    background:   C.bgTertiary,
                    display:      'flex',
                    gap:          '5px',
                    alignItems:   'center',
                  }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width:      '6px',
                        height:     '6px',
                        borderRadius: '50%',
                        background:   C.textMuted,
                        display:      'inline-block',
                        animation:    `td-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Quick-reply chips — only on fresh open */}
            {messages.length === 1 && !isLoading && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '2px' }}>
                {QUICK_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => sendMessage(chip)}
                    style={{
                      border:       `1px solid ${C.border}`,
                      borderRadius: '10px',
                      padding:      '4px 10px',
                      fontSize:     '12px',
                      background:   C.bgSecondary,
                      color:        C.textMuted,
                      cursor:       'pointer',
                      fontFamily:   'inherit',
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input row */}
          <div
            style={{
              padding:    '10px 12px',
              borderTop:  `1px solid ${C.border}`,
              display:    'flex',
              gap:        '8px',
              alignItems: 'center',
              background: C.bgSecondary,
              flexShrink: 0,
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Kuch bhi poochho apne trades ke baare mein..."
              style={{
                flex:        1,
                padding:     '9px 13px',
                borderRadius:'9px',
                border:      `1px solid ${C.border}`,
                background:  C.bgTertiary,
                color:       C.textPrimary,
                fontSize:    '13px',
                outline:     'none',
                fontFamily:  'inherit',
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={isLoading || !input.trim()}
              aria-label="Send"
              style={{
                width:          '36px',
                height:         '36px',
                borderRadius:   '9px',
                border:         'none',
                cursor:         isLoading || !input.trim() ? 'default' : 'pointer',
                background:     isLoading || !input.trim() ? C.bgTertiary : C.accent,
                color:          isLoading || !input.trim() ? C.textDim    : '#fff',
                fontSize:       '18px',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                flexShrink:     0,
                transition:     'background 0.15s ease',
              }}
            >
              ↑
            </button>
          </div>
        </div>
      )}
    </>
  )
}
