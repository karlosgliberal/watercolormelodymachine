import * as tf from '@tensorflow/tfjs-core';
import { KeyboardElement } from './keyboard_element';

const Piano = require('tone-piano').Piano;
const P5 = require('p5');

const sketch = function(p: any) {
  let props: any;
  let sec: any;
  let initial_size = 10;
  let initial_deviation = 10;
  let deviation = 8;

  let points: Array<any>;
  let current: Array<any>;

  p.setOnReady = function(_pr: any, _sec: any) {
    props = _pr;
    sec = _sec;
  };

  p.setup = function() {
    p.frameRate(20);
    let cnv = p.createCanvas(p.windowWidth, p.windowHeight);
    cnv.parent('canvas');
    p.noStroke();
    p.colorMode(p.HSB);
    p.blendMode(p.SOFT_LIGHT);
    p.blendMode(p.BURN);
    //p.noLoop();
  };

  p.draw = function() {
    let mapDistanciaVentana = p.map(props, 0, 70, 0, p.windowWidth / 2);
    p.translate(mapDistanciaVentana, 250 + sec);
    init();

    p.fill(220, props, 120, 0.02);

    // for (var i = 0; i < props * 0.01; i++) {
    current = update();
    display();
    // }
  };

  function init() {
    points = [];
    for (var i = 0; i < initial_size; i++) {
      points.push(
        p.createVector(
          (i / (initial_size - 1)) * p.width - p.width / 4,
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
        move_nearby(c[i], props * 0.5 + sec);
      }
    }
    return c;
  }

  function display() {
    p.beginShape();
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
      p.save('movida_002.jpg');
    }
  };
};

// tslint:disable-next-line:no-require-imports
const canvas = new P5(sketch);

let lstmKernel1: tf.Tensor2D;
let lstmBias1: tf.Tensor1D;
let lstmKernel2: tf.Tensor2D;
let lstmBias2: tf.Tensor1D;
let lstmKernel3: tf.Tensor2D;
let lstmBias3: tf.Tensor1D;
let c: tf.Tensor2D[];
let h: tf.Tensor2D[];
let fcB: tf.Tensor1D;
let fcW: tf.Tensor2D;
const forgetBias = tf.scalar(1.0);
const activeNotes = new Map<number, number>();
const noteDensityIdx = 2;
const globalGain = 35;

// How many steps to generate per generateStep call.
// Generating more steps makes it less likely that we'll lag behind in note
// generation. Generating fewer steps makes it less likely that the browser UI
// thread will be starved for cycles.
const STEPS_PER_GENERATE_CALL = 10;
// How much time to try to generate ahead. More time means fewer buffer
// underruns, but also makes the lag from UI change to output larger.
const GENERATION_BUFFER_SECONDS = 0.5;
// If we're this far behind, reset currentTime time to piano.now().
const MAX_GENERATION_LAG_SECONDS = 1;
// If a note is held longer than this, release it.
const MAX_NOTE_DURATION_SECONDS = 30;

const NOTES_PER_OCTAVE = 12;
const DENSITY_BIN_RANGES = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0];
const PITCH_HISTOGRAM_SIZE = NOTES_PER_OCTAVE;

//const RESET_RNN_FREQUENCY_MS = 30000;

let pitchHistogramEncoding: tf.Tensor1D;
let noteDensityEncoding: tf.Tensor1D;
let conditioned = true;

let currentPianoTimeSec = 0;
// When the piano roll starts in browser-time via performance.now().

let currentVelocity = 100;

const MIN_MIDI_PITCH = 0;
const MAX_MIDI_PITCH = 127;
const VELOCITY_BINS = 32;
const MAX_SHIFT_STEPS = 100;
const STEPS_PER_SECOND = 100;

// The unique id of the currently scheduled setTimeout loop.
let currentLoopId = 0;

const EVENT_RANGES = [
  ['note_on', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
  ['note_off', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
  ['time_shift', 1, MAX_SHIFT_STEPS],
  ['velocity_change', 1, VELOCITY_BINS]
];

function calculateEventSize(): number {
  let eventOffset = 0;
  for (const eventRange of EVENT_RANGES) {
    const minValue = eventRange[1] as number;
    const maxValue = eventRange[2] as number;
    eventOffset += maxValue - minValue + 1;
  }
  return eventOffset;
}

const EVENT_SIZE = calculateEventSize();
const PRIMER_IDX = 355; // shift 1s.
let lastSample = tf.scalar(PRIMER_IDX, 'int32');

const container = document.querySelector('#keyboard');
const keyboardInterface = new KeyboardElement(container);

const piano = new Piano({ velocities: 4 }).toMaster();

const SALAMANDER_URL =
  'https://storage.googleapis.com/' +
  'download.magenta.tensorflow.org/demos/SalamanderPiano/';
const CHECKPOINT_URL =
  'https://storage.googleapis.com/' +
  'download.magenta.tensorflow.org/models/performance_rnn/tfjs';

const isDeviceSupported = tf.ENV.get('WEBGL_VERSION') >= 1;

if (!isDeviceSupported) {
  document.querySelector('#status').innerHTML =
    'We do not yet support your device. Please try on a desktop ' +
    'computer with Chrome/Firefox, or an Android phone with WebGL support.';
} else {
  start();
}

//let modelReady = false;

function start() {
  piano
    .load(SALAMANDER_URL)
    .then(() => {
      return fetch(`${CHECKPOINT_URL}/weights_manifest.json`)
        .then(response => response.json())
        .then((manifest: tf.WeightsManifestConfig) =>
          tf.loadWeights(manifest, CHECKPOINT_URL)
        );
    })
    .then((vars: { [varName: string]: tf.Tensor }) => {
      document.querySelector('#status').classList.add('hidden');
      document.querySelector('#controls').classList.remove('hidden');
      document.querySelector('#keyboard').classList.remove('hidden');

      lstmKernel1 = vars[
        'rnn/multi_rnn_cell/cell_0/basic_lstm_cell/kernel'
      ] as tf.Tensor2D;
      lstmBias1 = vars[
        'rnn/multi_rnn_cell/cell_0/basic_lstm_cell/bias'
      ] as tf.Tensor1D;

      lstmKernel2 = vars[
        'rnn/multi_rnn_cell/cell_1/basic_lstm_cell/kernel'
      ] as tf.Tensor2D;
      lstmBias2 = vars[
        'rnn/multi_rnn_cell/cell_1/basic_lstm_cell/bias'
      ] as tf.Tensor1D;

      lstmKernel3 = vars[
        'rnn/multi_rnn_cell/cell_2/basic_lstm_cell/kernel'
      ] as tf.Tensor2D;
      lstmBias3 = vars[
        'rnn/multi_rnn_cell/cell_2/basic_lstm_cell/bias'
      ] as tf.Tensor1D;

      fcB = vars['fully_connected/biases'] as tf.Tensor1D;
      fcW = vars['fully_connected/weights'] as tf.Tensor2D;
      //modelReady = true;
      resetRnn();
    });
}

function resetRnn() {
  c = [
    tf.zeros([1, lstmBias1.shape[0] / 4]),
    tf.zeros([1, lstmBias2.shape[0] / 4]),
    tf.zeros([1, lstmBias3.shape[0] / 4])
  ];
  h = [
    tf.zeros([1, lstmBias1.shape[0] / 4]),
    tf.zeros([1, lstmBias2.shape[0] / 4]),
    tf.zeros([1, lstmBias3.shape[0] / 4])
  ];
  if (lastSample != null) {
    lastSample.dispose();
  }
  lastSample = tf.scalar(PRIMER_IDX, 'int32');
  currentPianoTimeSec = piano.now();
  //pianoStartTimestampMs = performance.now() - currentPianoTimeSec * 1000;
  currentLoopId++;
  generateStep(currentLoopId);
}

window.addEventListener('resize', resize);
function resize() {
  keyboardInterface.resize();
}

resize();
setTimeout(() => updateConditioningParams());

function updateConditioningParams() {
  //const pitchHistogram = [2, 0, 1, 0, 1, 1, 2, 0, 1, 0, 2, 1];
  //const pitchHistogram = [0, 0, 0, 6, 7, 8, 0, 0, 0, 0, 0, 0];
  const pitchHistogram = [5, 0, 0, 0, 5, 0, 0, 8, 0, 0, 0, 0];

  if (noteDensityEncoding != null) {
    noteDensityEncoding.dispose();
    noteDensityEncoding = null;
  }
  noteDensityEncoding = tf
    .oneHot(
      tf.tensor1d([noteDensityIdx + 1], 'int32'),
      DENSITY_BIN_RANGES.length + 1
    )
    .as1D();

  if (pitchHistogramEncoding != null) {
    pitchHistogramEncoding.dispose();
    pitchHistogramEncoding = null;
  }
  const buffer = tf.buffer<tf.Rank.R1>([PITCH_HISTOGRAM_SIZE], 'float32');
  const pitchHistogramTotal = pitchHistogram.reduce((prev, val) => {
    return prev + val;
  });

  for (let i = 0; i < PITCH_HISTOGRAM_SIZE; i++) {
    buffer.set(pitchHistogram[i] / pitchHistogramTotal, i);
  }
  pitchHistogramEncoding = buffer.toTensor();
}
updateConditioningParams();

function getConditioning(): tf.Tensor1D {
  return tf.tidy(() => {
    if (!conditioned) {
      // TODO(nsthorat): figure out why we have to cast these shapes to numbers.
      // The linter is complaining, though VSCode can infer the types.
      const size =
        1 +
        (noteDensityEncoding.shape[0] as number) +
        (pitchHistogramEncoding.shape[0] as number);
      const conditioning: tf.Tensor1D = tf
        .oneHot(tf.tensor1d([0], 'int32'), size)
        .as1D();

      return conditioning;
    } else {
      const axis = 0;
      const conditioningValues = noteDensityEncoding.concat(
        pitchHistogramEncoding,
        axis
      );
      return tf.tensor1d([0], 'int32').concat(conditioningValues, axis);
    }
  });
}

async function generateStep(loopId: number) {
  if (loopId < currentLoopId) {
    // Was part of an outdated generateStep() scheduled via setTimeout.
    return;
  }

  const lstm1 = (data: tf.Tensor2D, c: tf.Tensor2D, h: tf.Tensor2D) =>
    tf.basicLSTMCell(forgetBias, lstmKernel1, lstmBias1, data, c, h);
  const lstm2 = (data: tf.Tensor2D, c: tf.Tensor2D, h: tf.Tensor2D) =>
    tf.basicLSTMCell(forgetBias, lstmKernel2, lstmBias2, data, c, h);
  const lstm3 = (data: tf.Tensor2D, c: tf.Tensor2D, h: tf.Tensor2D) =>
    tf.basicLSTMCell(forgetBias, lstmKernel3, lstmBias3, data, c, h);

  let outputs: tf.Scalar[] = [];
  [c, h, outputs] = tf.tidy(() => {
    // Generate some notes.
    const innerOuts: tf.Scalar[] = [];
    for (let i = 0; i < STEPS_PER_GENERATE_CALL; i++) {
      // Use last sampled output as the next input.
      const eventInput = tf.oneHot(lastSample.as1D(), EVENT_SIZE).as1D();
      // Dispose the last sample from the previous generate call, since we
      // kept it.
      if (i === 0) {
        lastSample.dispose();
      }
      const conditioning = getConditioning();
      const axis = 0;
      const input = conditioning.concat(eventInput, axis).toFloat();
      const output = tf.multiRNNCell(
        [lstm1, lstm2, lstm3],
        input.as2D(1, -1),
        c,
        h
      );
      c.forEach(c => c.dispose());
      h.forEach(h => h.dispose());
      c = output[0];
      h = output[1];

      const outputH = h[2];
      const logits = outputH.matMul(fcW).add(fcB);

      const sampledOutput = tf.multinomial(logits.as1D(), 1).asScalar();

      innerOuts.push(sampledOutput);
      lastSample = sampledOutput;
    }
    return [c, h, innerOuts] as [tf.Tensor2D[], tf.Tensor2D[], tf.Scalar[]];
  });

  for (let i = 0; i < outputs.length; i++) {
    playOutput(outputs[i].dataSync()[0]);
  }

  if (piano.now() - currentPianoTimeSec > MAX_GENERATION_LAG_SECONDS) {
    console.warn(
      `Generation is ${piano.now() - currentPianoTimeSec} seconds behind, ` +
        `which is over ${MAX_NOTE_DURATION_SECONDS}. Resetting time!`
    );
    currentPianoTimeSec = piano.now();
  }
  const delta = Math.max(
    0,
    currentPianoTimeSec - piano.now() - GENERATION_BUFFER_SECONDS
  );
  setTimeout(() => generateStep(loopId), delta * 1000);
}

/**
 * Decode the output index and play it on the piano and keyboardInterface.
 */
function playOutput(index: number) {
  let offset = 0;
  for (const eventRange of EVENT_RANGES) {
    const eventType = eventRange[0] as string;
    const minValue = eventRange[1] as number;
    const maxValue = eventRange[2] as number;
    if (offset <= index && index <= offset + maxValue - minValue) {
      if (eventType === 'note_on') {
        const noteNum = index - offset;
        setTimeout(() => {
          keyboardInterface.keyDown(noteNum);
          canvas.setOnReady(
            noteNum,
            currentPianoTimeSec,
            (currentVelocity * globalGain) / 100
          );
          setTimeout(() => {
            keyboardInterface.keyUp(noteNum);
            canvas.setOnReady(
              noteNum,
              currentPianoTimeSec,
              (currentVelocity * globalGain) / 100
            );
          }, 100);
        }, (currentPianoTimeSec - piano.now()) * 1000);
        activeNotes.set(noteNum, currentPianoTimeSec);
        // console.log(
        //   noteNum,
        //   currentPianoTimeSec,
        //   (currentPianoTimeSec * globalGain) / 100
        // );
        canvas.setOnReady(
          noteNum,
          currentPianoTimeSec,
          (currentVelocity * globalGain) / 100
        );
        return piano.keyDown(
          noteNum,
          currentPianoTimeSec,
          (currentVelocity * globalGain) / 100
        );
      } else if (eventType === 'note_off') {
        const noteNum = index - offset;

        const activeNoteEndTimeSec = activeNotes.get(noteNum);
        // If the note off event is generated for a note that hasn't been
        // pressed, just ignore it.
        if (activeNoteEndTimeSec == null) {
          return;
        }
        const timeSec = Math.max(
          currentPianoTimeSec,
          activeNoteEndTimeSec + 0.5
        );
        canvas.setOnReady(noteNum, timeSec);
        piano.keyUp(noteNum, timeSec);

        canvas.setOnReady(0, 0);
        activeNotes.delete(noteNum);
        return;
      } else if (eventType === 'time_shift') {
        currentPianoTimeSec += (index - offset + 1) / STEPS_PER_SECOND;
        activeNotes.forEach((timeSec, noteNum) => {
          if (currentPianoTimeSec - timeSec > MAX_NOTE_DURATION_SECONDS) {
            console.info(
              `Note ${noteNum} has been active for daddad ${currentPianoTimeSec -
                timeSec}, ` +
                `seconds which is over ${MAX_NOTE_DURATION_SECONDS}, will ` +
                `release.`
            );
            canvas.setOnReady(noteNum, currentPianoTimeSec);
            piano.keyUp(noteNum, currentPianoTimeSec);
            activeNotes.delete(noteNum);
            canvas.setOnReady(0, 0);
          }
        });
        return currentPianoTimeSec;
      } else if (eventType === 'velocity_change') {
        currentVelocity = (index - offset + 1) * Math.ceil(127 / VELOCITY_BINS);
        currentVelocity = currentVelocity / 127;
        return currentVelocity;
      } else {
        throw new Error('Could not decode eventType: ' + eventType);
      }
    }
    offset += maxValue - minValue + 1;
  }
  throw new Error(`Could not decode index: ${index}`);
}
