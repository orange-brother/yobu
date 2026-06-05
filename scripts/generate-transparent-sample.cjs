const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdir } = require('node:fs/promises')
const path = require('node:path')

const outputArg = process.argv.find(arg => arg.endsWith('.webm'))
const outputPath = path.resolve(process.cwd(), outputArg ?? 'samples/transparent-stage-sample.webm')

function renderHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      width: 720px;
      height: 720px;
      margin: 0;
      overflow: hidden;
      background: transparent;
    }
    canvas {
      width: 720px;
      height: 720px;
      background: transparent;
    }
  </style>
</head>
<body>
  <canvas id="stage" width="720" height="720"></canvas>
  <script>
    const { ipcRenderer } = require('electron')
    const { writeFileSync } = require('node:fs')

    const outputPath = ${JSON.stringify(outputPath)}
    const canvas = document.getElementById('stage')
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    const fps = 30
    const durationSeconds = 4.2

    function roundedRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function drawLimb(x1, y1, x2, y2, color, widthValue) {
      ctx.strokeStyle = color
      ctx.lineWidth = widthValue
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }

    function drawFrame(time) {
      ctx.clearRect(0, 0, width, height)

      const wave = Math.sin(time * Math.PI * 2 / 2.1)
      const breathe = Math.sin(time * Math.PI * 2 / 1.4)
      const centerX = width / 2
      const centerY = 355 + breathe * 5
      const armLift = wave * 34

      ctx.save()
      ctx.globalAlpha = 0.18
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.ellipse(centerX, 612, 132, 28, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      ctx.save()
      ctx.translate(0, breathe * 4)

      ctx.fillStyle = '#fff7ed'
      ctx.strokeStyle = '#1f2937'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.arc(centerX, 206, 64, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#1f2937'
      ctx.beginPath()
      ctx.arc(centerX - 24, 199, 6, 0, Math.PI * 2)
      ctx.arc(centerX + 24, 199, 6, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = '#1f2937'
      ctx.lineWidth = 8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(centerX - 20, 226)
      ctx.quadraticCurveTo(centerX, 244, centerX + 20, 226)
      ctx.stroke()

      ctx.fillStyle = '#7dd3fc'
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 10
      roundedRect(centerX - 72, centerY - 80, 144, 194, 52)
      ctx.fill()
      ctx.stroke()

      drawLimb(centerX - 60, centerY - 32, centerX - 198, centerY - 150 - armLift, '#fff7ed', 26)
      drawLimb(centerX + 60, centerY - 32, centerX + 198, centerY - 150 + armLift, '#fff7ed', 26)
      drawLimb(centerX - 198, centerY - 150 - armLift, centerX - 230, centerY - 184 - armLift, '#fb7185', 22)
      drawLimb(centerX + 198, centerY - 150 + armLift, centerX + 230, centerY - 184 + armLift, '#fb7185', 22)

      drawLimb(centerX - 38, centerY + 102, centerX - 112, centerY + 220, '#0f172a', 30)
      drawLimb(centerX + 38, centerY + 102, centerX + 112, centerY + 220, '#0f172a', 30)
      drawLimb(centerX - 112, centerY + 220, centerX - 155, centerY + 220, '#fb7185', 24)
      drawLimb(centerX + 112, centerY + 220, centerX + 155, centerY + 220, '#fb7185', 24)

      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 7
      roundedRect(centerX - 118, 72 + wave * 8, 236, 60, 24)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#111827'
      ctx.font = '700 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('스트레칭!', centerX, 103 + wave * 8)

      ctx.restore()
    }

    async function wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function verifyAlpha(blob) {
      return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob)
        const video = document.createElement('video')
        video.muted = true
        video.src = objectUrl
        video.addEventListener('loadeddata', async () => {
          try {
            video.currentTime = Math.min(1, video.duration || 1)
          }
          catch (error) {
            reject(error)
          }
        }, { once: true })
        video.addEventListener('seeked', () => {
          try {
            const verifyCanvas = document.createElement('canvas')
            verifyCanvas.width = 16
            verifyCanvas.height = 16
            const verifyCtx = verifyCanvas.getContext('2d')
            verifyCtx.clearRect(0, 0, 16, 16)
            verifyCtx.drawImage(video, 0, 0, 16, 16)
            const alpha = verifyCtx.getImageData(0, 0, 1, 1).data[3]
            URL.revokeObjectURL(objectUrl)
            resolve(alpha)
          }
          catch (error) {
            URL.revokeObjectURL(objectUrl)
            reject(error)
          }
        }, { once: true })
        video.addEventListener('error', () => {
          URL.revokeObjectURL(objectUrl)
          reject(new Error('generated video could not be loaded'))
        }, { once: true })
      })
    }

    async function main() {
      try {
        if (!window.MediaRecorder) {
          throw new Error('MediaRecorder is not available in this Electron runtime.')
        }

        const preferredMime = 'video/webm;codecs=vp9'
        const fallbackMime = 'video/webm;codecs=vp8'
        const mimeType = MediaRecorder.isTypeSupported(preferredMime)
          ? preferredMime
          : MediaRecorder.isTypeSupported(fallbackMime)
            ? fallbackMime
            : 'video/webm'

        const stream = canvas.captureStream(fps)
        const chunks = []
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 2500000,
        })

        recorder.addEventListener('dataavailable', event => {
          if (event.data.size > 0) {
            chunks.push(event.data)
          }
        })

        const stopped = new Promise(resolve => {
          recorder.addEventListener('stop', resolve, { once: true })
        })

        drawFrame(0)
        recorder.start()
        const startTime = performance.now()

        while ((performance.now() - startTime) / 1000 < durationSeconds) {
          drawFrame((performance.now() - startTime) / 1000)
          await wait(1000 / fps)
        }

        drawFrame(durationSeconds)
        recorder.stop()
        await stopped
        stream.getTracks().forEach(track => track.stop())

        const blob = new Blob(chunks, { type: mimeType })
        const buffer = Buffer.from(new Uint8Array(await blob.arrayBuffer()))
        writeFileSync(outputPath, buffer)

        const cornerAlpha = await verifyAlpha(blob)
        ipcRenderer.send('sample-video-written', {
          outputPath,
          mimeType,
          sizeBytes: buffer.byteLength,
          cornerAlpha,
        })
      }
      catch (error) {
        ipcRenderer.send('sample-video-error', error instanceof Error ? error.message : String(error))
      }
    }

    void main()
  </script>
</body>
</html>`
}

async function main() {
  await mkdir(path.dirname(outputPath), { recursive: true })

  ipcMain.once('sample-video-written', (_event, result) => {
    console.log(JSON.stringify(result, null, 2))
    app.quit()
  })

  ipcMain.once('sample-video-error', (_event, message) => {
    console.error(message)
    app.exit(1)
  })

  const window = new BrowserWindow({
    width: 720,
    height: 720,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  window.webContents.on('console-message', (_event, _level, message) => {
    console.log(message)
  })

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHtml())}`)
}

app.whenReady().then(main).catch(error => {
  console.error(error)
  app.exit(1)
})
