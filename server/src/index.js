import cors from 'cors'
import express from 'express'
import eventsRouter from './routes/events.js'

const app = express()
const port = Number(process.env.PORT || 3001)

const corsOrigin = process.env.CORS_ORIGIN || '*'
app.use(cors({ origin: corsOrigin }))
app.use(express.json())

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.use('/api/events', eventsRouter)

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ message: 'Něco spadlo na serveru.' })
})

app.listen(port, () => {
  console.log(`R U in? server běží na http://localhost:${port}`)
})
