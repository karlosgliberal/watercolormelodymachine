"use strict";
const path = require("path");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const UglifyJsPlugin = require("uglifyjs-webpack-plugin");
const ImageminPlugin = require("imagemin-webpack-plugin").default;

module.exports = {
  //devtool: 'inline-source-map',
  entry: "./src/index.ts",
  output: {
    pathinfo: false,
  },
  mode: "production",
  optimization: {
    minimizer: [
      new UglifyJsPlugin({
        cache: true,
        parallel: true,
        sourceMap: true, // set to true if you want JS source maps
      }),
    ],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              transpileOnly: false,
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
    // new CopyPlugin([
    //   { from: "assets/images" },
    //   // { from: "assets/performance_rnn", to: "assets/performance_rnn" },
    //   // { from: "index.html", to: "ndex.html" },
    //   // { from: "index_es.html", to: "ndex_es.html" },
    //   // { from: "style.css", to: "style.css" },
    //   // { from: "wcmm.html", to: "wcmm.html" },
    // ]),
    new ImageminPlugin({
      pngquant: {
        quality: "95-100",
      },
      test: /\.(jpe?g|png|gif|svg)$/i,
    }),
  ],
};
