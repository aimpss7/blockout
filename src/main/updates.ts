import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_DELAY_MS = 10_000

function updatesDisabled(): boolean {
  return (
    !app.isPackaged ||
    !!process.env.ELECTRON_RENDERER_URL ||
    !!process.env.BLOCKOUT_SMOKE_DIR ||
    process.env.BLOCKOUT_DISABLE_UPDATES === '1'
  )
}

function logUpdate(message: string, error?: unknown): void {
  if (error) {
    console.warn(`[updates] ${message}`, error)
  } else {
    console.info(`[updates] ${message}`)
  }
}

export function configureAutoUpdates(getWindow: () => BrowserWindow | null): void {
  if (updatesDisabled()) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => logUpdate('checking'))
  autoUpdater.on('update-available', (info) => logUpdate(`available ${info.version}`))
  autoUpdater.on('update-not-available', () => logUpdate('not available'))
  autoUpdater.on('download-progress', (progress) =>
    logUpdate(`download ${Math.round(progress.percent)}%`)
  )
  autoUpdater.on('error', (error) => logUpdate('failed', error))
  autoUpdater.on('update-downloaded', (info) => {
    logUpdate(`downloaded ${info.version}`)
    const window = getWindow()
    if (!window) return
    void dialog.showMessageBox(window, {
      type: 'info',
      buttons: ['Restart now', 'Install on quit'],
      defaultId: 1,
      cancelId: 1,
      title: 'Blockout update ready',
      message: `Blockout ${info.version} has been downloaded.`,
      detail: 'Restart now to install it, or keep working and Blockout will install it when you quit.'
    }).then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall()
    })
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error) => logUpdate('check failed', error))
  }, CHECK_DELAY_MS)
}
