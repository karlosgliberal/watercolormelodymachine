'use strict';
const path = require('path');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');
const OptimizeCSSAssetsPlugin = require('optimize-css-assets-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack-plugin').default;

module.exports = {
  //devtool: 'inline-source-map',
  entry: './src/index.ts',
  output: {
    pathinfo: false
  },
  mode: 'production',
  optimization: {
    minimizer: [
      new UglifyJsPlugin({
        cache: true,
        parallel: true,
        sourceMap: true // set to true if you want JS source maps
      }),
      new OptimizeCSSAssetsPlugin({})
    ]
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: false
            }
          }
        ]
      },
      {
        test: /\.scss$/,
        exclude: path.resolve(__dirname, 'node_modules/'),
        use: [
          'style-loader',
          MiniCssExtractPlugin.loader,
          'css-loader',
          'sass-loader'
        ]
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js']
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin(),
    new MiniCssExtractPlugin({
      publicPath: './dist/',
      filename: 'style.css'
    }),
    new CopyPlugin([
      { from: 'assets/images', to: 'assets/images' },
      { from: 'assets/performance_rnn', to: 'assets/performance_rnn' },
      { from: 'index.html' },
      { from: 'index_es.html' },
      { from: 'wcmm.html' }
    ]),
    new ImageminPlugin({
      pngquant: {
        quality: '95-100'
      },
      test: /\.(jpe?g|png|gif|svg)$/i
    })
  ]
};
