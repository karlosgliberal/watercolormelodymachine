"use strict";
const path = require("path");

const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  devtool: "inline-source-map",
  entry: "./src/index.ts",
  output: {
    pathinfo: false,
  },
  mode: "development",
  optimization: {
    removeAvailableModules: false,
    removeEmptyChunks: false,
    splitChunks: false,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: path.resolve(__dirname, "node_modules/"),
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: true,
              experimentalWatchApi: true,
            },
          },
        ],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin(),
    new MiniCssExtractPlugin({
      publicPath: "./dist/",
      filename: "style.css",
    }),
    new CopyPlugin([
      { from: "assets/images" },
      { from: "assets/performance_rnn" },
      { from: "index.html" },
      { from: "index_es.html" },
      { from: "wcmm.html" },
    ]),
  ],
};
