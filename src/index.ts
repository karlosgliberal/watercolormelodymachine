import * as tf from '@tensorflow/tfjs-core';
import { KeyboardElement } from './keyboard_element';
// tslint:disable-next-line:no-require-imports
import '../assets/style.scss';
const scalas = require('./scalas').escalasObjetos;

const movida = require('./sketch').sketch;

const Piano = require('tone-piano').Piano;
const P5 = require('p5');
let canvas;
let histogramnum = 0;

//definimos la escala por defecto.
const defaultScala = 'mayor';
let currentScala = defaultScala;
let currentColor = 0;

// tslint:disable-next-line:no-require-imports
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
const globalGain = 35;
const STEPS_PER_GENERATE_CALL = 10;
const GENERATION_BUFFER_SECONDS = 0.5;
const MAX_GENERATION_LAG_SECONDS = 1;
const MAX_NOTE_DURATION_SECONDS = 30;
const NOTES_PER_OCTAVE = 12;
const DENSITY_BIN_RANGES = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0];
const PITCH_HISTOGRAM_SIZE = NOTES_PER_OCTAVE;
//const RESET_RNN_FREQUENCY_MS = 30000;

let pitchHistogramEncoding: tf.Tensor1D;
let noteDensityEncoding: tf.Tensor1D;
let conditioned = true;
let currentPianoTimeSec = 0;
let currentVelocity = 100;

const MIN_MIDI_PITCH = 0;
const MAX_MIDI_PITCH = 127;
const VELOCITY_BINS = 32;
const MAX_SHIFT_STEPS = 100;
const STEPS_PER_SECOND = 100;

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

// const SALAMANDER_URL = 'http://investic.net/SalamanderGrandPiano/mp3/';
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
  //Bind para asegurarnos que esta todo el contenido cargado.
  document.addEventListener('DOMContentLoaded', start);
}

function start() {
  setScaleFromHash();
  //canvas = new P5(sketch);
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
      //resetRnn();
      document.querySelector('#keyboard').classList.remove('hidden');
      canvas = new P5(movida);
      resetRnn();
      document.getElementById('downloadCanvas').onclick = () => {
        canvas.downloadCanvas();
      };
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
  currentLoopId++;
  generateStep(currentLoopId);
}

window.addEventListener('resize', resize);
function resize() {
  keyboardInterface.resize();
}

window.addEventListener('hashchange', function() {
  setScaleFromHash();
  updateConditioningParams(0);
});
resize();

setTimeout(() => updateConditioningParams(0));

function updateConditioningParams(numHistogram) {
  const pitchHistogramArray = scalas[currentScala].escalas;
  const timeoutEscalas = scalas[currentScala].timeout;
  currentColor = scalas[currentScala].color;

  let pitchHistogram = pitchHistogramArray[numHistogram][0];
  let noteDensityIdxArray = pitchHistogramArray[numHistogram][1];

  if (noteDensityEncoding != null) {
    noteDensityEncoding.dispose();
    noteDensityEncoding = null;
  }
  noteDensityEncoding = tf
    .oneHot(
      tf.tensor1d([noteDensityIdxArray[0] + 1], 'int32'),
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

  //updateHistogram();
  setTimeout(() => updateHistogram(), timeoutEscalas);
}

//Para porsiaca ahora es el sitema del color
function updateHistogram() {
  // colores = colores + 10;
  histogramnum = histogramnum + 1;
  updateConditioningParams(histogramnum);
  if (histogramnum == 3) {
    histogramnum = 0;
  }
}

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
  canvas.setOnColor(currentColor);

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
        if (activeNoteEndTimeSec == null) {
          return;
        }
        const timeSec = Math.max(
          currentPianoTimeSec,
          activeNoteEndTimeSec + 0.5
        );

        piano.keyUp(noteNum, timeSec);

        canvas.setOnReady(0, 0, 0);
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
            canvas.setOnReady(noteNum, currentPianoTimeSec, 0);
            piano.keyUp(noteNum, currentPianoTimeSec);
            activeNotes.delete(noteNum);
            canvas.setOnReady(0, 0, 0);
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

function setScaleFromHash() {
  //cogemos el hash del navegador sin la almoadilla
  let hash = window.location.hash.replace('#', '');
  //verificamos que exista en el objeto scalas
  if (scalas.hasOwnProperty(hash)) {
    //Existe: lo asignamos
    currentScala = hash;
    document.getElementById(currentScala).classList.add('btn-sel__active');
  } else {
    //No existe: ponemos el definido por defecto.
    currentScala = defaultScala;
    document.getElementById(currentScala).classList.add('btn-sel__active');
  }
}
