const CONFETTI_DOTS = [
  {
    left: "20%",
    top: "50%",
    size: 8,
    color: "#6f4cff",
    radius: "50%",
    delay: "0s",
  },
  {
    left: "40%",
    top: "55%",
    size: 6,
    color: "#22c55e",
    radius: "2px",
    delay: "0.1s",
  },
  {
    left: "60%",
    top: "48%",
    size: 7,
    color: "#fbbf24",
    radius: "50%",
    delay: "0.05s",
  },
  {
    left: "75%",
    top: "52%",
    size: 5,
    color: "#f87171",
    radius: "2px",
    delay: "0.15s",
  },
  {
    left: "30%",
    top: "60%",
    size: 9,
    color: "#a78bfa",
    radius: "50%",
    delay: "0.08s",
  },
  {
    left: "85%",
    top: "45%",
    size: 6,
    color: "#34d399",
    radius: "2px",
    delay: "0.12s",
  },
];

const SAD_PARTICLES = [
  { left: "25%", top: "30%", size: 6, delay: "0.3s", duration: "1.5s" },
  { left: "50%", top: "25%", size: 4, delay: "0.5s", duration: "1.8s" },
  { left: "70%", top: "35%", size: 5, delay: "0.4s", duration: "1.6s" },
];

export function ConfirmCelebration({ name }) {
  return (
    <section
      className="panel relative overflow-hidden py-12 text-center"
      style={{ animation: "scale-in 0.4s ease both" }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {CONFETTI_DOTS.map((dot, index) => (
          <span
            key={index}
            className="absolute rounded-full"
            style={{
              left: dot.left,
              top: dot.top,
              width: dot.size,
              height: dot.size,
              background: dot.color,
              borderRadius: dot.radius,
              animation: `confetti-fall 0.9s ease ${dot.delay} both`,
            }}
          />
        ))}
      </div>

      <div className="relative">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(135deg, #6f4cff, #a78bfa)",
            animation: "avatar-pop 0.6s cubic-bezier(0.34,1.56,0.64,1) both",
          }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle
              cx="16"
              cy="16"
              r="14"
              fill="#22c55e"
              style={{
                animation: "circle-fill 0.5s ease 0.3s both",
                transformOrigin: "center",
              }}
            />
            <path
              d="M10 16L14 20L22 12"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 24,
                strokeDashoffset: 24,
                animation: "check-draw 0.4s ease 0.6s both",
              }}
            />
          </svg>
        </div>
        <h3
          className="mt-4 text-xl font-bold text-slate-950 dark:text-slate-50"
          style={{ animation: "float-up 0.4s ease 0.5s both", opacity: 0 }}>
          {name ? `${name}, Jdeš do toho!` : "Jdeš do toho!"}
        </h3>
        <p
          className="mt-1 text-sm text-slate-500 dark:text-slate-300"
          style={{ animation: "float-up 0.4s ease 0.65s both", opacity: 0 }}>
          Účast potvrzená. Těšíme se na tebe.
        </p>
      </div>
    </section>
  );
}

export function DeclineCelebration({ name }) {
  return (
    <section
      className="panel relative overflow-hidden py-12 text-center"
      style={{ animation: "scale-in 0.4s ease both" }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {SAD_PARTICLES.map((particle, index) => (
          <span
            key={index}
            className="absolute rounded-full"
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
              background: "rgba(148,163,184,0.4)",
              animation: `sad-particles ${particle.duration} ease ${particle.delay} both`,
            }}
          />
        ))}
      </div>

      <div className="relative">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(135deg, #f87171, #ef4444)",
            animation:
              "thumb-enter 0.7s cubic-bezier(0.34,1.56,0.64,1) both, thumb-wobble 0.6s ease 0.7s both",
          }}>
          <span className="text-3xl leading-none">👎</span>
        </div>
        <h3
          className="mt-4 text-xl font-bold text-slate-950 dark:text-slate-50"
          style={{ animation: "float-up 0.4s ease 0.5s both", opacity: 0 }}>
          {name ? `Škoda, ${name}!` : "Škoda!"}
        </h3>
        <p
          className="mt-1 mb-3 text-sm text-slate-500 dark:text-slate-300"
          style={{ animation: "float-up 0.4s ease 0.65s both", opacity: 0 }}>
          Omluvenka odeslaná. Snad příště.
        </p>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
          style={{
            background: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.2)",
            color: "#d29014",
            animation: "float-up 0.4s ease 0.8s both",
            opacity: 0,
          }}>
          Omluveno
        </span>
      </div>
    </section>
  );
}
