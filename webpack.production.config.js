'use strict';
const path = require('path');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');


module.exports = {
  devtool: 'inline-source-map',
  entry: './src/index.ts',
  output: {
    pathinfo: false
  },
  mode: 'production',
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
      },
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
      { from: 'assets/images', to:'assets/images' },
      { from: 'index.html'},
      { from: 'wcmm.html'},
  ])
  ]
};
