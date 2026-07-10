import QRCode from 'qrcode'

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return y
  }

  let line = ''
  let lineCount = 0

  for (let i = 0; i < words.length; i += 1) {
    const testLine = line ? `${line} ${words[i]}` : words[i]
    const testWidth = ctx.measureText(testLine).width

    if (testWidth <= maxWidth || !line) {
      line = testLine
      continue
    }

    ctx.fillText(line, x, y + lineCount * lineHeight)
    lineCount += 1

    if (lineCount >= maxLines - 1) {
      const remaining = words.slice(i).join(' ')
      let tail = remaining

      while (ctx.measureText(`${tail}…`).width > maxWidth && tail.length > 0) {
        tail = tail.slice(0, -1)
      }

      ctx.fillText(`${tail}…`, x, y + lineCount * lineHeight)
      return y + (lineCount + 1) * lineHeight
    }

    line = words[i]
  }

  if (line) {
    ctx.fillText(line, x, y + lineCount * lineHeight)
    lineCount += 1
  }

  return y + lineCount * lineHeight
}

export async function createQrPosterDataUrl({ inviteUrl, eventName, eventDateLabel, isPastEvent }) {
  const qrCanvas = document.createElement('canvas')

  await QRCode.toCanvas(qrCanvas, inviteUrl, {
    width: 900,
    margin: 2,
    color: {
      dark: '#201219',
      light: '#FFFFFFFF',
    },
  })

  const width = 1080
  const height = 1440
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Canvas context unavailable')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#6f4cff'
  ctx.font = '700 40px "Space Grotesk", "Segoe UI", sans-serif'
  ctx.fillText('RUin? · QR pozvánka', 90, 120)

  ctx.fillStyle = '#1a1a1a'
  ctx.font = '900 66px "Space Grotesk", "Segoe UI", sans-serif'
  const nextY = wrapCanvasText(ctx, eventName || 'Pozvánka', 90, 220, width - 180, 78, 3)

  ctx.fillStyle = '#4b4b4b'
  ctx.font = '500 34px "Space Grotesk", "Segoe UI", sans-serif'
  ctx.fillText(eventDateLabel || '', 90, nextY + 40)

  if (isPastEvent) {
    ctx.fillStyle = '#fee2e2'
    ctx.fillRect(90, nextY + 80, 290, 64)
    ctx.fillStyle = '#9f1239'
    ctx.font = '700 32px "Space Grotesk", "Segoe UI", sans-serif'
    ctx.fillText('Akce proběhla', 112, nextY + 124)
  }

  const qrSize = 760
  const qrX = (width - qrSize) / 2
  const qrY = 520

  ctx.fillStyle = '#f8f7fb'
  ctx.fillRect(qrX - 20, qrY - 20, qrSize + 40, qrSize + 40)
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize)

  ctx.fillStyle = '#6f4cff'
  ctx.font = '600 26px "Space Grotesk", "Segoe UI", sans-serif'
  ctx.fillText('Naskenuj pro otevření pozvánky', 320, 1320)

  return canvas.toDataURL('image/png')
}

export function dataUrlToFile(dataUrl, fileName) {
  const [meta, base64] = dataUrl.split(',')
  const mime = meta.match(/data:(.*);base64/)?.[1] || 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new File([bytes], fileName, { type: mime })
}
