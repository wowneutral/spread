'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

const DEV_URL = 'http://localhost:5173';
const BG = '#1B1A17';

function isExternal(url) {
  return url.startsWith('http:') || url.startsWith('https:');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: BG,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open target="_blank" / window.open links in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block in-window navigation away from the app; send it to the browser instead.
  win.webContents.on('will-navigate', (event, url) => {
    const isDevReload = !app.isPackaged && url.startsWith(DEV_URL);
    if (!isDevReload && isExternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    win.loadURL(DEV_URL);
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  // NOTE: keep F2–F12 free for the page (card-cutting shortcuts). Roles like
  // togglefullscreen (F11) and toggleDevTools (F12 on some platforms) get
  // explicit non-F-key accelerators; nothing here registers a globalShortcut.
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        {
          role: 'togglefullscreen',
          accelerator: isMac ? 'Ctrl+Command+F' : 'Alt+Enter',
        },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
