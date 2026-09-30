import workletUrl from './capture-worklet.ts?worker&url';
import { Pcm16Encoder } from './pcm';

/** The microphone as the recording store sees it; tests pass a fake (system boundary). */
export interface Microphone {
  /**
   * Asks for the microphone and starts delivering 100 ms PCM16 frames. Rejects with a
   * `DOMException` named `NotAllowedError` when the user or the system refuses access.
   */
  start(onFrame: (frame: ArrayBuffer) => void): Promise<void>;
  /** Releases the microphone (the browser's recording indicator goes off). Safe to call twice. */
  stop(): void;
}

/**
 * Browser microphone via getUserMedia and an AudioWorklet (ADR 0015). The AudioContext runs at
 * the device rate; resampling to 16 kHz happens in `Pcm16Encoder`, because not every browser
 * connects a microphone to a context with a different rate.
 */
export function browserMicrophone(): Microphone {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  return {
    async start(onFrame) {
      // Created first, inside the user's tap: Safari only starts audio from a user gesture.
      context = new AudioContext();
      const current = context;
      const granted = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      stream = granted;
      await current.audioWorklet.addModule(workletUrl);
      await current.resume();
      // stop() ran while the permission prompt or the worklet was loading: release at once.
      if (context !== current) {
        granted.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      const encoder = new Pcm16Encoder(current.sampleRate);
      node = new AudioWorkletNode(current, 'lfc-capture', { numberOfOutputs: 0 });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        for (const frame of encoder.push(event.data)) onFrame(frame);
      };
      current.createMediaStreamSource(granted).connect(node);
    },
    stop() {
      node?.port.postMessage('stop');
      node = undefined;
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      stream = undefined;
      void context?.close().catch(() => undefined);
      context = undefined;
    },
  };
}
