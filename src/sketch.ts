import { cos } from '@tensorflow/tfjs-core';

export const sketch = function(p: any) {
  let props: any;
  let sec: any;
  let temp: any;
  let color: any;
  color = 220;
  let initial_size = 10;
  let initial_deviation = 10;
  let histogramnum = 0;
  let deviation = 8;

  let points: Array<any>;
  let current: Array<any>;
  let direction = true;

  p.setOnReady = function(_pr: any, _sec: any, _temp: any) {
    props = _pr;
    sec = _sec;
    temp = _temp;
  };

  p.setOnColor = function(_color: any) {
    color = _color;
  };

  p.downloadCanvas = function() {
    p.save('canvas.jpg');
  };

  p.setup = function() {
    p.frameRate(20);
    let cnv = p.createCanvas(p.windowWidth, p.windowHeight);
    cnv.parent('canvas');
    p.noStroke();
    p.colorMode(p.HSB);
    p.blendMode(p.SOFT_LIGHT);
  };

  p.draw = function() {
    let valorTeclaPorcenaje = p.map(props, 21, 108, 0, 98.07);
    let posicionElemento = p.map(valorTeclaPorcenaje, 0, 97.07, 0, p.width);

    if (direction) {
      p.translate(posicionElemento, 200 * sec * 0.02);
    } else {
      p.translate(p.mouseX, p.mouseY);
    }

    if (sec < 10) {
      p.fill(0, 0, 0, 0.25);
    } else {
      p.fill(color, props, 120, temp * 0.2);
    }
    init();
    current = update();
    display();
  };

  function init() {
    points = [];
    for (var i = 0; i < initial_size; i++) {
      points.push(
        p.createVector(
          (i / (initial_size - 1)) * p.width - p.width,
          2,
          p.random(-1, 1)
        )
      );
    }
    for (let b = 0; b < 3; b++) {
      interpolate(points, initial_deviation);
    }
  }

  function update() {
    let c = deep_copy(points);
    for (let b = 0; b < 3; b++) {
      for (let i = 0; i < c.length; i++) {
        move_nearby(c[i], props * temp * 3);
      }
    }
    return c;
  }

  function display() {
    p.beginShape(p.TRIANGLES);
    for (let i = 0; i < current.length; i++) {
      p.vertex(current[i].x, current[i].y);
    }
    p.vertex(0, 0);
    p.vertex(0, 0);
    p.endShape(p.CLOSE);
  }

  function interpolate(points: any, sd: any) {
    for (var i = points.length - 1; i > 0; i--) {
      points.splice(i, 0, generate_midpoint(points[i - 1], points[i], sd));
    }
  }

  function generate_midpoint(p1: any, p2: any, sd: any) {
    let p3 = p.createVector(
      p1.x + p2.x,
      p1.y + p2.y,
      (p1.z + p2.z) * 0.25 * p.randomGaussian(-1, 1)
    );
    move_nearby(p3, sd);
    return p3;
  }

  let move_nearby = function(pnt: any, sd: any) {
    pnt.x = p.randomGaussian(pnt.z, pnt.z + sd);
    pnt.y = p.randomGaussian(pnt.z, pnt.z + sd);
  };

  let deep_copy = function(arr: any) {
    let narr = [];
    for (var i = 0; i < arr.length; i++) {
      narr.push(arr[i].copy());
    }
    return narr;
  };

  p.keyPressed = function() {
    if (p.keyCode === 13) {
      p.save('movida.jpg');
    }
    if (p.keyCode === 82) {
      if (direction) {
        direction = false;
      } else {
        direction = true;
      }
    }
  };
};
