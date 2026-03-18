const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
// 根据应用模式设置不同的更新链接
const getUpdateBucket = () => {
  const appMode = (process.env.APP_MODE || 'prod').toLowerCase();
  if (appMode === 'test') {
    return 'https://rdkstudio-test.bj.bcebos.com/rdkstudio';
  }
  // 默认使用生产环境
  return 'https://rdkstudio.bj.bcebos.com/rdkstudio';
};
const HOST_UPDATE_BUCKET = getUpdateBucket();

const osxSigningConfig = {}
let winSigningConfig = {}

if(process.env.NODE_ENV === 'production'){
  osxSigningConfig.osxNotarize = {
    tool: 'notarytool',
    appleId: '651269350@qq.com',
    appleIdPassword: 'aionhorizon',
    teamId: 'RSTK58X548'
  };
}

module.exports = {
  packagerConfig: {
    appBundleId: `com.drobotics.rdkstudio`,
    executableName: process.platform === 'linux' ? 'rdk-studio' : 'RDKStudio',
    asar: true,
    ignore: [
      './src/extraResources'
    ],
    icon: './icon/icon',
    name: 'RDKStudio',
    extraResource: [
      './src/extraResources/scripts',
      './src/extraResources/hardware_appspace',
      './src/extraResources/examples',
      './src/extraResources/flash',
      './src/extraResources/changelog'
    ],
    appCopyright: `Copyright © 2023-2026 Shenzhen D-Robotics Co., Ltd`,
    osxSign: {
        'identity': 'Developer ID Application: Yupei Wu (RSTK58X548)',
        hardenedRuntime: true,
        entitlements: './entitlements.mac.plist',
        'entitlements-inherit': './entitlements.mac.plist',
        'signature-flags': 'library'
    },
    ...osxSigningConfig
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: "RDKStudio"
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: (arch) => ({
        macUpdateManifestBaseUrl: `${HOST_UPDATE_BUCKET}/latest/darwin/${arch}`,
        macUpdateReleaseNotes: 'added inside webview support and autoupdate support'
      })
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {}
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
