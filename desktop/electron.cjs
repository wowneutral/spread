'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
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

  // The pop-out timer (#timer) opens as a small always-on-top window;
  // every other target="_blank" / window.open goes to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.includes('#timer')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 340,
          height: 330,
          alwaysOnTop: true,
          backgroundColor: BG,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
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

  // The page blocks unload when a document has unsaved changes. In a browser
  // that shows a leave-site prompt; in Electron it would silently stop the
  // window from closing and the app from quitting. Ask with a real dialog.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Quit anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'A document with unsaved changes is open. Quit anyway and lose those changes, or cancel and save first?',
    });
    if (choice === 0) event.preventDefault(); // proceed with close/quit
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
