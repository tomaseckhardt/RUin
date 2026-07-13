import { useEffect, useState } from 'react'

const COLORS = ['#6f4cff', '#a78bfa', '#22c55e', '#fbbf24', '#f87171', '#34d399', '#f472b6']

function createParticles(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    color: COLORS[i % COLORS.length],
    size: 5 + Math.round(Math.random() * 7),
    driftX: Math.round((Math.random() - 0.5) * 280),
    rotate: Math.round((Math.random() - 0.5) * 720),
    delay: Math.round(Math.random() * 120),
    duration: 1300 + Math.round(Math.random() * 500),
    shape: Math.random() > 0.5 ? '50%' : '2px',
  }))
}

function ConfettiBurst({ origin, burstKey }) {
  const [particles, setParticles] = useState([])

  useEffect(() => {
    if (!origin) {
      return
    }

    setParticles(createParticles(30))
    const timeout = setTimeout(() => setParticles([]), 2200)

    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey])

  if (!origin || particles.length === 0) {
    return null
  }

  const riseDistance = Math.max(origin.y - window.innerHeight * 0.5, 80)
  const fallDistance = window.innerHeight - origin.y + 160

  return (
    <div className="pointer-events-none fixed inset-0 z-[999] overflow-hidden" aria-hidden="true">
      {particles.map((particle) => (
        <span
          key={particle.id}
          className="absolute"
          style={{
            left: origin.x,
            top: origin.y,
            width: particle.size,
            height: particle.size,
            background: particle.color,
            borderRadius: particle.shape,
            '--drift-x': `${particle.driftX}px`,
            '--rise': `${riseDistance}px`,
            '--fall': `${fallDistance}px`,
            '--rotate': `${particle.rotate}deg`,
            animation: `confetti-burst ${particle.duration}ms cubic-bezier(0.2,0.8,0.2,1) ${particle.delay}ms both`,
          }}
        />
      ))}
    </div>
  )
}

export default ConfettiBurst
