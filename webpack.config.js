const path = require('path')
const webpack = require('webpack')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const manifest = require('./manifest.json')

module.exports = {
  mode: 'production',
  devtool: false,
  entry: {
    popup: './src/popup.ts',
    background: './src/background.ts',
    offscreen: './src/offscreen.ts',
    micsetup: './src/micsetup.ts',
    meetWatcher: './src/meetWatcher.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      __SENTRY_DSN__: JSON.stringify(process.env.SENTRY_DSN || ''),
      __SENTRY_ENVIRONMENT__: JSON.stringify(process.env.SENTRY_ENVIRONMENT || 'chrome-extension-dev'),
      __EXTENSION_VERSION__: JSON.stringify(manifest.version),
      __UPLOAD_API_BASE_URL__: JSON.stringify(process.env.UPLOAD_API_BASE_URL || 'https://meet2note.com')
    }),
    new CleanWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json',  to: 'manifest.json' },
        { from: 'popup.html',     to: 'popup.html' },
        { from: 'offscreen.html', to: 'offscreen.html', noErrorOnMissing: true },
        { from: 'micsetup.html', to: 'micsetup.html' },
      ]
    })
  ]
}
