// Makes the app icons from build/icon.svg. Run it with Electron, which does the drawing:
//   npx electron scripts/make-icons.cjs
// Writes build/icon.ico (16-256 px), build/icon.png and resources/icon.png (512 px).
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const BIG = 1024

async function drawBig() {
  const window = new BrowserWindow({
    show: false,
    width: BIG,
    height: BIG,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: false }
  })
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace(
    /width="512" height="512"/,
    `width="${BIG}" height="${BIG}"`
  )}</body></html>`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 400))
  const image = await window.webContents.capturePage({ x: 0, y: 0, width: BIG, height: BIG })
  window.destroy()
  return image
}

/** An .ico holding one PNG per size (the form Windows has read since Vista). */
function makeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const entries = []
  const data = []
  let offset = 6 + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    entries.push(entry)
    data.push(png)
  }
  return Buffer.concat([header, ...entries, ...data])
}

app.whenReady().then(async () => {
  try {
    const big = await drawBig()
    const at = (size) => big.resize({ width: size, height: size, quality: 'best' })
    writeFileSync(
      join(root, 'build', 'icon.ico'),
      makeIco(ICO_SIZES.map((size) => ({ size, png: at(size).toPNG() })))
    )
    const png512 = at(512).toPNG()
    writeFileSync(join(root, 'build', 'icon.png'), png512)
    writeFileSync(join(root, 'resources', 'icon.png'), png512)
    console.log('icons written')
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
app.on('window-all-closed', () => {})
void nativeImage
