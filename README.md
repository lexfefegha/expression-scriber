# Expression-Scriber

> *A kind of instrument into which you can step & sit or sprawl or hang & use not only your fingers to make words express feelings but elbows, feet, head.*
>
> — Amiri Baraka, *Technology & Ethos* (1970)

Your body is the input. Movement becomes expression. Four creative tools powered by AI pose detection, running entirely in your browser.

## The Instruments

**〰 Movement Script** — Your body writes. Words trail behind your motion, fading like breath on glass. Two modes: *trail* (text follows you like a comet tail) and *paint* (text stamps in place and dissolves). Choose which keypoints to track, your text, font, colors, and trail behavior.

**◎ Spoken Body** — Voice becomes form. Speak aloud and your words appear on your skin in real-time, wrapping between your shoulders and around your head.

**❏ Worn Image** — Dress your limbs in emoji. Pick a character for each body part — head, torso, upper arms, forearms, thighs, shins — from a palette of 50 emoji and watch them move with you.

**◍ Felt Sound** — Your body becomes a synthesizer. Raise your right hand to shift pitch, spread your arms for volume, lift your left hand to brighten the timbre, tilt your shoulders to detune. Pick a base note, waveform shape, and reverb amount. Three visualization styles: waveform, spectrum bars, and expanding rings.

## How It Works

Each tool uses [MoveNet](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection/src/movenet) (via TensorFlow.js) to detect 17 keypoints on your body through your webcam. The pose data drives real-time canvas visuals that you shape through a no-code control panel — colors, fonts, sizes, images, behaviors.

Everything runs client-side. Nothing leaves your machine.

## Run It

```
npm install
npm run dev
```

Open `localhost:3000`. Allow camera access. Pick an instrument.

## Build

```
npm run build
```

## Stack

- Vanilla JS + HTML5 Canvas
- [TensorFlow.js](https://www.tensorflow.org/js) with MoveNet (SINGLEPOSE_LIGHTNING)
- [Vite](https://vite.dev)
- Web Speech API (for Spoken Body)
- Web Audio API (for Felt Sound)

## Inspiration

This project is part of a suite of experiments exploring AI + creativity. The name and ethos come from Amiri Baraka's 1970 essay [*Technology & Ethos*](http://www.soulsista.com/titanic/baraka.html), in which he imagines an "expression-scriber" — a machine that uses the whole body as input, producing output that can be "touched, or tasted or felt, or entered, or heard or carried like a speaking singing constantly communicating charm."

The original creative spark comes from Google Creative Lab's [PoseNet Sketchbook](https://github.com/googlecreativelab/posenet-sketchbook), reimagined here with modern pose detection and a no-code interface.

## License

MIT
