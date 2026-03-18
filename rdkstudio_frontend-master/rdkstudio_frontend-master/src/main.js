const { app, session, BrowserWindow, WebContentsView, ipcMain, dialog, autoUpdater } = require('electron');
const path = require('node:path');

import { 
  OPEN_DIALOG,
  DIALOG_RESULT,
  OPEN_URL,
  OPEN_SUB_URL,
  OPEN_NEW_WINDOW,
  HIDE_URL,
  CLOSE_URL,
  ASK_CLOSE_TAB,
  GET_DOWNLOAD_PATH,
  RETURN_DOWNLOAD_PATH,
  GET_USER_DATA,
  GET_APP_VERSION,
  DECOMPRESS_IMAGE_FILE,
  CHECK_WINDOW_TYPE,
  CHANGE_LANGUAGE
} from './constants/AppEventNames';

import {
  HOST_UPDATE_BUCKET
} from './constants/HostNames';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let lang = Intl.DateTimeFormat().resolvedOptions().locale;
lang = lang.substr(0, 2);
if(lang !== 'en' && lang !== 'zh'){
    lang = 'en';
}

//ignore certificate errors
// app.commandLine.appendSwitch('ignore-certificate-errors');

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      devTools: process.env.NODE_ENV === 'development',
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      enableBlinkFeatures: 'SpeechRecognition',
      icon: path.join(__dirname, '../icon/icon.ico'),
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMinimumSize(720, 480);
  mainWindow.setMenuBarVisibility(false);
  
  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools.
  if(process.env.NODE_ENV === 'development'){
    mainWindow.webContents.openDevTools();
  }
  else{
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.key.toLowerCase() === 'r') {
        event.preventDefault(); // 拦截 Ctrl+R
      }
      if (input.meta && input.key.toLowerCase() === 'r') {
        event.preventDefault(); // 拦截 Cmd+R（macOS）
      }
      if (input.key.toLowerCase() === 'f5') {
        event.preventDefault(); // 拦截 F5
      }
    });
  }

  mainWindow.on('close', (event) => {
    event.preventDefault();
    
    const dialogOptions = {
      'zh': {
        type: 'question',
        buttons: ['确定', '取消'],
        title: '关闭RDK Studio',
        message: 'RDK Studio正在运行，是否确认关闭该程序？',
        cancelId: 1
      }, 
      'en': {
        type: 'question',
        buttons: ['Yes', 'No'],
        title: 'Close RDK Studio',
        message: 'Are you sure you want to close the application?',
        cancelId: 1
      }
    }

    const choice = dialog.showMessageBoxSync(mainWindow, dialogOptions[lang]);

    if (choice === 0) {
      mainWindow.destroy();
      app.quit();
    }
  })

  return mainWindow;
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  
  const UserDataPath = app.getPath('userData');
  const DownloadPath = app.getPath('downloads');

  const win = createWindow();

  if(process.env.NODE_ENV != 'development'){
    checkForUpdates();
  }

  const urlsObject = {};

  // Linux 平台缩放同步（仅 Linux）
  if (process.platform === 'linux') {
    const syncZoom = () => {
      try {
        const zoom = win.webContents.getZoomFactor();
        const zoomLevel = win.webContents.getZoomLevel();
        for (const url in urlsObject) {
          const view = urlsObject[url];
          if (view?.webContents && !view.webContents.isDestroyed()) {
            view.webContents.setZoomFactor(zoom);
            view.webContents.setZoomLevel(zoomLevel);
          }
        }
      } catch (e) {}
    };
    
    // 监听主窗口缩放变化事件
    win.webContents.on('zoom-changed', syncZoom);
    
    // 监听显示器变化
    const { screen } = require('electron');
    screen.on('display-metrics-changed', syncZoom);
    
    // 窗口显示时同步
    win.on('show', syncZoom);
  }

  ipcMain.on(OPEN_DIALOG, (event, options) => {
    dialog.showOpenDialog(null, options).then(result => {
      event.sender.send(DIALOG_RESULT, result);
    })
  })

  ipcMain.on(OPEN_URL, (event, options) => {
    if(!Object.hasOwnProperty.call(urlsObject, options.url)){
      const view = new WebContentsView();
      view.webContents.session.setCertificateVerifyProc((request, callback) => {
        callback(0); // 0 表示信任证书
      });
      // view.webContents.openDevTools();
      win.contentView.addChildView(view);
      view.webContents.loadURL(options.url);
      let size = win.getContentSize();
      view.setBounds({ x: 76, y: 4 + 32, width: size[0] - 80, height: size[1] - 8 - 32 });
      urlsObject[options.url] = view;
      
      // Linux 平台：创建时立即同步缩放
      if (process.platform === 'linux') {
        try {
          view.webContents.setZoomFactor(win.webContents.getZoomFactor());
          view.webContents.setZoomLevel(win.webContents.getZoomLevel());
        } catch (e) {}
      }

      // view.webContents.executeJavaScript(ScriptsForNodeRED.join(';'));
      view.webContents.setWindowOpenHandler((details) => {
        event.sender.send(OPEN_SUB_URL, details.url);
        return { action: 'deny' }
      })
    }
    else{
      urlsObject[options.url].setVisible(true);
    }
  })

  ipcMain.on(HIDE_URL, (event, options) => {
    if(Object.hasOwnProperty.call(urlsObject, options.url)){
      urlsObject[options.url].setVisible(false);
    }
  })

  ipcMain.on(CLOSE_URL, (event, options)=> {
    if(Object.hasOwnProperty.call(urlsObject, options.url)){
      let view = urlsObject[options.url];
      const { webContents } = view;
      win.contentView.removeChildView(urlsObject[options.url]);
      delete urlsObject[options.url];
      webContents.removeAllListeners();
      webContents.destroy();
      view = null;
    }
  })

  ipcMain.on(OPEN_NEW_WINDOW, (event, options) => {
    // 从主窗口传递的当前语言获取，而不是使用主进程的旧 lang 变量
    // 优先使用从渲染进程传递的语言，如果没有则使用主进程的 lang 作为默认值
    const currentLang = options?.lang || lang;

    const newWin = new BrowserWindow({
      width: 960,
      height: 640,
      webPreferences: {
        devTools: process.env.NODE_ENV === 'development',
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
        enableBlinkFeatures: 'SpeechRecognition',
        additionalArguments: [`--custom-data=${JSON.stringify({
          lang: currentLang
        })}`]
      }
    });
    newWin.setMinimumSize(720, 480);
    newWin.setMenuBarVisibility(false);
    // newWin.webContents.openDevTools();
    // newWin.webContents.session.setCertificateVerifyProc((request, callback) => {
    //   callback(0); // 0 表示信任证书
    // });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      newWin.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL + '#' + options.url);
    }
    else{
      newWin.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
        hash: options.url
      });
    }
  })

  ipcMain.on(GET_DOWNLOAD_PATH, (event) => {
    if(DownloadPath){
      event.sender.send(RETURN_DOWNLOAD_PATH, {
        path: DownloadPath
      })
    }
  })

  ipcMain.on(CHANGE_LANGUAGE, (event, options) => {
    if(options?.lang){
      lang = options.lang;
    }
  })

  ipcMain.handle(GET_USER_DATA, (event) => {
    return UserDataPath;
  })

  ipcMain.handle(GET_APP_VERSION, (event) => {
    return app.getVersion();
  })

  ipcMain.handle(CHECK_WINDOW_TYPE, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if(window === win){
      return 'main';
    }
    else{
      return 'sub';
    }
  })

  ipcMain.handle(ASK_CLOSE_TAB, (event) => {
    const dialogOptions = {
      'zh': {
        type: 'question',
        buttons: ['关闭程序', '关闭页面'],
        title: '关闭操作',
        message: '请选择关闭程序或者关闭页面！'
      }, 
      'en': {
        type: 'question',
        buttons: ['Close APP', 'Close Page'],
        title: 'Close APP',
        message: 'Please choose Close APP or Close Page!'
      }
    }

    const choice = dialog.showMessageBoxSync(win, dialogOptions[lang]);

    if (choice === 0) {
      return true;
    }
    else{
      return false;
    }
  })

  //resize all views
  let resizeTimer = null;
  
  const updateAllViewsBounds = () => {
    let size = win.getContentSize();
    for(const url in urlsObject){
      urlsObject[url].setBounds({ x: 76, y: 4 + 32, width: size[0] - 80, height: size[1] - 8 -32 });
    }
  };
  
  const debouncedUpdateViews = () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      updateAllViewsBounds();
      resizeTimer = null;
    }, 16);
  };
  
  if (process.platform === 'linux') {
    win.on('resize', () => {
      updateAllViewsBounds();
      debouncedUpdateViews();
    });
    win.on('moved', debouncedUpdateViews);
  } else {
    win.on('resize', debouncedUpdateViews);
  }
  
  win.once('show', () => {
    setTimeout(() => {
      updateAllViewsBounds();
    }, 100);
  });

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if(process.platform !== 'darwin'){
      app.quit();
    }
  })

});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

const ScriptsForNodeRED = [
  'const newDiv = document.createElement("div")',
  'newDiv.style["position"]="fixed"',
  'newDiv.style["bottom"]="0"',
  'newDiv.style["right"]="0"',
  'newDiv.style["width"]="24px"',
  'newDiv.style["height"]="24px"',
  'newDiv.style["backgroundColor"]="red"',
  'document.body.appendChild(newDiv)'
];

const checkForUpdates = () => {
  let feed = `${HOST_UPDATE_BUCKET}/latest/win32/x64`;

  if(process.platform === 'darwin'){
    feed = `${HOST_UPDATE_BUCKET}/latest/darwin/${process.arch}/RELEASES.json`;
  }
  else{
    feed = `${HOST_UPDATE_BUCKET}/latest/${process.platform}/${process.arch}`;
  }

  //step 1: set feed url
  try{
    const options = {
      url: feed
    };
    if(process.platform === 'darwin'){
      options.serverType = 'json';
    }
    autoUpdater.setFeedURL(options);
  }
  catch(e){
    const errorOptions = {
      'en': {
        type: 'error',
        title: 'Error Info',
        message: 'An error occured while setting URL!',
        buttons: ['OK']
      },
      'zh': {
        type: 'error',
        title: '错误信息',
        message: '设置网络链接时出错！',
        buttons: ['好的']
      }
    }

    dialog.showMessageBox(errorOptions[lang]);
  }

  //step 2: bind event handlers
  autoUpdater.on('error', message => {
    // 不显示更新错误提示
    console.log('Update error:', message);
  })
  // autoUpdater.on('update-not-available', () => {
  //   dialog.showMessageBox({
  //     type: 'error',
  //     title: 'Error Info',
  //     message: 'The autoUpdater has not found any update!',
  //     buttons: ['OK']
  //   });
  // })

  // autoUpdater.on('update-available', () => {
  //   console.log('The autoUpdater has found an update and is now downloading it!')
  //   dialog.showMessageBox({
  //     type: 'info',
  //     title: 'Available Updates',
  //     message: 'Downloading available updates...',
  //     buttons: ['OK']
  //   });
  // })

  autoUpdater.on('checking-for-update', () => {
    console.log('The autoUpdater is checking for an update')
  })

  autoUpdater.on('update-downloaded', (event, notes, name, date) => {


    const dialogOpts =
    {
      'en': {
        type: 'info',
        buttons: ['Restart', 'Later'],
        title: 'App Update',
        message: process.platform === 'win32' ? notes : name,
        detail: `A new version (${name}) has been downloaded. Restart the application to apply the updates.`
      },
      'zh': {
        type: 'info',
        buttons: ['重启Studio', '稍后重启'],
        title: 'RDK Studio自动升级',
        message: process.platform === 'win32' ? notes : name,
        detail: `新版本（${name}）已下载完成，重启RDK Studio后更新生效！`
      }
    } 
  
    dialog.showMessageBox(dialogOpts[lang]).then((returnValue) => {
      if (returnValue.response === 0) autoUpdater.quitAndInstall(true, true)
    })
  })


  //step3 check update
  try {
    autoUpdater.checkForUpdates()
  } catch (error) {
  //   dialog.showMessageBox({
  //     type: 'error',
  //     title: 'Error Info',
  //     message: 'An error occurred while checking for updates!',
  //     buttons: ['OK']
  // });
  }
}